import {
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Mesh,
  MeshBasicNodeMaterial,
  NormalBlending,
} from 'three/webgpu';
import { attribute, uniform } from 'three/tsl';
import { clamp } from '../physics.js';

const WHEEL_COUNT = 4;
const WAKE_ROWS = 5;

function qualitySegments(quality) {
  if (quality === 'low') return 12;
  if (quality === 'medium') return 18;
  if (quality === 'ultra') return 32;
  return 24;
}

function createWakeMaterial() {
  const uOpacity = uniform(0.58);
  const alpha = attribute('wakeAlpha', 'float');
  const color = attribute('color', 'vec3');
  const material = new MeshBasicNodeMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: NormalBlending,
    side: DoubleSide,
    fog: true,
  });
  material.name = 'KakiDuneSweptRoosterTailNodeMaterial';
  material.colorNode = color;
  material.opacityNode = alpha.mul(uOpacity);
  material.userData.tslMaterialFamily = 'kaki-dune-swept-rooster-tail';
  material.userData.fixedLattice = true;
  return material;
}

/**
 * Four swept tire surfaces backed by one fixed lattice. Each history sample is
 * a contact-spine point with a curved five-row cross-section; vertices are
 * reused and only the small dynamic position/alpha streams change.
 */
export function createDuneRoosterTail(root, {
  quality = 'medium',
  reduceMotion = false,
} = {}) {
  const segments = qualitySegments(quality);
  const vertexCount = WHEEL_COUNT * segments * WAKE_ROWS;
  const positions = new Float32Array(vertexCount * 3);
  const alphas = new Float32Array(vertexCount);
  const colors = new Float32Array(vertexCount * 3);
  const indices = [];
  for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
    const base = wheel * segments * WAKE_ROWS;
    for (let segment = 0; segment < segments - 1; segment += 1) {
      for (let row = 0; row < WAKE_ROWS - 1; row += 1) {
        const current = base + segment * WAKE_ROWS + row;
        const next = current + WAKE_ROWS;
        indices.push(current, next, current + 1, current + 1, next, next + 1);
      }
    }
    for (let segment = 0; segment < segments; segment += 1) {
      for (let row = 0; row < WAKE_ROWS; row += 1) {
        const t = row / (WAKE_ROWS - 1);
        const colorIndex = (base + segment * WAKE_ROWS + row) * 3;
        colors[colorIndex] = 0.84 + t * 0.14;
        colors[colorIndex + 1] = 0.43 + t * 0.3;
        colors[colorIndex + 2] = 0.14 + t * 0.24;
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.name = 'KakiDuneSweptWakeFixedLattice';
  const positionAttribute = new Float32BufferAttribute(positions, 3);
  positionAttribute.setUsage(DynamicDrawUsage);
  const alphaAttribute = new Float32BufferAttribute(alphas, 1);
  alphaAttribute.setUsage(DynamicDrawUsage);
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('wakeAlpha', alphaAttribute);
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  const material = createWakeMaterial();
  const mesh = new Mesh(geometry, material);
  mesh.name = 'KakiDuneSweptRoosterTail';
  mesh.frustumCulled = false;
  mesh.renderOrder = 11;
  root.add(mesh);

  const historyLength = WHEEL_COUNT * segments;
  const wake = {
    mesh,
    geometry,
    material,
    quality,
    segments,
    reduceMotion,
    // Float32BufferAttribute normalizes its input through a fresh typed array.
    // Keep the uploaded streams themselves as runtime authority; mutating the
    // constructor inputs leaves a perfectly valid but permanently flat mesh.
    positions: positionAttribute.array,
    alphas: alphaAttribute.array,
    sourceX: new Float32Array(historyLength),
    sourceY: new Float32Array(historyLength),
    sourceZ: new Float32Array(historyLength),
    sourceTime: new Float32Array(historyLength),
    velocityX: new Float32Array(historyLength),
    velocityY: new Float32Array(historyLength),
    velocityZ: new Float32Array(historyLength),
    rightX: new Float32Array(historyLength),
    rightZ: new Float32Array(historyLength),
    forwardX: new Float32Array(historyLength),
    forwardZ: new Float32Array(historyLength),
    sweepSign: new Float32Array(historyLength),
    strength: new Float32Array(historyLength),
    width: new Float32Array(historyLength),
    heads: new Int16Array(WHEEL_COUNT).fill(-1),
    counts: new Int16Array(WHEEL_COUNT),
    time: 0,
    recordAccumulator: 0,
    recordInterval: quality === 'low' ? 1 / 18 : 1 / 26,
    emittedSamples: 0,
    activeCurtains: 0,
    peakHeight: 0,
    disposed: false,
  };
  return wake;
}

function recordWheel(wake, wheelIndex, sample, contactState, kart, strength) {
  const segments = wake.segments;
  const head = (wake.heads[wheelIndex] + 1) % segments;
  wake.heads[wheelIndex] = head;
  wake.counts[wheelIndex] = Math.min(segments, wake.counts[wheelIndex] + 1);
  const index = wheelIndex * segments + head;
  const backward = 0.16 + strength * 0.36;
  const lateralSlip = clamp(Number(contactState?.lateralSlip) || 0, -1.4, 1.4);
  const wheelSide = wheelIndex < 2 ? -1 : 1;
  const lateral = lateralSlip * 1.2 + wheelSide * (0.9 + strength * 1.4);
  const forwardX = Math.sin(kart.yaw);
  const forwardZ = Math.cos(kart.yaw);
  const rightX = forwardZ;
  const rightZ = -forwardX;
  wake.sourceX[index] = sample.worldX;
  wake.sourceY[index] = sample.support.height + 0.13;
  wake.sourceZ[index] = sample.worldZ;
  wake.sourceTime[index] = wake.time;
  wake.velocityX[index] = -forwardX * kart.speed * backward + rightX * lateral;
  wake.velocityY[index] = 1.45 + strength * 4.8 + Math.max(0, kart.speed - 8) * 0.035;
  wake.velocityZ[index] = -forwardZ * kart.speed * backward + rightZ * lateral;
  wake.rightX[index] = rightX;
  wake.rightZ[index] = rightZ;
  wake.forwardX[index] = forwardX;
  wake.forwardZ[index] = forwardZ;
  wake.sweepSign[index] = Math.abs(lateralSlip) > 0.08
    ? Math.sign(lateralSlip)
    : wheelIndex < 2 ? -1 : 1;
  wake.strength[index] = strength;
  wake.width[index] = wake.reduceMotion
    ? 0.3
    : sample.support.surface === 'deep-loose-sand' ? 0.72 : 0.54;
  wake.emittedSamples += 1;
}

export function emitDuneRoosterTail(wake, kart, contact, dt) {
  if (!wake || wake.disposed || !kart?.grounded || !(kart.speed > 3.5)) return 0;
  wake.recordAccumulator += dt;
  if (wake.recordAccumulator < wake.recordInterval) return 0;
  wake.recordAccumulator %= wake.recordInterval;
  let emitted = 0;
  for (let wheelIndex = 0; wheelIndex < contact.wheels.length; wheelIndex += 1) {
    // Rear tires carry the readable surface wake. Front contacts still deform
    // the terrain and feed both particle populations, but rendering four full
    // sheets stacks into a camera-obscuring wall behind a monster truck.
    if (wheelIndex % 2 === 1) continue;
    const sample = contact.wheels[wheelIndex];
    const state = kart.wheelContacts?.[sample.id];
    if (!state?.grounded) continue;
    const slip = Math.abs(state.longitudinalSlip) * 0.72 + Math.abs(state.lateralSlip) * 0.9;
    const speedStrength = clamp((kart.speed - 3.5) / 21, 0, 1);
    const strength = clamp(
      speedStrength * (0.25 + sample.support.looseness * 0.68)
        + slip * 0.48
        + (kart.boostTime > 0 ? 0.24 : 0),
      0,
      wake.reduceMotion ? 0.72 : 1.25,
    );
    if (!(strength > 0.12)) continue;
    recordWheel(wake, wheelIndex, sample, state, kart, strength);
    emitted += 1;
  }
  return emitted;
}

export function updateDuneRoosterTail(wake, time, windX = 0.7, windZ = 0.3) {
  if (!wake || wake.disposed) return;
  wake.time = Number(time) || 0;
  const positions = wake.positions;
  const alphas = wake.alphas;
  const lifetime = wake.reduceMotion ? 0.5 : 0.96;
  let activeCurtains = 0;
  let peakHeight = 0;
  for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
    const count = wake.counts[wheel];
    const head = wake.heads[wheel];
    let wheelActive = false;
    for (let segment = 0; segment < wake.segments; segment += 1) {
      const vertex = (wheel * wake.segments + segment) * WAKE_ROWS;
      if (segment >= count || head < 0) {
        for (let row = 0; row < WAKE_ROWS; row += 1) {
          const rowVertex = vertex + row;
          alphas[rowVertex] = 0;
          if (segment > 0) {
            const previousOffset = (rowVertex - WAKE_ROWS) * 3;
            const positionOffset = rowVertex * 3;
            positions[positionOffset] = positions[previousOffset];
            positions[positionOffset + 1] = positions[previousOffset + 1];
            positions[positionOffset + 2] = positions[previousOffset + 2];
          }
        }
        continue;
      }
      const historyIndex = wheel * wake.segments
        + ((head - segment) % wake.segments + wake.segments) % wake.segments;
      const age = Math.max(0, wake.time - wake.sourceTime[historyIndex]);
      if (age > lifetime) {
        for (let row = 0; row < WAKE_ROWS; row += 1) {
          const rowVertex = vertex + row;
          alphas[rowVertex] = 0;
          if (segment > 0) {
            const previousOffset = (rowVertex - WAKE_ROWS) * 3;
            const positionOffset = rowVertex * 3;
            positions[positionOffset] = positions[previousOffset];
            positions[positionOffset + 1] = positions[previousOffset + 1];
            positions[positionOffset + 2] = positions[previousOffset + 2];
          }
        }
        continue;
      }
      const strength = wake.strength[historyIndex];
      const normalizedAge = age / lifetime;
      const x = wake.sourceX[historyIndex]
        + wake.velocityX[historyIndex] * age
        + windX * age * age * 0.72;
      const y = wake.sourceY[historyIndex]
        + wake.velocityY[historyIndex] * age
        - 8.4 * age * age * 0.5;
      const z = wake.sourceZ[historyIndex]
        + wake.velocityZ[historyIndex] * age
        + windZ * age * age * 0.72;
      const width = wake.width[historyIndex] * (0.82 + normalizedAge * 1.5);
      const rightX = wake.rightX[historyIndex];
      const rightZ = wake.rightZ[historyIndex];
      const forwardX = wake.forwardX[historyIndex];
      const forwardZ = wake.forwardZ[historyIndex];
      const sweepSign = wake.sweepSign[historyIndex] || 1;
      const ageFade = Math.pow(1 - normalizedAge, 1.32);
      for (let row = 0; row < WAKE_ROWS; row += 1) {
        const t = row / (WAKE_ROWS - 1);
        const cross = t * 2 - 1;
        const arch = Math.sin(Math.PI * t);
        const outside = Math.max(0, sweepSign * cross);
        const lip = outside * outside;
        const grain = Math.sin(historyIndex * 12.9898 + row * 2.173) * 0.5 + 0.5;
        const lateralDistance = cross * width
          + sweepSign * lip * width * 0.46
          + (grain - 0.5) * width * normalizedAge * 0.12;
        const surfaceLift = width
          * (arch * (0.5 + strength * 0.25) + lip * (0.78 + strength * 0.72))
          * (1 - normalizedAge * 0.48)
          * (0.74 + grain * 0.12);
        const curlBack = lip * width * (0.14 + normalizedAge * 0.34);
        const rowVertex = vertex + row;
        const positionOffset = rowVertex * 3;
        positions[positionOffset] = x + rightX * lateralDistance - forwardX * curlBack;
        positions[positionOffset + 1] = y + surfaceLift;
        positions[positionOffset + 2] = z + rightZ * lateralDistance - forwardZ * curlBack;
        alphas[rowVertex] = Math.min(
          1,
          ageFade * strength * (0.48 + arch * 0.28 + lip * 0.18) * (0.8 + grain * 0.2),
        );
        peakHeight = Math.max(peakHeight, surfaceLift);
      }
      wheelActive = true;
    }
    if (wheelActive) activeCurtains += 1;
  }
  wake.activeCurtains = activeCurtains;
  wake.peakHeight = peakHeight;
  wake.geometry.attributes.position.needsUpdate = true;
  wake.geometry.attributes.wakeAlpha.needsUpdate = true;
}

export function duneRoosterTailSnapshot(wake) {
  return {
    quality: wake?.quality || '',
    fixedLattice: true,
    curvedSurface: true,
    bufferAuthorityShared: wake?.geometry?.attributes?.position?.array === wake?.positions
      && wake?.geometry?.attributes?.wakeAlpha?.array === wake?.alphas,
    crossSectionRows: WAKE_ROWS,
    segmentsPerWheel: wake?.segments || 0,
    activeCurtains: wake?.activeCurtains || 0,
    emittedSamples: wake?.emittedSamples || 0,
    vertexCapacity: wake?.positions?.length / 3 || 0,
    peakHeight: wake?.peakHeight || 0,
  };
}

export function disposeDuneRoosterTail(wake) {
  if (!wake || wake.disposed) return;
  wake.disposed = true;
  wake.mesh.parent?.remove(wake.mesh);
  wake.geometry.dispose();
  wake.material.dispose();
}
