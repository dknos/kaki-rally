/**
 * Authored Drift Attack data. The venue and cars are deliberately data-first:
 * the normal Kaki racing lifecycle still owns rendering, input, physics, and
 * teardown. This module only describes the discipline's identity and judge.
 */

const TAU = Math.PI * 2;

function freezePoints(points) {
  return Object.freeze(points.map((point) => Object.freeze([...point])));
}

function wrapFraction(value) {
  return ((Number(value) || 0) % 1 + 1) % 1;
}

function inRange(fraction, from, to) {
  const f = wrapFraction(fraction);
  const start = wrapFraction(from);
  const end = wrapFraction(to);
  return start <= end ? f >= start && f <= end : f >= start || f <= end;
}

function freezeZone(zone, index) {
  return Object.freeze({
    id: String(zone.id || `zone-${index + 1}`),
    label: String(zone.label || zone.id || `Zone ${index + 1}`),
    kind: String(zone.kind || 'clipping'),
    from: wrapFraction(zone.from),
    to: wrapFraction(zone.to),
    targetLateral: Number(zone.targetLateral) || 0,
    width: Math.max(0.35, Number(zone.width) || 1.2),
    targetSpeed: Math.max(8, Number(zone.targetSpeed) || 16),
  });
}

function freezeLayout(id, values) {
  return Object.freeze({
    id,
    venue: 'whisker-yard',
    name: values.name,
    shortName: values.shortName || values.name,
    subtitle: values.subtitle,
    description: values.description,
    chapter: 'Whisker Yard',
    artCourseId: 'twilight',
    trackWidth: values.trackWidth || 10.8,
    samples: values.samples || 256,
    laps: 99,
    points: freezePoints(values.points),
    zones: Object.freeze((values.zones || []).map(freezeZone)),
    initiationFractions: Object.freeze((values.initiationFractions || []).map(wrapFraction)),
    targetSpeed: Number(values.targetSpeed) || 17,
    ...values,
  });
}

export const DRIFT_LAYOUTS = Object.freeze({
  practice: freezeLayout('practice', {
    name: 'Whisker Yard Practice Loop',
    shortName: 'Practice Loop',
    subtitle: 'FLOW LOOP · LEARN THE LINK',
    description: 'A forgiving loop with a long initiation lane, two open clipping points, and a clean return into the paddock.',
    trackWidth: 11.6,
    targetSpeed: 16,
    points: [
      [-58, -9], [-45, -35], [-13, -48], [24, -44], [54, -23],
      [63, 5], [46, 32], [13, 46], [-24, 42], [-54, 21],
    ],
    initiationFractions: [0.06, 0.53],
    zones: [
      { id: 'dock-init', label: 'Dock initiation', kind: 'initiation', from: 0.035, to: 0.13, targetLateral: 0, width: 2.1, targetSpeed: 17 },
      { id: 'blue-apex', label: 'Blue apex', kind: 'clipping', from: 0.18, to: 0.28, targetLateral: 2.1, width: 1.25, targetSpeed: 18 },
      { id: 'lantern-apex', label: 'Lantern apex', kind: 'clipping', from: 0.56, to: 0.66, targetLateral: -2.15, width: 1.25, targetSpeed: 18 },
      { id: 'return-zone', label: 'Return zone', kind: 'outside', from: 0.78, to: 0.91, targetLateral: 3.4, width: 1.8, targetSpeed: 16 },
    ],
  }),
  judged: freezeLayout('judged', {
    name: 'Whisker Yard Judged Run',
    shortName: 'Judged Run',
    subtitle: 'QUALIFYING LINE · FOUR ZONES',
    description: 'The competition route: decisive initiation, paired clipping points, a fast transition, and a marked finish box.',
    trackWidth: 10.2,
    targetSpeed: 19,
    points: [
      [-65, -22], [-42, -47], [-3, -54], [33, -46], [66, -20],
      [51, 3], [70, 29], [31, 51], [-4, 38], [-38, 55],
      [-69, 28], [-49, 2],
    ],
    initiationFractions: [0.04],
    zones: [
      { id: 'judge-init', label: 'Judge initiation', kind: 'initiation', from: 0.025, to: 0.105, targetLateral: 0, width: 1.8, targetSpeed: 20 },
      { id: 'judge-one', label: 'Clipping point one', kind: 'clipping', from: 0.16, to: 0.235, targetLateral: 2.4, width: 0.9, targetSpeed: 21 },
      { id: 'judge-two', label: 'Clipping point two', kind: 'clipping', from: 0.42, to: 0.505, targetLateral: -2.5, width: 0.9, targetSpeed: 20 },
      { id: 'judge-transition', label: 'Transition gate', kind: 'transition', from: 0.57, to: 0.66, targetLateral: 0, width: 1.5, targetSpeed: 22 },
      { id: 'judge-outside', label: 'Outside zone', kind: 'outside', from: 0.73, to: 0.88, targetLateral: 3.6, width: 1.4, targetSpeed: 18 },
    ],
  }),
  wallrun: freezeLayout('wallrun', {
    name: 'Whisker Yard Wall Run',
    shortName: 'Wall Run',
    subtitle: 'ELEVATED SPEED · COMMITMENT LINE',
    description: 'A faster outer route with a raised wall section, a blind transition, and a wide runoff that rewards commitment.',
    trackWidth: 12.4,
    targetSpeed: 22,
    points: [
      [-74, -5], [-62, -35], [-27, -57], [18, -58], [58, -37],
      [77, -4], [61, 25], [75, 54], [35, 68], [-6, 53],
      [-48, 65], [-77, 35], [-62, 12],
    ],
    initiationFractions: [0.035, 0.47],
    zones: [
      { id: 'wall-init', label: 'Wall initiation', kind: 'initiation', from: 0.02, to: 0.085, targetLateral: 0, width: 2, targetSpeed: 22 },
      { id: 'wall-clipping', label: 'Wall clip', kind: 'clipping', from: 0.18, to: 0.27, targetLateral: 3.7, width: 1.15, targetSpeed: 24 },
      { id: 'wall-transition', label: 'Blind transition', kind: 'transition', from: 0.42, to: 0.53, targetLateral: 0, width: 1.7, targetSpeed: 23 },
      { id: 'wall-exit', label: 'Wall exit', kind: 'outside', from: 0.62, to: 0.79, targetLateral: -3.8, width: 1.7, targetSpeed: 21 },
    ],
  }),
});
export const DRIFT_LAYOUT_ORDER = Object.freeze(['practice', 'judged', 'wallrun']);

const tuning = (values) => Object.freeze({
  mass: values.mass,
  weightBias: values.weightBias,
  wheelbase: values.wheelbase,
  steeringLock: values.steeringLock,
  transitionRate: values.transitionRate,
  engineCharacter: values.engineCharacter,
  ...values,
});

export const DRIFT_CAR_PROFILES = Object.freeze({
  needle: Object.freeze({
    id: 'needle',
    name: 'Needle Cat',
    shortName: 'Needle',
    archetype: 'Lightweight short-wheelbase RWD coupe',
    description: 'Quick rotation, narrow recovery window, and the clearest reward for a precise lift or handbrake entry.',
    color: 0x74d9d0,
    accent: 0xffd26e,
    tuning: tuning({
      mass: 0.82, weightBias: 0.56, wheelbase: 2.24, steeringLock: 0.92,
      transitionRate: 1.18, engineCharacter: 'high-rev',
      acceleration: 20.8, maxSpeed: 28.4, boostSpeed: 35.6,
      steeringResponse: 15.8, steeringReturn: 13.8, steerRate: 2.08,
      driftSteerRate: 2.92, highSpeedSteerScale: 0.71,
      roadGrip: 9.15, driftGrip: 1.72, driftLateralBuild: 0.92,
      handbrakeLateralBuild: 1.24, rollingResistance: 0.37,
      aerodynamicDrag: 0.007, engineBraking: 0.16,
      powertrain: Object.freeze({ mass: 1320, peakTorque: 620, tractionLimit: 18.7, wheelRadius: 0.33, finalDrive: 4.4, gearRatios: Object.freeze([3.1, 2.08, 1.52, 1.18, 0.92]), shiftSpeeds: Object.freeze([8.2, 14.8, 20.5, 25.2]) }),
    }),
  }),
  comet: Object.freeze({
    id: 'comet',
    name: 'Comet 94',
    shortName: 'Comet',
    archetype: 'Balanced turbocharged 90s-style coupe',
    description: 'A forgiving breakaway, smooth turbo torque, and enough steering authority to learn linked transitions.',
    color: 0xff6e91,
    accent: 0x75c8ff,
    tuning: tuning({
      mass: 1.0, weightBias: 0.52, wheelbase: 2.58, steeringLock: 0.82,
      transitionRate: 0.98, engineCharacter: 'turbo-mid',
      acceleration: 21.2, maxSpeed: 29.8, boostSpeed: 36.8,
      steeringResponse: 14.4, steeringReturn: 12.5, steerRate: 1.9,
      driftSteerRate: 2.56, highSpeedSteerScale: 0.66,
      roadGrip: 9.0, driftGrip: 1.98, driftLateralBuild: 0.76,
      handbrakeLateralBuild: 1.1, rollingResistance: 0.42,
      aerodynamicDrag: 0.0075, engineBraking: 0.12,
      powertrain: Object.freeze({ mass: 1480, peakTorque: 790, tractionLimit: 20.2, wheelRadius: 0.35, finalDrive: 4.05, gearRatios: Object.freeze([3.18, 2.12, 1.54, 1.16, 0.88]), shiftSpeeds: Object.freeze([9, 15.8, 21.7, 27.1]) }),
    }),
  }),
  monarch: Object.freeze({
    id: 'monarch',
    name: 'Monarch X',
    shortName: 'Monarch',
    archetype: 'Long-wheelbase high-power professional drift car',
    description: 'Big commitment, huge angle, and a calm chassis that lets an expert carry speed through the wall run.',
    color: 0xffb04f,
    accent: 0xff6b9f,
    tuning: tuning({
      mass: 1.22, weightBias: 0.49, wheelbase: 2.86, steeringLock: 1.08,
      transitionRate: 0.78, engineCharacter: 'v8-surge',
      acceleration: 23.8, maxSpeed: 32.6, boostSpeed: 39.4,
      steeringResponse: 12.6, steeringReturn: 10.3, steerRate: 1.66,
      driftSteerRate: 2.32, highSpeedSteerScale: 0.61,
      roadGrip: 8.62, driftGrip: 2.24, driftLateralBuild: 0.61,
      handbrakeLateralBuild: 0.92, rollingResistance: 0.5,
      aerodynamicDrag: 0.0088, engineBraking: 0.08,
      powertrain: Object.freeze({ mass: 1860, peakTorque: 1080, tractionLimit: 23.5, wheelRadius: 0.37, finalDrive: 3.72, gearRatios: Object.freeze([2.94, 1.98, 1.46, 1.08, 0.8]), shiftSpeeds: Object.freeze([9.7, 17.2, 24.5, 30.1]) }),
    }),
  }),
});

export const DRIFT_CAR_ORDER = Object.freeze(['needle', 'comet', 'monarch']);

export function getDriftCarProfile(id = 'comet') {
  return DRIFT_CAR_PROFILES[id] || DRIFT_CAR_PROFILES.comet;
}

export function getDriftLayout(id = 'judged') {
  return DRIFT_LAYOUTS[id] || DRIFT_LAYOUTS.judged;
}

export function getDriftHandlingProfile(id = 'comet') {
  return getDriftCarProfile(id).tuning;
}

function fractionForIndex(index, sampleCount) {
  return wrapFraction(Number(index) / Math.max(1, sampleCount));
}

function activeZone(layout, fraction) {
  return layout.zones.find((zone) => inRange(fraction, zone.from, zone.to)) || null;
}

function angleQuality(angle) {
  const target = 0.43;
  const distance = Math.abs(angle - target);
  return Math.max(0, 1 - distance / 0.48);
}

function lineQuality(lateral, zone) {
  if (!zone) return 0.55;
  return Math.max(0, 1 - Math.abs(lateral - zone.targetLateral) / zone.width);
}

export function createDriftJudgeState(layoutId = 'judged') {
  return {
    layoutId,
    score: 0,
    combo: 1,
    comboTime: 0,
    line: 0,
    angle: 0,
    speed: 0,
    style: 0,
    zoneCoverage: 0,
    zonesHit: 0,
    zones: Object.create(null),
    initiations: 0,
    transitions: 0,
    corrections: 0,
    collisions: 0,
    spins: 0,
    straightTime: 0,
    lastDrifting: false,
    lastZoneId: '',
    lastEvent: 'FIND THE INITIATION BOX',
    lastEventTime: 0,
    breakdown: null,
  };
}

/**
 * Score one fixed physics interval. The judge rewards line, angle, speed,
 * initiation, and transitions together; a stationary steering wiggle cannot
 * generate score because it needs grounded speed and real lateral slip.
 */
export function stepDriftJudge(judge, {
  dt,
  physics,
  contact,
  layout,
  sampleCount,
} = {}) {
  if (!judge || !physics || !(dt > 0)) return { points: 0, zone: null };
  const fraction = fractionForIndex(physics.nearestIndex, sampleCount);
  const zone = activeZone(layout, fraction);
  const drifting = !!physics.drifting && physics.grounded && physics.speed > 7.5;
  const angle = Math.abs(Number(physics.slipAngle) || 0);
  const lateral = Number(contact?.lateralOffset) || 0;
  const speed = Math.max(0, Number(physics.speed) || 0);
  const quality = drifting ? angleQuality(angle) : 0;
  const line = drifting ? lineQuality(lateral, zone) : 0;
  const speedQuality = drifting
    ? Math.max(0, 1 - Math.abs(speed - (zone?.targetSpeed || layout.targetSpeed)) / 14)
    : 0;
  let points = 0;

  if (drifting && quality > 0.08 && speed > 8) {
    const base = dt * speed * (24 + quality * 34) * (0.42 + line * 0.58);
    const zoneBonus = zone?.kind === 'clipping' ? line * 42 * dt : 0;
    points = (base + zoneBonus) * judge.combo;
    judge.score += points;
    judge.line += line * dt;
    judge.angle += quality * dt;
    judge.speed += speedQuality * dt;
    judge.style += (quality * 0.55 + line * 0.3 + speedQuality * 0.15) * dt;
    judge.comboTime = Math.min(5, judge.comboTime + dt);
    judge.combo = Math.min(8, 1 + judge.comboTime / 1.8);
    if (zone) {
      const previous = judge.zones[zone.id] || 0;
      const next = Math.max(previous, line);
      judge.zones[zone.id] = next;
      if (next > 0.72 && previous <= 0.72) {
        judge.zonesHit += 1;
        judge.zoneCoverage += next;
        judge.lastEvent = `${zone.label.toUpperCase()} ${Math.round(next * 100)}%`;
        judge.lastEventTime = 1.35;
      }
    }
    if (!judge.lastDrifting && zone?.kind === 'initiation') {
      judge.initiations += 1;
      judge.lastEvent = 'DECISIVE INITIATION';
      judge.lastEventTime = 1.5;
      judge.combo = Math.min(8, judge.combo + 0.35);
    } else if (judge.lastDrifting && zone?.kind === 'transition') {
      judge.transitions += 1;
      judge.lastEvent = 'FLUID TRANSITION';
      judge.lastEventTime = 1.2;
    }
  } else {
    judge.comboTime = Math.max(0, judge.comboTime - dt * 1.9);
    judge.combo = Math.max(1, 1 + judge.comboTime / 1.8);
    if (physics.grounded && speed > 7.5 && angle < 0.08) judge.straightTime += dt;
  }

  if (judge.lastDrifting && !drifting && angle > 0.78) judge.corrections += 1;
  judge.lastDrifting = drifting;
  judge.lastZoneId = zone?.id || '';
  judge.lineRating = Math.round(Math.min(1, judge.line / Math.max(0.001, judge.comboTime || 1)) * 100);
  judge.angleRating = Math.round(Math.min(1, judge.angle / Math.max(0.001, judge.comboTime || 1)) * 100);
  judge.speedRating = Math.round(Math.min(1, judge.speed / Math.max(0.001, judge.comboTime || 1)) * 100);
  judge.styleRating = Math.round(Math.min(1, judge.style / Math.max(0.001, judge.comboTime || 1)) * 100);
  judge.lastEventTime = Math.max(0, (judge.lastEventTime || 0) - dt);
  return { points, zone, drifting, line, angle, speed, quality, speedQuality };
}

export function noteDriftCollision(judge) {
  if (!judge) return;
  judge.collisions += 1;
  judge.combo = 1;
  judge.comboTime = 0;
  judge.lastEvent = 'CONTACT — COMBO RESET';
  judge.lastEventTime = 1.4;
}

export function finalizeDriftJudge(judge, layout = DRIFT_LAYOUTS.judged) {
  const coverage = layout.zones.length ? judge.zonesHit / layout.zones.length : 0;
  const lineScore = Math.round(Math.min(100, judge.lineRating || 0) * 0.72 + coverage * 28);
  const angleScore = Math.round(Math.min(100, judge.angleRating || 0));
  const speedScore = Math.round(Math.min(100, judge.speedRating || 0));
  const styleScore = Math.round(Math.max(0, Math.min(100,
    (judge.styleRating || 0) + judge.initiations * 7 + judge.transitions * 6
      - judge.corrections * 4 - judge.collisions * 16 - judge.spins * 24,
  )));
  const total = Math.round(Math.max(0, lineScore + angleScore + speedScore + styleScore));
  const grade = total >= 330 ? 'S' : total >= 270 ? 'A' : total >= 205 ? 'B' : total >= 135 ? 'C' : 'D';
  judge.breakdown = Object.freeze({ line: lineScore, angle: angleScore, speed: speedScore, style: styleScore, total, grade, zonesHit: judge.zonesHit, zonesTotal: layout.zones.length });
  return judge.breakdown;
}

export function driftDisciplineSnapshot(judge) {
  return {
    layoutId: judge?.layoutId || 'judged',
    score: Math.round(judge?.score || 0),
    combo: Number((judge?.combo || 1).toFixed(2)),
    line: judge?.lineRating || 0,
    angle: judge?.angleRating || 0,
    speed: judge?.speedRating || 0,
    style: judge?.styleRating || 0,
    zonesHit: judge?.zonesHit || 0,
    initiations: judge?.initiations || 0,
    transitions: judge?.transitions || 0,
    corrections: judge?.corrections || 0,
    collisions: judge?.collisions || 0,
    breakdown: judge?.breakdown || null,
  };
}

export const DRIFT_REFERENCE = Object.freeze({
  judging: Object.freeze(['line', 'angle', 'speed', 'style']),
  venue: 'Whisker Yard',
  note: 'Original Kaki venue; no real-world trade dress or vehicle identity is used.',
});
