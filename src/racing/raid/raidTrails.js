// Kaki Rally Raid — persistent wheel trails.
//
// Dust says the machine is moving. Trails say where it has been, which is the
// part that makes a desert feel driven-on rather than driven-over: your own line
// is visible behind you, a mistake leaves evidence, and on a fold-back you can
// see the track you laid on the way out.
//
// A fixed-capacity ring buffer of flat quads laid on the ground, one draw call.
// The oldest sample is overwritten rather than removed, so cost is constant no
// matter how far the stage runs.

import * as THREE from 'three/webgpu';

import { clamp } from './raidSurfaceField.js';

export const RAID_TRAIL_QUALITY = Object.freeze({
  low: 240,
  medium: 480,
  high: 900,
  ultra: 1400,
});

// Metres of travel between samples. Close enough that the marks overlap into a
// continuous band, far enough that the ring covers a useful distance.
const SAMPLE_SPACING = 0.85;

// Track pairs sit this far either side of the vehicle centreline.
const TRACK_HALF_WIDTH = 0.92;

function createTrackTexture() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const u = (x / (size - 1)) * 2 - 1;
      const v = (y / (size - 1)) * 2 - 1;
      // Soft-edged oval, with a tread ripple along its length so a track reads
      // as a tyre mark rather than as a smear.
      const oval = clamp(1 - Math.hypot(u * 1.15, v), 0, 1);
      const tread = 0.72 + 0.28 * Math.sin(v * Math.PI * 6);
      const alpha = oval ** 1.5 * tread;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = Math.round(clamp(alpha, 0, 1) * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

export function createRaidTrails({ quality = 'high', provider, owned } = {}) {
  const capacity = RAID_TRAIL_QUALITY[quality] || RAID_TRAIL_QUALITY.high;
  const texture = createTrackTexture();
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    // Darken the ground rather than paint on it, so a track reads as a groove in
    // any light and never as a bright decal.
    blending: THREE.NormalBlending,
    vertexColors: true,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = 'kaki-raid-trails';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.count = capacity;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  owned?.geometries?.add(geometry);
  owned?.materials?.add(material);
  owned?.textures?.add(texture);

  const life = new Float32Array(capacity);
  const maxLife = new Float32Array(capacity);
  const strength = new Float32Array(capacity);
  let cursor = 0;
  let alive = 0;
  let lastX = null;
  let lastZ = null;

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scaleVector = new THREE.Vector3();
  const euler = new THREE.Euler();
  const colour = new THREE.Color();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  function stamp(x, z, yaw, depth, width, ttl) {
    const index = cursor;
    cursor = (cursor + 1) % capacity;
    // Sit just above the surface so the mark follows the terrain it is on.
    const y = provider.heightAt(x, z) + 0.045;
    position.set(x, y, z);
    euler.set(0, -yaw + Math.PI * 0.5, 0);
    quaternion.setFromEuler(euler);
    scaleVector.set(width, 1, 1.9);
    matrix.compose(position, quaternion, scaleVector);
    mesh.setMatrixAt(index, matrix);
    life[index] = ttl;
    maxLife[index] = ttl;
    strength[index] = depth;
  }

  function update(dt, vehicle, surface) {
    // Only lay track where wheels are actually on the ground.
    if (vehicle.contacts > 0) {
      if (lastX === null) {
        lastX = vehicle.x;
        lastZ = vehicle.z;
      }
      const travelled = Math.hypot(vehicle.x - lastX, vehicle.z - lastZ);
      if (travelled >= SAMPLE_SPACING) {
        const steps = Math.min(6, Math.floor(travelled / SAMPLE_SPACING));
        for (let step = 1; step <= steps; step += 1) {
          const t = step / steps;
          const x = lastX + (vehicle.x - lastX) * t;
          const z = lastZ + (vehicle.z - lastZ) * t;
          const cos = Math.cos(vehicle.yaw);
          const sin = Math.sin(vehicle.yaw);
          // Looser ground takes a deeper, wider mark and holds it longer.
          const looseness = clamp(surface.looseness ?? 0.5, 0, 1);
          const depth = 0.3 + looseness * 0.6 + clamp(vehicle.slip * 0.06, 0, 0.35);
          const width = 0.62 + looseness * 0.34 + clamp(vehicle.slip * 0.05, 0, 0.5);
          const ttl = 14 + looseness * 26;
          // A pair of tracks, offset to either side of the centreline.
          stamp(x + sin * TRACK_HALF_WIDTH, z - cos * TRACK_HALF_WIDTH, vehicle.yaw, depth, width, ttl);
          stamp(x - sin * TRACK_HALF_WIDTH, z + cos * TRACK_HALF_WIDTH, vehicle.yaw, depth, width, ttl);
        }
        lastX = vehicle.x;
        lastZ = vehicle.z;
      }
    }
    // Deliberately NOT resetting the anchor when contact is lost. Suspension
    // makes `contacts` flicker several times a second on rough ground, and
    // clearing the anchor on every flicker restarted the travelled distance
    // before it could reach one sample spacing, so almost no track was laid.

    alive = 0;
    for (let index = 0; index < capacity; index += 1) {
      if (life[index] <= 0) continue;
      life[index] -= dt;
      if (life[index] <= 0) {
        mesh.setMatrixAt(index, hidden);
        continue;
      }
      // Fade the mark out as the wind fills it back in.
      const remaining = life[index] / maxLife[index];
      const shade = clamp(strength[index] * remaining, 0, 1);
      colour.setRGB(0.40 - shade * 0.20, 0.31 - shade * 0.17, 0.22 - shade * 0.13);
      mesh.setColorAt(index, colour);
      alive += 1;
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  // Nothing is stamped until the first update, so start fully hidden.
  for (let index = 0; index < capacity; index += 1) mesh.setMatrixAt(index, hidden);
  mesh.instanceMatrix.needsUpdate = true;

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
