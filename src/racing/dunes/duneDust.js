import {
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshBasicNodeMaterial,
  NormalBlending,
  Object3D,
  OctahedronGeometry,
} from 'three/webgpu';
import { attribute, uniform } from 'three/tsl';
import { clamp } from '../physics.js';

const _object = new Object3D();
const _color = new Color();

function capacityFor(quality) {
  if (quality === 'low') return 72;
  if (quality === 'medium') return 128;
  if (quality === 'ultra') return 280;
  return 196;
}

function hash(index, serial) {
  let value = Math.imul((index + 1) ^ serial, 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967295;
}

function createDustMaterial() {
  const opacity = uniform(0.76);
  const alpha = attribute('instanceAlpha', 'float');
  const material = new MeshBasicNodeMaterial({
    color: new Color(0xffffff),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: true,
    blending: NormalBlending,
  });
  material.name = 'KakiDunePooledDustNodeMaterial';
  material.opacityNode = alpha.mul(opacity);
  material.userData.tslMaterialFamily = 'kaki-dune-pooled-dust';
  return material;
}

export function createDuneDust(root, {
  quality = 'medium',
  reduceMotion = false,
} = {}) {
  const capacity = capacityFor(quality);
  const geometry = new OctahedronGeometry(0.16, 0);
  geometry.name = 'KakiDuneAngularSandGrain';
  const alpha = new InstancedBufferAttribute(new Float32Array(capacity), 1);
  alpha.setUsage(DynamicDrawUsage);
  geometry.setAttribute('instanceAlpha', alpha);
  const material = createDustMaterial();
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.name = 'KakiDuneDustAndBallisticSandPool';
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  mesh.instanceColor.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 12;
  root.add(mesh);
  for (let index = 0; index < capacity; index += 1) {
    _object.position.set(0, -999, 0);
    _object.scale.setScalar(0);
    _object.updateMatrix();
    mesh.setMatrixAt(index, _object.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return {
    mesh,
    geometry,
    material,
    alpha,
    quality,
    reduceMotion,
    capacity,
    cursor: 0,
    serial: 1,
    active: new Uint8Array(capacity),
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    z: new Float32Array(capacity),
    vx: new Float32Array(capacity),
    vy: new Float32Array(capacity),
    vz: new Float32Array(capacity),
    age: new Float32Array(capacity),
    life: new Float32Array(capacity),
    size: new Float32Array(capacity),
    spin: new Float32Array(capacity),
    kind: new Uint8Array(capacity),
    emissionBudget: 0,
    ambientBudget: 0,
    spawned: 0,
    activeCount: 0,
    disposed: false,
  };
}

function spawn(pool, {
  x,
  y,
  z,
  vx,
  vy,
  vz,
  life,
  size,
  kind = 0,
  color = 0xe3a25b,
}) {
  const index = pool.cursor;
  pool.cursor = (pool.cursor + 1) % pool.capacity;
  pool.active[index] = 1;
  pool.x[index] = x;
  pool.y[index] = y;
  pool.z[index] = z;
  pool.vx[index] = vx;
  pool.vy[index] = vy;
  pool.vz[index] = vz;
  pool.age[index] = 0;
  pool.life[index] = life;
  pool.size[index] = size;
  pool.spin[index] = (hash(index, pool.serial) * 2 - 1) * 4;
  pool.kind[index] = kind;
  pool.alpha.array[index] = 1;
  _color.setHex(color);
  pool.mesh.setColorAt(index, _color);
  pool.serial += 1;
  pool.spawned += 1;
  return index;
}

export function emitDuneDust(pool, kart, contact, controls, events, dt) {
  if (!pool || pool.disposed || !kart || !(dt > 0)) return 0;
  if (!kart.grounded || !(kart.speed > 1.2)) return 0;
  const baseRate = pool.quality === 'low' ? 15 : pool.quality === 'medium' ? 28 : 42;
  pool.emissionBudget += dt * baseRate * clamp(
    0.12
      + kart.speed / 24
      + Math.abs(kart.lateralSpeed) / 8
      + kart.wheelSlip * 1.4
      + (kart.boostTime > 0 ? 0.5 : 0),
    0,
    2.8,
  );
  const count = Math.min(pool.reduceMotion ? 2 : 7, Math.floor(pool.emissionBudget));
  pool.emissionBudget -= count;
  if (!(count > 0)) return 0;
  const forwardX = Math.sin(kart.yaw);
  const forwardZ = Math.cos(kart.yaw);
  const rightX = forwardZ;
  const rightZ = -forwardX;
  for (let particle = 0; particle < count; particle += 1) {
    const wheel = contact.wheels[(pool.serial + particle) % contact.wheels.length];
    const state = kart.wheelContacts?.[wheel.id];
    if (!state?.grounded) continue;
    const randomA = hash(pool.cursor, pool.serial);
    const randomB = hash(pool.cursor + 7, pool.serial + 13);
    const slipSide = clamp(state.lateralSlip, -1, 1);
    const churn = clamp(state.longitudinalSlip + Math.abs(slipSide), 0, 1.8);
    const backward = kart.speed * (0.08 + randomA * 0.18 + churn * 0.16);
    const lateral = (randomB * 2 - 1) * (0.7 + churn * 1.4) + slipSide * 2.1;
    const ballistic = churn > 0.52 || kart.boostTime > 0;
    spawn(pool, {
      x: wheel.worldX + (randomA - 0.5) * 0.32,
      y: wheel.support.height + 0.08,
      z: wheel.worldZ + (randomB - 0.5) * 0.32,
      vx: -forwardX * backward + rightX * lateral,
      vy: ballistic ? 2.2 + randomB * 3.8 : 0.45 + randomB * 1.25,
      vz: -forwardZ * backward + rightZ * lateral,
      life: ballistic ? 0.62 + randomA * 0.62 : 0.85 + randomA * 0.75,
      size: ballistic ? 0.11 + randomB * 0.19 : 0.28 + randomB * 0.52,
      kind: ballistic ? 1 : 0,
      color: wheel.support.surface === 'packed-sand' ? 0xb97b49 : 0xe2a15c,
    });
  }
  if (events?.landed && events.landingSpeed > 5) {
    emitDuneLandingBurst(pool, kart, contact, events.landingSpeed);
  }
  return count;
}

export function emitDuneLandingBurst(pool, kart, contact, landingSpeed = 8) {
  const count = Math.min(pool.reduceMotion ? 5 : 14, Math.round(landingSpeed * 0.72));
  for (let index = 0; index < count; index += 1) {
    const angle = index / count * Math.PI * 2 + hash(index, pool.serial) * 0.4;
    const wheel = contact.wheels[index % contact.wheels.length];
    const speed = 1.5 + hash(index + 11, pool.serial) * 4.2;
    spawn(pool, {
      x: wheel.worldX,
      y: wheel.support.height + 0.1,
      z: wheel.worldZ,
      vx: Math.cos(angle) * speed,
      vy: 1.1 + hash(index + 5, pool.serial) * 2.8,
      vz: Math.sin(angle) * speed,
      life: 0.7 + hash(index + 17, pool.serial) * 0.55,
      size: 0.24 + hash(index + 19, pool.serial) * 0.42,
      kind: 1,
      color: 0xf0b66f,
    });
  }
  return count;
}

export function emitAmbientDuneDust(pool, kart, dt, windStrength = 0.35) {
  if (!pool || !kart || !(windStrength > 0.45)) return 0;
  pool.ambientBudget += dt * (pool.reduceMotion ? 2 : 7) * windStrength;
  const count = Math.min(2, Math.floor(pool.ambientBudget));
  pool.ambientBudget -= count;
  for (let index = 0; index < count; index += 1) {
    const randomA = hash(pool.cursor, pool.serial);
    const randomB = hash(pool.cursor + 9, pool.serial);
    spawn(pool, {
      x: kart.x + (randomA * 2 - 1) * 32,
      y: kart.groundHeight + 0.15 + randomB * 1.2,
      z: kart.z + (randomB * 2 - 1) * 25,
      vx: 4.5 * windStrength,
      vy: 0.12,
      vz: 1.8 * windStrength,
      life: 2.2 + randomA * 1.8,
      size: 0.34 + randomB * 0.72,
      kind: 0,
      color: 0xd49a62,
    });
  }
  return count;
}

export function updateDuneDust(pool, dt, windX = 0.7, windZ = 0.3) {
  if (!pool || pool.disposed || !(dt > 0)) return;
  let activeCount = 0;
  for (let index = 0; index < pool.capacity; index += 1) {
    if (!pool.active[index]) continue;
    pool.age[index] += dt;
    if (pool.age[index] >= pool.life[index]) {
      pool.active[index] = 0;
      pool.alpha.array[index] = 0;
      _object.position.set(0, -999, 0);
      _object.scale.setScalar(0);
      _object.updateMatrix();
      pool.mesh.setMatrixAt(index, _object.matrix);
      continue;
    }
    const ballistic = pool.kind[index] === 1;
    pool.vx[index] += windX * dt * (ballistic ? 0.8 : 1.9);
    pool.vz[index] += windZ * dt * (ballistic ? 0.8 : 1.9);
    pool.vy[index] -= (ballistic ? 8.4 : 0.7) * dt;
    pool.x[index] += pool.vx[index] * dt;
    pool.y[index] += pool.vy[index] * dt;
    pool.z[index] += pool.vz[index] * dt;
    const progress = pool.age[index] / pool.life[index];
    const fade = Math.sin(Math.PI * clamp(progress, 0, 1));
    const scale = pool.size[index] * (ballistic ? 0.7 + progress * 0.65 : 0.6 + progress * 2.4);
    _object.position.set(pool.x[index], pool.y[index], pool.z[index]);
    _object.rotation.set(pool.spin[index] * progress, pool.spin[index] * progress * 0.7, progress * 1.8);
    _object.scale.set(scale * 1.6, scale * (ballistic ? 0.55 : 0.8), scale);
    _object.updateMatrix();
    pool.mesh.setMatrixAt(index, _object.matrix);
    pool.alpha.array[index] = fade * (ballistic ? 0.86 : 0.48);
    activeCount += 1;
  }
  pool.activeCount = activeCount;
  pool.mesh.instanceMatrix.needsUpdate = true;
  pool.alpha.needsUpdate = true;
  if (pool.mesh.instanceColor) pool.mesh.instanceColor.needsUpdate = true;
}

export function duneDustSnapshot(pool) {
  return {
    quality: pool?.quality || '',
    capacity: pool?.capacity || 0,
    active: pool?.activeCount || 0,
    spawned: pool?.spawned || 0,
    pooled: true,
  };
}

export function disposeDuneDust(pool) {
  if (!pool || pool.disposed) return;
  pool.disposed = true;
  pool.mesh.parent?.remove(pool.mesh);
  pool.geometry.dispose();
  pool.material.dispose();
}
