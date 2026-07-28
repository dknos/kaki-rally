/**
 * Deterministic multi-overpass planning for Draw Track.
 *
 * The planner deliberately stays DOM/Three-free. It detects every center-line
 * intersection through a spatial hash, deduplicates sampled neighbors, creates
 * both bridge orientations, then solves an exact maximum-weight compatible set.
 */
import { CourseSpatialHash } from './courseSpatialIndex.js';

const EPSILON = 1e-8;
const TAU = Math.PI * 2;
const CROSSING_ANGLE_MIN = 0.52;
const GRID_RESERVATION_METRES = 18;
const MIN_UNDERPASS_CLEARANCE = 4.35;

export const BRIDGE_PRESETS = Object.freeze({
  standard: Object.freeze({
    id: 'standard',
    label: 'Standard',
    baseHeight: 5.35,
    widthHeightFactor: 0.055,
    maximumGrade: 0.19,
    minimumApproach: 32,
    deckDepth: 0.5,
    supportRadius: 8,
  }),
  tall: Object.freeze({
    id: 'tall',
    label: 'Tall',
    baseHeight: 7.05,
    widthHeightFactor: 0.05,
    maximumGrade: 0.175,
    minimumApproach: 42,
    deckDepth: 0.58,
    supportRadius: 10,
  }),
  huge: Object.freeze({
    id: 'huge',
    label: 'Huge',
    baseHeight: 9.05,
    widthHeightFactor: 0.045,
    maximumGrade: 0.16,
    minimumApproach: 56,
    deckDepth: 0.68,
    supportRadius: 13,
  }),
});

export const CROSSING_OVERRIDE_MODES = Object.freeze([
  'auto',
  'a-over-b',
  'b-over-a',
  'flat',
]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function mod1(value) {
  const wrapped = finite(value) % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

function distance(a, b) {
  return Math.hypot(finite(b?.x) - finite(a?.x), finite(b?.y) - finite(a?.y));
}

function circularFractionDistance(a, b) {
  const direct = Math.abs(mod1(a) - mod1(b));
  return Math.min(direct, 1 - direct);
}

function circularIndexDistance(a, b, count) {
  const direct = Math.abs(a - b);
  return Math.min(direct, count - direct);
}

function quantize(value, precision) {
  return Math.round(finite(value) * precision) / precision;
}

function angleBetween(a, b, c, d) {
  const ax = b.x - a.x;
  const ay = b.y - a.y;
  const bx = d.x - c.x;
  const by = d.y - c.y;
  const al = Math.hypot(ax, ay) || 1;
  const bl = Math.hypot(bx, by) || 1;
  const dot = Math.abs((ax * bx + ay * by) / (al * bl));
  return Math.acos(clamp(dot, -1, 1));
}

function segmentIntersection(a, b, c, d) {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < EPSILON) return null;
  const qx = c.x - a.x;
  const qy = c.y - a.y;
  const t = (qx * sy - qy * sx) / denominator;
  const u = (qx * ry - qy * rx) / denominator;
  if (t <= 0.001 || t >= 0.999 || u <= 0.001 || u >= 0.999) return null;
  return { t, u, x: a.x + rx * t, y: a.y + ry * t };
}

function routeDistances(samples) {
  const distances = new Float64Array(samples.length + 1);
  let total = 0;
  for (let index = 0; index < samples.length; index++) {
    const next = (index + 1) % samples.length;
    total += distance(samples[index], samples[next]);
    distances[index + 1] = total;
  }
  return { distances, total };
}

function routeFractionAt(index, amount, segmentLengths, total) {
  const segment = segmentLengths[index + 1] - segmentLengths[index];
  return mod1((segmentLengths[index] + segment * clamp(amount, 0, 1)) / Math.max(EPSILON, total));
}

function canonicalFraction(routeFraction, startFraction, reverse) {
  const shifted = mod1(startFraction + routeFraction);
  return reverse ? mod1(1 - shifted) : shifted;
}

function referenceRoute(referenceSamples = []) {
  if (!Array.isArray(referenceSamples) || referenceSamples.length < 4) return null;
  const route = routeDistances(referenceSamples);
  return route.total > EPSILON ? { samples: referenceSamples, ...route } : null;
}

function referenceFractionAt(reference, point, tangent) {
  if (!reference) return null;
  const tangentLength = Math.hypot(tangent.x, tangent.y) || 1;
  const tx = tangent.x / tangentLength;
  const ty = tangent.y / tangentLength;
  let bestScore = Infinity;
  let bestFraction = null;
  for (let index = 0; index < reference.samples.length; index++) {
    const nextIndex = (index + 1) % reference.samples.length;
    const start = reference.samples[index];
    const end = reference.samples[nextIndex];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq < EPSILON) continue;
    const amount = clamp(
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq,
      0,
      1,
    );
    const px = start.x + dx * amount;
    const py = start.y + dy * amount;
    const distanceSq = (point.x - px) ** 2 + (point.y - py) ** 2;
    const segmentLength = Math.sqrt(lengthSq);
    const alignment = Math.abs((dx / segmentLength) * tx + (dy / segmentLength) * ty);
    // Distance decides the branch; tangent alignment only resolves the two
    // coincident segments at the actual crossing.
    const score = distanceSq + (1 - alignment) * 0.00001;
    if (score < bestScore) {
      bestScore = score;
      bestFraction = routeFractionAt(index, amount, reference.distances, reference.total);
    }
  }
  return bestFraction;
}

function canonicalPoint(point, {
  size,
  layoutTransform,
  mirror,
}) {
  const width = Math.max(EPSILON, finite(size?.width, 1));
  const depth = Math.max(EPSILON, finite(size?.depth, 1));
  const normalized = {
    x: 0.5 + finite(point?.x) / width,
    y: 0.5 - finite(point?.y) / depth,
  };
  const layout = layoutTransform || {};
  const occupancy = clamp(finite(layout.occupancy, 1), 0.1, 4);
  const scaleX = clamp(finite(layout.scaleX, 1), 0.1, 4);
  const scaleY = clamp(finite(layout.scaleY, 1), 0.1, 4);
  const authored = {
    x: 0.5 + (normalized.x - 0.5 - finite(layout.offsetX)) / (occupancy * scaleX),
    y: 0.5 + (normalized.y - 0.5 - finite(layout.offsetY)) / (occupancy * scaleY),
  };
  if (mirror) authored.x = 1 - authored.x;
  return {
    x: quantize(authored.x, 100000),
    y: quantize(authored.y, 100000),
  };
}

function branchTurn(samples, index, radius = 5) {
  let sum = 0;
  for (let offset = -radius; offset <= radius; offset++) {
    const at = (index + offset + samples.length) % samples.length;
    const previous = samples[(at - 1 + samples.length) % samples.length];
    const point = samples[at];
    const next = samples[(at + 1) % samples.length];
    const ax = point.x - previous.x;
    const ay = point.y - previous.y;
    const bx = next.x - point.x;
    const by = next.y - point.y;
    const al = Math.hypot(ax, ay) || 1;
    const bl = Math.hypot(bx, by) || 1;
    sum += Math.acos(clamp((ax * bx + ay * by) / (al * bl), -1, 1));
  }
  return sum;
}

function crossingStableId(point, branchA, branchB) {
  const x = Math.round(finite(point?.x) * 2048);
  const y = Math.round(finite(point?.y) * 2048);
  const a = Math.round(mod1(branchA) * 4096) % 4096;
  const b = Math.round(mod1(branchB) * 4096) % 4096;
  return `crossing-${a.toString(36)}-${b.toString(36)}-${x.toString(36)}-${y.toString(36)}`;
}

function rawCrossings(samples, trackWidth, route) {
  const meanStep = route.total / Math.max(1, samples.length);
  const cellSize = Math.max(trackWidth * 1.15, meanStep * 5, 5);
  const hash = new CourseSpatialHash(cellSize);
  const hits = [];
  let segmentPairs = 0;
  for (let index = 0; index < samples.length; index++) {
    const next = (index + 1) % samples.length;
    const a = samples[index];
    const b = samples[next];
    const minX = Math.min(a.x, b.x) - 0.02;
    const minY = Math.min(a.y, b.y) - 0.02;
    const maxX = Math.max(a.x, b.x) + 0.02;
    const maxY = Math.max(a.y, b.y) + 0.02;
    for (const entry of hash.queryBounds(minX, minY, maxX, maxY)) {
      const otherIndex = entry.payload.index;
      if (circularIndexDistance(index, otherIndex, samples.length) <= 3) continue;
      segmentPairs++;
      const c = samples[otherIndex];
      const d = samples[(otherIndex + 1) % samples.length];
      const hit = segmentIntersection(a, b, c, d);
      if (!hit) continue;
      const firstIndex = Math.min(index, otherIndex);
      const secondIndex = Math.max(index, otherIndex);
      const firstAmount = firstIndex === index ? hit.t : hit.u;
      const secondAmount = secondIndex === index ? hit.t : hit.u;
      hits.push({
        segmentA: firstIndex,
        segmentB: secondIndex,
        amountA: firstAmount,
        amountB: secondAmount,
        point: { x: hit.x, y: hit.y },
        angle: angleBetween(a, b, c, d),
      });
    }
    hash.insert(index, minX, minY, maxX, maxY, { index });
  }
  return { hits, cellSize, segmentPairs };
}

function dedupeCrossings(raw, samples, route, context) {
  const meanStep = route.total / Math.max(1, samples.length);
  const worldTolerance = Math.max(0.32, meanStep * 1.35);
  const fractionTolerance = Math.max(4 / Math.max(1, samples.length), 0.0045);
  const prepared = raw.map((hit) => {
    const routeA = routeFractionAt(hit.segmentA, hit.amountA, route.distances, route.total);
    const routeB = routeFractionAt(hit.segmentB, hit.amountB, route.distances, route.total);
    const authoredPoint = canonicalPoint(hit.point, context);
    const branchAStart = canonicalPoint(samples[hit.segmentA], context);
    const branchAEnd = canonicalPoint(samples[(hit.segmentA + 1) % samples.length], context);
    const branchBStart = canonicalPoint(samples[hit.segmentB], context);
    const branchBEnd = canonicalPoint(samples[(hit.segmentB + 1) % samples.length], context);
    const canonicalA = referenceFractionAt(context.canonicalReference, authoredPoint, {
      x: branchAEnd.x - branchAStart.x,
      y: branchAEnd.y - branchAStart.y,
    }) ?? canonicalFraction(routeA, context.startFraction, context.reverse);
    const canonicalB = referenceFractionAt(context.canonicalReference, authoredPoint, {
      x: branchBEnd.x - branchBStart.x,
      y: branchBEnd.y - branchBStart.y,
    }) ?? canonicalFraction(routeB, context.startFraction, context.reverse);
    const orderedA = canonicalA <= canonicalB
      ? { routeFraction: routeA, canonicalFraction: canonicalA, segment: hit.segmentA, amount: hit.amountA }
      : { routeFraction: routeB, canonicalFraction: canonicalB, segment: hit.segmentB, amount: hit.amountB };
    const orderedB = canonicalA <= canonicalB
      ? { routeFraction: routeB, canonicalFraction: canonicalB, segment: hit.segmentB, amount: hit.amountB }
      : { routeFraction: routeA, canonicalFraction: canonicalA, segment: hit.segmentA, amount: hit.amountA };
    return {
      ...hit,
      canonicalPoint: authoredPoint,
      branchA: {
        ...orderedA,
        turn: branchTurn(samples, orderedA.segment),
      },
      branchB: {
        ...orderedB,
        turn: branchTurn(samples, orderedB.segment),
      },
    };
  }).sort((a, b) => (
    a.canonicalPoint.x - b.canonicalPoint.x
    || a.canonicalPoint.y - b.canonicalPoint.y
    || a.branchA.canonicalFraction - b.branchA.canonicalFraction
    || a.branchB.canonicalFraction - b.branchB.canonicalFraction
    || a.segmentA - b.segmentA
    || a.segmentB - b.segmentB
  ));

  const clusters = [];
  for (const candidate of prepared) {
    const existing = clusters.find((cluster) => (
      distance(cluster.representative.point, candidate.point) <= worldTolerance
      && circularFractionDistance(
        cluster.representative.branchA.canonicalFraction,
        candidate.branchA.canonicalFraction,
      ) <= fractionTolerance
      && circularFractionDistance(
        cluster.representative.branchB.canonicalFraction,
        candidate.branchB.canonicalFraction,
      ) <= fractionTolerance
    ));
    if (!existing) {
      clusters.push({ representative: candidate, members: [candidate] });
      continue;
    }
    existing.members.push(candidate);
    const current = existing.representative;
    if (
      candidate.angle > current.angle + EPSILON
      || (
        Math.abs(candidate.angle - current.angle) <= EPSILON
        && (candidate.segmentA < current.segmentA
          || (candidate.segmentA === current.segmentA && candidate.segmentB < current.segmentB))
      )
    ) existing.representative = candidate;
  }

  return clusters.map((cluster) => {
    const candidate = cluster.representative;
    const id = crossingStableId(
      candidate.canonicalPoint,
      candidate.branchA.canonicalFraction,
      candidate.branchB.canonicalFraction,
    );
    return {
      id,
      point: candidate.point,
      canonicalPoint: candidate.canonicalPoint,
      angle: candidate.angle,
      segmentA: candidate.branchA.segment,
      segmentB: candidate.branchB.segment,
      branchA: candidate.branchA,
      branchB: candidate.branchB,
      duplicateCount: cluster.members.length,
      rawSegments: cluster.members.map((member) => [member.segmentA, member.segmentB]),
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

function sanitizePoint(point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return {
    x: clamp(point.x, -0.5, 1.5),
    y: clamp(point.y, -0.5, 1.5),
  };
}

function sanitizeFractions(values) {
  if (!Array.isArray(values) || values.length !== 2 || values.some((value) => !Number.isFinite(value))) return null;
  return [mod1(values[0]), mod1(values[1])].sort((a, b) => a - b);
}

export function sanitizeCrossingOverride(input = {}) {
  const mode = CROSSING_OVERRIDE_MODES.includes(input.mode) ? input.mode : 'auto';
  const preset = BRIDGE_PRESETS[input.preset] ? input.preset : 'standard';
  const branchFractions = sanitizeFractions(input.branchFractions);
  const point = sanitizePoint(input.point || input.canonicalPoint);
  const approachLength = Number.isFinite(input.approachLength)
    ? clamp(input.approachLength, 20, 180)
    : null;
  const overBranchFraction = Number.isFinite(input.overBranchFraction)
    ? mod1(input.overBranchFraction)
    : null;
  return {
    id: String(input.id || '').slice(0, 120),
    mode,
    preset,
    approachLength,
    ...(point ? { point } : {}),
    ...(branchFractions ? { branchFractions } : {}),
    ...(overBranchFraction != null ? { overBranchFraction } : {}),
  };
}

export function sanitizeCrossingOverrides(input = [], limit = 48) {
  if (!Array.isArray(input)) return [];
  const output = [];
  const ids = new Set();
  for (const value of input.slice(0, limit)) {
    if (!value || typeof value !== 'object') continue;
    const override = sanitizeCrossingOverride(value);
    const dedupeKey = override.id || JSON.stringify([
      override.branchFractions,
      override.point,
      override.mode,
    ]);
    if (ids.has(dedupeKey)) continue;
    ids.add(dedupeKey);
    output.push(override);
  }
  return output;
}

function overrideMatchCost(override, candidate) {
  if (override.id && override.id === candidate.id) return 0;
  if (!override.branchFractions || !override.point) return Infinity;
  const fractionCost = (
    circularFractionDistance(override.branchFractions[0], candidate.branchA.canonicalFraction)
    + circularFractionDistance(override.branchFractions[1], candidate.branchB.canonicalFraction)
  );
  const pointCost = distance(override.point, candidate.canonicalPoint);
  if (fractionCost > 0.14 || pointCost > 0.16) return Infinity;
  return fractionCost * 3.2 + pointCost;
}

export function reassociateCrossingOverrides(overrides, candidates) {
  const clean = sanitizeCrossingOverrides(overrides);
  const claimed = new Set();
  const matched = new Map();
  const orphaned = [];
  for (const override of clean) {
    let best = null;
    let bestCost = Infinity;
    for (const candidate of candidates) {
      if (claimed.has(candidate.id)) continue;
      const cost = overrideMatchCost(override, candidate);
      if (cost < bestCost - EPSILON || (
        Math.abs(cost - bestCost) <= EPSILON
        && candidate.id.localeCompare(best?.id || '') < 0
      )) {
        best = candidate;
        bestCost = cost;
      }
    }
    if (!best || !Number.isFinite(bestCost)) {
      orphaned.push({ ...override, warning: 'This crossing no longer exists near its saved route location.' });
      continue;
    }
    claimed.add(best.id);
    matched.set(best.id, {
      ...override,
      id: best.id,
      point: { ...best.canonicalPoint },
      branchFractions: [
        best.branchA.canonicalFraction,
        best.branchB.canonicalFraction,
      ],
      reassociated: override.id !== best.id,
      matchCost: bestCost,
    });
  }
  return { matched, orphaned };
}

function presetValues(id, trackWidth) {
  const preset = BRIDGE_PRESETS[id] || BRIDGE_PRESETS.standard;
  const height = preset.baseHeight + trackWidth * preset.widthHeightFactor;
  const calculatedApproach = height * Math.PI / (2 * preset.maximumGrade);
  const approachLength = Math.max(preset.minimumApproach, calculatedApproach, trackWidth * 2.8);
  return {
    ...preset,
    height,
    approachLength,
    clearance: height - preset.deckDepth,
  };
}

function normalizeFeatureFootprints(features = []) {
  return (Array.isArray(features) ? features : []).flatMap((feature) => {
    const anchor = feature?.anchor || feature;
    if (anchor?.mode !== 'spline' || !Number.isFinite(anchor.fraction)) return [];
    const longitudinal = Math.max(
      1,
      finite(feature?.footprint?.length, finite(feature?.footprintLength, 4)),
    );
    return [{
      id: String(feature.id || feature.featureId || 'feature'),
      fraction: mod1(anchor.fraction),
      halfLength: longitudinal * Math.max(0.2, finite(anchor.scaleZ, 1)) * 0.5,
      bridgePolicy: feature.bridgePolicy || feature.placementRules?.bridgePolicy || 'clear',
    }];
  });
}

function featureConflicts(fraction, approach, routeLength, featureFootprints) {
  const conflicts = [];
  for (const feature of featureFootprints) {
    if (feature.bridgePolicy === 'allow') continue;
    const separation = circularFractionDistance(fraction, feature.fraction) * routeLength;
    if (separation < approach + feature.halfLength + 2) conflicts.push(feature.id);
  }
  return conflicts;
}

function orientationFor(candidate, overBranchName, {
  trackWidth,
  routeLength,
  allowOverpasses,
  override,
  featureFootprints,
}) {
  const over = overBranchName === 'A' ? candidate.branchA : candidate.branchB;
  const under = overBranchName === 'A' ? candidate.branchB : candidate.branchA;
  const preset = presetValues(override?.preset || 'standard', trackWidth);
  const maximumApproach = Math.max(
    0,
    circularFractionDistance(over.routeFraction, under.routeFraction) * routeLength * 0.5
      - trackWidth * 0.9,
  );
  const approachLength = override?.approachLength == null
    ? preset.approachLength
    : clamp(override.approachLength, preset.approachLength, maximumApproach || preset.approachLength);
  const grade = preset.height * Math.PI / (2 * Math.max(EPSILON, approachLength));
  const startClearance = circularFractionDistance(over.routeFraction, 0) * routeLength;
  const nearbyFeatures = featureConflicts(
    over.canonicalFraction,
    approachLength,
    routeLength,
    featureFootprints,
  );
  const reasons = [];
  if (!allowOverpasses) reasons.push('Overpasses are disabled for this course.');
  if (candidate.angle < CROSSING_ANGLE_MIN) {
    reasons.push(`Crossing angle ${(candidate.angle * 180 / Math.PI).toFixed(0)}° is below the safe 30° minimum.`);
  }
  if (maximumApproach < preset.approachLength) {
    reasons.push(
      `${preset.label} needs ${Math.ceil(preset.approachLength)} m approaches; only ${Math.floor(maximumApproach)} m is available.`,
    );
  }
  if (grade > preset.maximumGrade + 0.0005) {
    reasons.push(`Estimated ${(grade * 100).toFixed(1)}% grade exceeds the ${Math.round(preset.maximumGrade * 100)}% preset limit.`);
  }
  if (preset.clearance < MIN_UNDERPASS_CLEARANCE) {
    reasons.push(`Underpass clearance ${preset.clearance.toFixed(1)} m is below the ${MIN_UNDERPASS_CLEARANCE.toFixed(1)} m vehicle envelope.`);
  }
  if (startClearance < approachLength + GRID_RESERVATION_METRES) {
    reasons.push(`Elevated approach overlaps the ${GRID_RESERVATION_METRES} m start-grid reservation.`);
  }
  if (nearbyFeatures.length) {
    reasons.push(`Bridge approach conflicts with ${nearbyFeatures.slice(0, 3).join(', ')}${nearbyFeatures.length > 3 ? '…' : ''}.`);
  }
  const turnAdvantage = clamp(1 - over.turn / Math.max(0.12, over.turn + under.turn), 0, 1);
  const angleScore = clamp((candidate.angle - CROSSING_ANGLE_MIN) / (Math.PI * 0.5 - CROSSING_ANGLE_MIN), 0, 1);
  const approachMargin = clamp((maximumApproach - approachLength) / Math.max(approachLength, 1), 0, 1);
  const startScore = clamp((startClearance - approachLength) / 80, 0, 1);
  const gradeScore = clamp(1 - grade / preset.maximumGrade, 0, 1);
  const clearanceScore = clamp((preset.clearance - MIN_UNDERPASS_CLEARANCE) / 4, 0, 1);
  const manual = override?.mode === `${overBranchName.toLowerCase()}-over-${overBranchName === 'A' ? 'b' : 'a'}`;
  const baseScore = (
    28 * turnAdvantage
    + 20 * angleScore
    + 18 * approachMargin
    + 13 * startScore
    + 13 * gradeScore
    + 8 * clearanceScore
  );
  const tieBreak = (candidate.id.charCodeAt(candidate.id.length - 1) % 17) * 0.00001
    + (overBranchName === 'A' ? 0.000002 : 0.000001);
  return {
    id: `${candidate.id}:${overBranchName.toLowerCase()}-over-${overBranchName === 'A' ? 'b' : 'a'}`,
    candidateId: candidate.id,
    mode: `${overBranchName.toLowerCase()}-over-${overBranchName === 'A' ? 'b' : 'a'}`,
    overBranch: overBranchName,
    underBranch: overBranchName === 'A' ? 'B' : 'A',
    over,
    under,
    preset: preset.id,
    presetLabel: preset.label,
    height: preset.height,
    deckDepth: preset.deckDepth,
    clearance: preset.clearance,
    approachLength,
    maximumApproach,
    grade,
    startClearance,
    nearbyFeatures,
    valid: reasons.length === 0,
    reasons,
    manual,
    score: baseScore + (manual ? 10000 : 0) + tieBreak,
    worldVolume: {
      x: candidate.point.x,
      y: candidate.point.y,
      radius: trackWidth * 0.72 + preset.supportRadius,
    },
    routeInterval: {
      center: over.canonicalFraction,
      half: approachLength / Math.max(EPSILON, routeLength),
    },
  };
}

function intervalsOverlap(a, b) {
  return circularFractionDistance(a.center, b.center) < a.half + b.half - 1e-5;
}

function orientationConflict(a, b, trackWidth) {
  if (a.candidateId === b.candidateId) return 'Only one branch can be elevated at a crossing.';
  if (intervalsOverlap(a.routeInterval, b.routeInterval)) {
    return 'Elevated approach intervals overlap on the same route; shorten or move one bridge.';
  }
  const volumeDistance = Math.hypot(
    a.worldVolume.x - b.worldVolume.x,
    a.worldVolume.y - b.worldVolume.y,
  );
  if (volumeDistance < Math.max(
    trackWidth * 1.45,
    Math.min(a.worldVolume.radius, b.worldVolume.radius),
  )) {
    return 'Bridge support volumes overlap in world space.';
  }
  return '';
}

function maskIndices(mask) {
  const indices = [];
  let remaining = mask;
  let index = 0;
  while (remaining) {
    if (remaining & 1n) indices.push(index);
    remaining >>= 1n;
    index++;
  }
  return indices;
}

function maskSelectionKey(nodes, mask) {
  return maskIndices(mask).map((index) => nodes[index].id).sort().join('|');
}

function betterSelection(nodes, left, right) {
  if (left.score > right.score + EPSILON) return left;
  if (right.score > left.score + EPSILON) return right;
  return maskSelectionKey(nodes, left.mask).localeCompare(maskSelectionKey(nodes, right.mask)) <= 0
    ? left
    : right;
}

function graphComponents(mask, conflicts) {
  const components = [];
  let unseen = mask;
  while (unseen) {
    const seed = unseen & -unseen;
    let frontier = seed;
    let component = 0n;
    unseen &= ~seed;
    while (frontier) {
      const bit = frontier & -frontier;
      frontier &= ~bit;
      component |= bit;
      const index = maskIndices(bit)[0];
      const neighbors = conflicts[index] & unseen;
      unseen &= ~neighbors;
      frontier |= neighbors;
    }
    components.push(component);
  }
  return components;
}

function solveCompatibleSet(nodes, conflicts) {
  if (!nodes.length) return { score: 0, indices: [], ids: [] };
  const fullMask = (1n << BigInt(nodes.length)) - 1n;
  const memo = new Map();
  const solve = (mask) => {
    if (!mask) return { score: 0, mask: 0n };
    const memoKey = mask.toString(36);
    const cached = memo.get(memoKey);
    if (cached) return cached;
    const components = graphComponents(mask, conflicts);
    if (components.length > 1) {
      let combined = { score: 0, mask: 0n };
      for (const component of components) {
        const result = solve(component);
        combined = {
          score: combined.score + result.score,
          mask: combined.mask | result.mask,
        };
      }
      memo.set(memoKey, combined);
      return combined;
    }
    const available = maskIndices(mask);
    let pivot = available[0];
    let pivotDegree = -1;
    let pivotWeight = -Infinity;
    for (const index of available) {
      const degree = maskIndices(conflicts[index] & mask).length;
      if (
        degree > pivotDegree
        || (degree === pivotDegree && nodes[index].score > pivotWeight + EPSILON)
        || (
          degree === pivotDegree
          && Math.abs(nodes[index].score - pivotWeight) <= EPSILON
          && nodes[index].id.localeCompare(nodes[pivot].id) < 0
        )
      ) {
        pivot = index;
        pivotDegree = degree;
        pivotWeight = nodes[index].score;
      }
    }
    const pivotBit = 1n << BigInt(pivot);
    const withoutPivot = mask & ~pivotBit;
    const excluded = solve(withoutPivot);
    const includedTail = solve(withoutPivot & ~conflicts[pivot]);
    const included = {
      score: nodes[pivot].score + includedTail.score,
      mask: pivotBit | includedTail.mask,
    };
    const result = betterSelection(nodes, included, excluded);
    memo.set(memoKey, result);
    return result;
  };
  const result = solve(fullMask);
  const indices = maskIndices(result.mask);
  return {
    score: result.score,
    indices,
    ids: indices.map((index) => nodes[index].id),
  };
}

function solveBoundedPreviewSet(nodes, conflicts) {
  const order = nodes.map((node, index) => ({ node, index })).sort((a, b) => (
    b.node.score - a.node.score
    || maskIndices(conflicts[a.index]).length - maskIndices(conflicts[b.index]).length
    || a.node.id.localeCompare(b.node.id)
  ));
  let blocked = 0n;
  let score = 0;
  const indices = [];
  for (const { node, index } of order) {
    const bit = 1n << BigInt(index);
    if (blocked & bit) continue;
    indices.push(index);
    score += node.score;
    blocked |= conflicts[index] | bit;
  }
  indices.sort((a, b) => a - b);
  return {
    score,
    indices,
    ids: indices.map((index) => nodes[index].id),
  };
}

function candidateRejection(candidate, orientations, selectedNodes, conflictReasons, override) {
  if (override?.mode === 'flat') return ['Player marked this crossing FLAT / INVALID.'];
  if (override?.mode === 'a-over-b' || override?.mode === 'b-over-a') {
    const requested = orientations.find((orientation) => orientation.mode === override.mode);
    if (requested && !requested.valid) return [...new Set(requested.reasons)];
  }
  const valid = orientations.filter((orientation) => orientation.valid);
  if (!valid.length) return [...new Set(orientations.flatMap((orientation) => orientation.reasons))];
  const reasons = [];
  for (const orientation of valid) {
    for (const selected of selectedNodes) {
      const key = [orientation.id, selected.id].sort().join('|');
      const reason = conflictReasons.get(key);
      if (reason) reasons.push(`${orientation.presetLabel}: ${reason}`);
    }
  }
  return reasons.length
    ? [...new Set(reasons)]
    : ['A higher-scoring compatible bridge set was selected globally.'];
}

export function solveDrawTrackCrossings({
  samples = [],
  trackWidth = 9.2,
  length = null,
  allowOverpasses = true,
  startFraction = 0,
  reverse = false,
  mirror = false,
  size = null,
  layoutTransform = null,
  crossingOverrides = [],
  featurePlacements = [],
  canonicalReferenceSamples = null,
} = {}) {
  if (!Array.isArray(samples) || samples.length < 8) {
    return {
      crossings: [],
      overpasses: [],
      orphanedOverrides: sanitizeCrossingOverrides(crossingOverrides),
      diagnostics: {
        rawCandidates: 0,
        deduplicatedCandidates: 0,
        segmentPairs: 0,
        selected: 0,
      },
    };
  }
  const route = routeDistances(samples);
  const routeLength = Math.max(EPSILON, Number.isFinite(length) ? length : route.total);
  const context = {
    startFraction: mod1(startFraction),
    reverse: !!reverse,
    mirror: !!mirror,
    size: size || { width: 1, depth: 1 },
    layoutTransform,
    canonicalReference: referenceRoute(canonicalReferenceSamples),
  };
  const raw = rawCrossings(samples, trackWidth, route);
  const candidates = dedupeCrossings(raw.hits, samples, route, context);
  const { matched, orphaned } = reassociateCrossingOverrides(crossingOverrides, candidates);
  const featureFootprints = normalizeFeatureFootprints(featurePlacements);
  const orientationsByCandidate = new Map();
  const nodes = [];
  for (const candidate of candidates) {
    const override = matched.get(candidate.id);
    const orientations = [
      orientationFor(candidate, 'A', {
        trackWidth,
        routeLength,
        allowOverpasses,
        override,
        featureFootprints,
      }),
      orientationFor(candidate, 'B', {
        trackWidth,
        routeLength,
        allowOverpasses,
        override,
        featureFootprints,
      }),
    ];
    if (override?.mode === 'a-over-b') orientations[1].valid = false;
    if (override?.mode === 'a-over-b') orientations[1].reasons.push('Player selected A OVER B.');
    if (override?.mode === 'b-over-a') orientations[0].valid = false;
    if (override?.mode === 'b-over-a') orientations[0].reasons.push('Player selected B OVER A.');
    if (override?.mode === 'flat') {
      for (const orientation of orientations) {
        orientation.valid = false;
        orientation.reasons.push('Player marked this crossing FLAT / INVALID.');
      }
    }
    orientationsByCandidate.set(candidate.id, orientations);
    for (const orientation of orientations) if (orientation.valid) nodes.push(orientation);
  }

  const conflicts = Array.from({ length: nodes.length }, () => 0n);
  const conflictReasons = new Map();
  for (let left = 0; left < nodes.length; left++) {
    for (let right = left + 1; right < nodes.length; right++) {
      const reason = orientationConflict(nodes[left], nodes[right], trackWidth);
      if (!reason) continue;
      conflicts[left] |= 1n << BigInt(right);
      conflicts[right] |= 1n << BigInt(left);
      conflictReasons.set([nodes[left].id, nodes[right].id].sort().join('|'), reason);
    }
  }
  // An extreme, already non-raceable scribble can contain dozens of tightly
  // coupled crossings. Keep pointer-time diagnostics bounded for that preview;
  // every course inside the permitted length envelope uses the exact global
  // solver. Repairing the length immediately promotes it back to exact mode.
  const extremePreview = (
    Number.isFinite(size?.maxLength)
    && routeLength > size.maxLength * 1.28
  ) || candidates.length > 32;
  const solution = extremePreview
    ? solveBoundedPreviewSet(nodes, conflicts)
    : solveCompatibleSet(nodes, conflicts);
  const selectedNodes = solution.indices.map((index) => nodes[index]);
  const selectedByCandidate = new Map(selectedNodes.map((orientation) => [orientation.candidateId, orientation]));

  const crossings = candidates.map((candidate) => {
    const override = matched.get(candidate.id) || null;
    const orientations = orientationsByCandidate.get(candidate.id) || [];
    const selected = selectedByCandidate.get(candidate.id) || null;
    const rejectionReasons = selected
      ? []
      : candidateRejection(candidate, orientations, selectedNodes, conflictReasons, override);
    const over = selected?.over || null;
    const under = selected?.under || null;
    return {
      ...candidate,
      override,
      orientations,
      selectedOrientation: selected,
      bridgeable: !!selected,
      rejectionReasons,
      conflictExplanation: rejectionReasons[0] || '',
      overIndex: over?.segment ?? null,
      underIndex: under?.segment ?? null,
      fraction: over?.routeFraction ?? null,
      underFraction: under?.routeFraction ?? null,
      canonicalFraction: over?.canonicalFraction ?? null,
      canonicalUnderFraction: under?.canonicalFraction ?? null,
      height: selected?.height ?? null,
      clearance: selected?.clearance ?? null,
      approachLength: selected?.approachLength
        ?? Math.min(...orientations.map((orientation) => orientation.approachLength || Infinity)),
      grade: selected?.grade ?? null,
      preset: selected?.preset || override?.preset || 'standard',
      score: selected?.score ?? Math.max(0, ...orientations.map((orientation) => orientation.score || 0)),
    };
  });
  return {
    crossings,
    overpasses: crossings.filter((crossing) => crossing.bridgeable),
    overrides: [...matched.values()],
    orphanedOverrides: orphaned,
    diagnostics: {
      rawCandidates: raw.hits.length,
      deduplicatedCandidates: crossings.length,
      duplicateCandidatesRemoved: raw.hits.length - crossings.length,
      segmentPairs: raw.segmentPairs,
      spatialCellSize: raw.cellSize,
      orientationNodes: nodes.length,
      conflictEdges: conflictReasons.size,
      selected: selectedNodes.length,
      solutionScore: solution.score,
      solver: extremePreview ? 'bounded-invalid-preview' : 'exact-global',
    },
  };
}

export function createCrossingOverride(crossing, {
  mode = 'auto',
  preset = 'standard',
  approachLength = null,
} = {}) {
  if (!crossing?.id) throw new Error('A detected crossing is required');
  const normalizedMode = CROSSING_OVERRIDE_MODES.includes(mode) ? mode : 'auto';
  const overBranchFraction = normalizedMode === 'a-over-b'
    ? crossing.branchA?.canonicalFraction
    : normalizedMode === 'b-over-a'
      ? crossing.branchB?.canonicalFraction
      : null;
  return sanitizeCrossingOverride({
    id: crossing.id,
    mode: normalizedMode,
    preset,
    approachLength,
    point: crossing.canonicalPoint,
    branchFractions: [
      crossing.branchA?.canonicalFraction,
      crossing.branchB?.canonicalFraction,
    ],
    overBranchFraction,
  });
}

export function crossingGradePercent(crossing) {
  return Math.max(0, finite(crossing?.grade) * 100);
}

export function crossingAngleDegrees(crossing) {
  return clamp(finite(crossing?.angle) * 180 / Math.PI, 0, 90);
}

export function bridgePresetFor(id) {
  return BRIDGE_PRESETS[id] || BRIDGE_PRESETS.standard;
}
