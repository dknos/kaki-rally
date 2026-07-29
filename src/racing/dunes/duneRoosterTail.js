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

function qualitySegments(quality) {
  if (quality === 'low') return 12;
  if (quality === 'medium') return 18;
  if (quality === 'ultra') return 32;
  return 24;
}

function createWakeMaterial() {
  const uOpacity = uniform(0.94);
  const alpha = attribute('wakeAlpha', 'float');
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
  material.opacityNode = alpha.mul(uOpacity);
  material.userData.tslMaterialFamily = 'kaki-dune-swept-rooster-tail';
  material.userData.fixedLattice = true;
  return material;
}

/**
 * Four swept tire curtains backed by one fixed lattice. Each history sample is
 * a contact-spine point; vertices are reused and only the small dynamic
 * position/alpha streams change.
 */
export function createDuneRoosterTail(root, {
  quality = 'medium',
  reduceMotion = false,
} = {}) {
  const segments = qualitySegments(quality);
  const vertexCount = WHEEL_COUNT * segments * 2;
  const positions = new Float32Array(vertexCount * 3);
  const alphas = new Float32Array(vertexCount);
  const colors = new Float32Array(vertexCount * 3);
  const indices = [];
  for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
    const base = wheel * segments * 2;
    for (let segment = 0; segment < segments - 1; segment += 1) {
      const current = base + segment * 2;
      const next = current + 2;
      indices.push(current, next, current + 1, current + 1, next, next + 1);
    }
    for (let vertex = 0; vertex < segments * 2; vertex += 1) {
      const colorIndex = (base + vertex) * 3;
      colors[colorIndex] = 1;
      colors[colorIndex + 1] = wheel < 2 ? 0.68 : 0.78;
      colors[colorIndex + 2] = wheel < 2 ? 0.32 : 0.4;
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
    positions,
    alphas,
    sourceX: new Float32Array(historyLength),
    sourceY: new Float32Array(historyLength),
    sourceZ: new Float32Array(historyLength),
    sourceTime: new Float32Array(historyLength),
    velocityX: new Float32Array(historyLength),
    velocityY: new Float32Array(historyLength),
    velocityZ: new Float32Array(historyLength),
    rightX: new Float32Array(historyLength),
    rightZ: new Float32Array(historyLength),
    strength: new Float32Array(historyLength),
    width: new Float32Array(historyLength),
    heads: new Int16Array(WHEEL_COUNT).fill(-1),
    counts: new Int16Array(WHEEL_COUNT),
    time: 0,
    recordAccumulator: 0,
    recordInterval: quality === 'low' ? 1 / 18 : 1 / 26,
    emittedSamples: 0,
    activeCurtains: 0,
    disposed: false,
  };
  return wake;
}

function recordWheel(wake, wheelIndex, sample, kart, strength) {
  const segments = wake.segments;
  const head = (wake.heads[wheelIndex] + 1) % segments;
  wake.heads[wheelIndex] = head;
  wake.counts[wheelIndex] = Math.min(segments, wake.counts[wheelIndex] + 1);
  const index = wheelIndex * segments + head;
  const backward = 0.18 + strength * 0.48;
  const lateral = clamp(sample.lateralSlip, -1.4, 1.4) * 1.25;
  const forwardX = Math.sin(kart.yaw);
  const forwardZ = Math.cos(kart.yaw);
  const rightX = forwardZ;
  const rightZ = -forwardX;
  wake.sourceX[index] = sample.worldX;
  wake.sourceY[index] = sample.support.height + 0.13;
  wake.sourceZ[index] = sample.worldZ;
  wake.sourceTime[index] = wake.time;
  wake.velocityX[index] = -forwardX * kart.speed * backward + rightX * lateral;
  wake.velocityY[index] = 2.1 + strength * 6.6 + Math.max(0, kart.speed - 8) * 0.045;
  wake.velocityZ[index] = -forwardZ * kart.speed * backward + rightZ * lateral;
  wake.rightX[index] = rightX;
  wake.rightZ[index] = rightZ;
  wake.strength[index] = strength;
  wake.width[index] = wake.reduceMotion
    ? 0.24
    : sample.support.surface === 'deep-loose-sand' ? 0.64 : 0.48;
  wake.emittedSamples += 1;
}

export function emitDuneRoosterTail(wake, kart, contact, dt) {
  if (!wake || wake.disposed || !kart?.grounded || !(kart.speed > 3.5)) return 0;
  wake.recordAccumulator += dt;
  if (wake.recordAccumulator < wake.recordInterval) return 0;
  wake.recordAccumulator %= wake.recordInterval;
  let emitted = 0;
  for (let wheelIndex = 0; wheelIndex < contact.wheels.length; wheelIndex += 1) {
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
    recordWheel(wake, wheelIndex, sample, kart, strength);
    emitted += 1;
  }
  return emitted;
}

export function updateDuneRoosterTail(wake, time, windX = 0.7, windZ = 0.3) {
  if (!wake || wake.disposed) return;
  wake.time = Number(time) || 0;
  const positions = wake.positions;
  const alphas = wake.alphas;
  const lifetime = wake.reduceMotion ? 0.48 : 0.92;
  let activeCurtains = 0;
  for (let wheel = 0; wheel < WHEEL_COUNT; wheel += 1) {
    const count = wake.counts[wheel];
    const head = wake.heads[wheel];
    let wheelActive = false;
    for (let segment = 0; segment < wake.segments; segment += 1) {
      const vertex = (wheel * wake.segments + segment) * 2;
      const positionOffset = vertex * 3;
      if (segment >= count || head < 0) {
        alphas[vertex] = 0;
        alphas[vertex + 1] = 0;
        continue;
      }
      const historyIndex = wheel * wake.segments
        + ((head - segment) % wake.segments + wake.segments) % wake.segments;
      const age = Math.max(0, wake.time - wake.sourceTime[historyIndex]);
      if (age > lifetime) {
        alphas[vertex] = 0;
        alphas[vertex + 1] = 0;
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
      const width = wake.width[historyIndex] * (0.8 + normalizedAge * 2.2);
      const rightX = wake.rightX[historyIndex];
      const rightZ = wake.rightZ[historyIndex];
      positions[positionOffset] = x - rightX * width;
      positions[positionOffset + 1] = y;
      positions[positionOffset + 2] = z - rightZ * width;
      positions[positionOffset + 3] = x + rightX * width;
      positions[positionOffset + 4] = y + width * (0.65 + normalizedAge * 1.1);
      positions[positionOffset + 5] = z + rightZ * width;
      const alpha = Math.pow(1 - normalizedAge, 1.45) * strength;
      alphas[vertex] = alpha;
      alphas[vertex + 1] = alpha * 0.72;
      wheelActive = true;
    }
    if (wheelActive) activeCurtains += 1;
  }
  wake.activeCurtains = activeCurtains;
  wake.geometry.attributes.position.needsUpdate = true;
  wake.geometry.attributes.wakeAlpha.needsUpdate = true;
}

export function duneRoosterTailSnapshot(wake) {
  return {
    quality: wake?.quality || '',
    fixedLattice: true,
    segmentsPerWheel: wake?.segments || 0,
    activeCurtains: wake?.activeCurtains || 0,
    emittedSamples: wake?.emittedSamples || 0,
    vertexCapacity: wake?.positions?.length / 3 || 0,
  };
}

export function disposeDuneRoosterTail(wake) {
  if (!wake || wake.disposed) return;
  wake.disposed = true;
  wake.mesh.parent?.remove(wake.mesh);
  wake.geometry.dispose();
  wake.material.dispose();
}
