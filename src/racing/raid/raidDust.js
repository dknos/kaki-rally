// Kaki Rally Raid — dust.
//
// Dust is the cheapest large gain in a desert racer. Without it the vehicle
// slides over the ground like a decal; with it the machine is visibly working
// the surface, speed reads at a glance, and a rival is a plume on the horizon
// before it is a vehicle.
//
// One fixed-capacity pool, one draw call, no per-particle allocation. Particles
// are recycled by age, so cost is constant no matter how long the stage runs.

import * as THREE from 'three/webgpu';

import { clamp } from './raidSurfaceField.js';

const UP = new THREE.Vector3(0, 1, 0);

export const RAID_DUST_QUALITY = Object.freeze({
  low: 90,
  medium: 180,
  high: 560,
  ultra: 820,
});

// A soft round puff, generated rather than shipped so the mode needs no texture
// asset for it.
function createPuffTexture() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const centre = (size - 1) * 0.5;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const distance = Math.hypot(x - centre, y - centre) / centre;
      // Soft shoulder rather than a hard disc, so overlapping puffs build into
      // a volume instead of reading as a pile of circles.
      const alpha = clamp(1 - distance, 0, 1) ** 2.1;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

export function createRaidDust({ quality = 'high', owned } = {}) {
  const capacity = RAID_DUST_QUALITY[quality] || RAID_DUST_QUALITY.high;
  const texture = createPuffTexture();
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    opacity: 1,
    side: THREE.DoubleSide,
    vertexColors: true,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = 'kaki-raid-dust';
  mesh.frustumCulled = false;
  mesh.count = capacity;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  owned?.geometries?.add(geometry);
  owned?.materials?.add(material);
  owned?.textures?.add(texture);

  // Flat parallel arrays: no garbage, and the whole pool fits in cache.
  const px = new Float32Array(capacity);
  const py = new Float32Array(capacity);
  const pz = new Float32Array(capacity);
  const vx = new Float32Array(capacity);
  const vy = new Float32Array(capacity);
  const vz = new Float32Array(capacity);
  const life = new Float32Array(capacity);
  const maxLife = new Float32Array(capacity);
  const seed = new Float32Array(capacity);
  const tint = new Float32Array(capacity);
  let cursor = 0;
  let alive = 0;

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scaleVector = new THREE.Vector3();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const colour = new THREE.Color();

  function spawn(x, y, z, speed, surface, wind) {
    const index = cursor;
    cursor = (cursor + 1) % capacity;
    px[index] = x;
    py[index] = y;
    pz[index] = z;
    // Kick backwards and up, with a lateral spread that widens with speed.
    const spread = 0.6 + speed * 0.05;
    vx[index] = (Math.random() - 0.5) * spread + wind.x * 0.6;
    vy[index] = 0.7 + Math.random() * 1.5 + speed * 0.02;
    vz[index] = (Math.random() - 0.5) * spread + wind.z * 0.6;
    maxLife[index] = 1.1 + Math.random() * 1.5 + surface.dust * 0.7;
    life[index] = maxLife[index];
    seed[index] = Math.random();
    // Loose surfaces throw pale sand, rock throws darker grit.
    tint[index] = clamp(surface.looseness, 0, 1);
  }

  function update(dt, vehicle, surface, wind = { x: 0.4, z: 0.2 }) {
    const speed = Math.hypot(vehicle.velocityX, vehicle.velocityZ);
    // Emission follows what the ground is actually doing: fast on loose sand,
    // barely anything crawling across salt.
    const emission = clamp((speed / 9) * (0.35 + surface.dust), 0, 6.5)
      + clamp(vehicle.slip * 0.35 * surface.dust, 0, 5);
    if (speed > 1.4 && !vehicle.airborne) {
      const count = Math.min(7, Math.round(emission * dt * 68));
      for (let i = 0; i < count; i += 1) {
        // Emit behind the rear axle rather than at the origin.
        const back = 1.5 + Math.random() * 0.7;
        const side = (Math.random() - 0.5) * 1.7;
        const cos = Math.cos(vehicle.yaw);
        const sin = Math.sin(vehicle.yaw);
        spawn(
          vehicle.x - cos * back + sin * side,
          vehicle.y - 0.35,
          vehicle.z - sin * back - cos * side,
          speed, surface, wind,
        );
      }
    }

    alive = 0;
    for (let index = 0; index < capacity; index += 1) {
      if (life[index] <= 0) {
        mesh.setMatrixAt(index, hidden);
        continue;
      }
      life[index] -= dt;
      if (life[index] <= 0) {
        mesh.setMatrixAt(index, hidden);
        continue;
      }
      // Rise, drift downwind, and slow as the puff expands.
      vy[index] -= 0.55 * dt;
      vx[index] += wind.x * 0.35 * dt;
      vz[index] += wind.z * 0.35 * dt;
      const drag = Math.exp(-1.35 * dt);
      vx[index] *= drag;
      vy[index] *= drag;
      vz[index] *= drag;
      px[index] += vx[index] * dt;
      py[index] += vy[index] * dt;
      pz[index] += vz[index] * dt;

      const age = 1 - life[index] / maxLife[index];
      const scale = 1.3 + age * (5.2 + seed[index] * 3.4);
      const fade = Math.sin(Math.min(1, age) * Math.PI) * 0.85;
      position.set(px[index], py[index], pz[index]);
      // Camera-facing is handled by keeping the puff upright and letting the
      // soft alpha do the work; a full billboard costs a per-particle lookAt.
      quaternion.setFromAxisAngle(UP, seed[index] * Math.PI * 2);
      scaleVector.set(scale, scale, scale);
      matrix.compose(position, quaternion, scaleVector);
      mesh.setMatrixAt(index, matrix);
      // Sand-coloured, not smoke-coloured. A grey plume reads as exhaust.
      const warm = 0.95 + tint[index] * 0.05;
      colour.setRGB(warm * fade, (warm - 0.13) * fade, (warm - 0.34) * fade);
      mesh.setColorAt(index, colour);
      alive += 1;
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  return {
    mesh,
    update,
    get alive() { return alive; },
    get capacity() { return capacity; },
    dispose() {
      mesh.dispose?.();
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
