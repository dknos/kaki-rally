// Kaki Rally Raid — environment scatter.
//
// The terrain field decides what the land IS; this decides what is standing on
// it. Without scatter a streamed desert reads as an empty plane no matter how
// good the heightfield is, because there is nothing at human scale to give the
// eye a sense of speed or distance.
//
// Placement is a pure function of world position and the stage seed, exactly
// like the terrain: the same boulder is always in the same place, so it does
// not pop, swim, or reshuffle as the player drives away and back. Nothing is
// stored per sector, so cost is bounded by the visible ring rather than by how
// far the stage has been driven.

import * as THREE from 'three/webgpu';

import { RAID_SURFACES, clamp } from './raidSurfaceField.js';

// Scatter is decided on a fixed global lattice. One candidate per cell, jittered
// inside it, so density is controlled by how often a candidate is accepted
// rather than by how many are tested.
const SCATTER_CELL = 11;

// Per-quality instance budgets and radius. A budget is a hard cap: the field
// thins with distance rather than growing without bound.
export const RAID_SCATTER_QUALITY = Object.freeze({
  low: Object.freeze({ radius: 300, budget: 900 }),
  medium: Object.freeze({ radius: 400, budget: 1800 }),
  high: Object.freeze({ radius: 520, budget: 3200 }),
  ultra: Object.freeze({ radius: 620, budget: 5000 }),
});

// What grows or lies where. Weights are relative within a surface; `scale` is a
// multiplier range applied to the authored asset size.
const SURFACE_SCATTER = Object.freeze({
  salt: Object.freeze([
    { asset: 'RaidGravel-0', weight: 0.5, scale: [0.6, 1.0], density: 0.04 },
  ]),
  hardpack: Object.freeze([
    { asset: 'RaidTussock-0', weight: 3, scale: [0.8, 1.5], density: 0.3 },
    { asset: 'RaidTussock-1', weight: 2, scale: [0.8, 1.5] },
    { asset: 'RaidScrub-0', weight: 1.4, scale: [0.9, 1.6] },
    { asset: 'RaidBoulder-0', weight: 0.7, scale: [0.5, 1.1] },
    { asset: 'RaidGravel-0', weight: 1.1, scale: [0.7, 1.2] },
    { asset: 'RaidDeadwood-0', weight: 0.25, scale: [0.9, 1.5] },
  ]),
  compacted: Object.freeze([
    { asset: 'RaidTussock-0', weight: 2, scale: [0.7, 1.3], density: 0.24 },
    { asset: 'RaidScrub-1', weight: 1.6, scale: [0.9, 1.5] },
    { asset: 'RaidBoulder-0', weight: 0.5, scale: [0.5, 0.9] },
    { asset: 'RaidGravel-0', weight: 0.8, scale: [0.6, 1.1] },
  ]),
  loose: Object.freeze([
    { asset: 'RaidScrub-0', weight: 1.2, scale: [0.8, 1.4], density: 0.12 },
    { asset: 'RaidTussock-1', weight: 1, scale: [0.7, 1.2] },
    { asset: 'RaidDeadwood-0', weight: 0.2, scale: [0.8, 1.3] },
  ]),
  powder: Object.freeze([
    { asset: 'RaidTussock-1', weight: 1, scale: [0.6, 1.0], density: 0.05 },
  ]),
  gravel: Object.freeze([
    { asset: 'RaidGravel-0', weight: 3, scale: [0.8, 1.6], density: 0.42 },
    { asset: 'RaidGravel-1', weight: 2.4, scale: [0.8, 1.5] },
    { asset: 'RaidBoulder-0', weight: 1.6, scale: [0.6, 1.4] },
    { asset: 'RaidBoulder-1', weight: 1, scale: [0.6, 1.2] },
    { asset: 'RaidScrub-1', weight: 0.7, scale: [0.8, 1.3] },
    { asset: 'RaidSlab-0', weight: 0.5, scale: [0.7, 1.2] },
  ]),
  rock: Object.freeze([
    { asset: 'RaidBoulder-1', weight: 2.6, scale: [0.7, 1.7], density: 0.5 },
    { asset: 'RaidBoulder-2', weight: 2, scale: [0.7, 1.6] },
    { asset: 'RaidSlab-0', weight: 1.8, scale: [0.8, 1.6] },
    { asset: 'RaidSlab-1', weight: 1.4, scale: [0.8, 1.5] },
    { asset: 'RaidGravel-1', weight: 1.6, scale: [0.9, 1.6] },
    { asset: 'RaidSpire-0', weight: 0.35, scale: [0.7, 1.5] },
  ]),
  // The three landform surfaces. Scatter is keyed by SURFACE, not by zone, so
  // "spires in the spire forest" is only sayable because each of these belongs
  // to essentially one zone: scree is spire-forest's base (and canyon-rim's
  // hollows), duricrust is ruin-flat's base and nothing else's, riftglass is
  // rift-crater's hollow and nothing else's. Nothing here can appear on the
  // Wadi of Whiskers, which crosses none of them.
  //
  // scree is where the hoodoo silhouette actually comes from. The terrain field
  // only carries an 8 m plinth footprint; the thin spire standing on it is this
  // mesh, and it has to be dense or the zone reads as lumps.
  scree: Object.freeze([
    // `share` claims a bigger slice of the instance budget than an even split
    // gives. Without it RaidSpire-0 got budget/prototypes = about 150
    // instances, which over a 520 m ring is one spire every 75 m — measurably
    // present and visibly nothing. A forest needs the count, not the density.
    { asset: 'RaidSpire-0', weight: 3.4, scale: [0.55, 1.9], density: 0.52, share: 0.3 },
    { asset: 'RaidGravel-1', weight: 1.6, scale: [0.7, 1.3] },
    { asset: 'RaidBoulder-1', weight: 1.2, scale: [0.5, 1.1] },
    { asset: 'RaidSlab-0', weight: 0.6, scale: [0.6, 1.1] },
    { asset: 'RaidScrub-1', weight: 0.8, scale: [0.7, 1.2] },
  ]),
  // The ruin pan. Fallen drums outnumber standing columns, because a colonnade
  // that is still standing everywhere does not read as a ruin.
  duricrust: Object.freeze([
    { asset: 'RaidRuinColumn-1', weight: 2.4, scale: [0.8, 1.5], density: 0.16 },
    { asset: 'RaidRuinColumn-0', weight: 1.5, scale: [0.8, 1.5] },
    { asset: 'RaidRuinWall-0', weight: 1.7, scale: [0.8, 1.5] },
    // The gateway arch is also a landmark, but the landmark lattice is 620 m
    // with a 34% acceptance and duricrust exists only on this one band: counted
    // against the real field, the whole ruin section contains exactly ONE
    // landmark cell. An arch nobody drives under is not a gateway, so it is
    // scattered as well, at a weight that puts one roughly every 150 m.
    { asset: 'RaidRuinArch-0', weight: 0.25, scale: [0.9, 1.6] },
    { asset: 'RaidGravel-1', weight: 1.2, scale: [0.7, 1.3] },
    { asset: 'RaidBoulder-0', weight: 0.7, scale: [0.5, 1.0] },
    { asset: 'RaidScrub-1', weight: 0.5, scale: [0.7, 1.1] },
  ]),
  // The fractures. riftglass only exists inside a crack, and a crack is only a
  // few metres wide, so this is dense on purpose: it is lining a seam, not
  // filling a field.
  riftglass: Object.freeze([
    { asset: 'RaidRiftShard-0', weight: 3.2, scale: [0.7, 2.1], density: 0.26 },
    { asset: 'RaidRiftVent-0', weight: 0.9, scale: [0.7, 1.4] },
    { asset: 'RaidGravel-0', weight: 1.0, scale: [0.6, 1.1] },
  ]),
});

// Landmarks are rarer, larger, and placed on their own coarse lattice so they
// read as navigable features rather than as scenery.
const LANDMARK_CELL = 620;
// A landmark has to stand on ground that is actually drawn. raidMode renders one
// square terrain patch, PATCH_METRES = 1280 across, recentred on the same point
// this field is refreshed around, so ground exists to +/-640 m on each axis and
// nothing at all past that. A landmark placed beyond the edge is grounded at the
// correct field height but is drawn complete against the sky with a band of
// empty background under it. The half-extent is a box, not a radius, because the
// patch is square: a landmark in a corner is still standing on drawn ground.
// The value is 640 minus the widest landmark footprint, which is the RaidMesa-0
// apron: 38.4 m from its own centre as baked, 80.7 m at the 2.1 scale cap.
const LANDMARK_VISIBLE_HALF_EXTENT = 555;
const LANDMARK_ASSETS = Object.freeze([
  { asset: 'RaidMesa-0', weight: 1, scale: [0.55, 2.1], surfaces: ['rock', 'gravel', 'hardpack', 'salt'] },
  { asset: 'RaidSpire-0', weight: 2.2, scale: [1.4, 3.4], surfaces: ['rock', 'gravel', 'hardpack'] },
  // Monuments, restricted to duricrust so they can only stand on the ruin pan.
  // The amphitheatre is 71 x 73 m as baked; the 1.15 scale cap keeps its half
  // extent at 42 m, comfortably inside the 80.7 m the LANDMARK_VISIBLE_HALF_
  // EXTENT constant above was derived from, so that constant stays correct.
  { asset: 'RaidAmphitheatre-0', weight: 1.2, scale: [0.85, 1.15], surfaces: ['duricrust'] },
  { asset: 'RaidRuinArch-0', weight: 2.4, scale: [1.0, 1.8], surfaces: ['duricrust'] },
]);

function hash(x, z, seed) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ (seed | 0);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  h = Math.imul(h ^ (h >>> 13), 0x9e3779b1);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function pickWeighted(entries, roll) {
  let total = 0;
  for (const entry of entries) total += entry.weight;
  let cursor = roll * total;
  for (const entry of entries) {
    cursor -= entry.weight;
    if (cursor <= 0) return entry;
  }
  return entries[entries.length - 1];
}

// Flatten a loaded prototype into the meshes an InstancedMesh can be built from,
// baking the prototype's own local transform into the geometry so one instance
// matrix places the whole asset.
function collectPrototypeMeshes(node) {
  const parts = [];
  node.updateWorldMatrix(true, true);
  const inverse = new THREE.Matrix4().copy(node.matrixWorld).invert();
  node.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;
    const geometry = child.geometry.clone();
    const local = new THREE.Matrix4().multiplyMatrices(inverse, child.matrixWorld);
    geometry.applyMatrix4(local);
    parts.push({ geometry, material: child.material });
  });
  return parts;
}

/**
 * Build the scatter field for a stage.
 *
 * @param {object} options
 * @param {THREE.Object3D} options.kit loaded GLB scene containing the prototypes
 * @param {object} options.provider streamed terrain authority
 * @param {number} options.seed stage seed
 * @param {string} options.quality display quality tier
 * @param {object} options.owned resource registry the session disposes
 */
export function createRaidEnvironment({ kit, provider, seed, quality = 'high', owned }) {
  const tier = RAID_SCATTER_QUALITY[quality] || RAID_SCATTER_QUALITY.high;
  const root = new THREE.Group();
  root.name = 'kaki-raid-environment';

  // One InstancedMesh per prototype part, sized to the budget share.
  const prototypes = new Map();
  const wanted = new Set();
  for (const entries of Object.values(SURFACE_SCATTER)) {
    for (const entry of entries) wanted.add(entry.asset);
  }
  for (const landmark of LANDMARK_ASSETS) wanted.add(landmark.asset);

  for (const name of wanted) {
    const node = kit?.getObjectByName?.(name);
    if (!node) continue;
    const parts = collectPrototypeMeshes(node);
    if (!parts.length) continue;
    const isLandmark = LANDMARK_ASSETS.some((entry) => entry.asset === name);
    // An asset can be BOTH: RaidSpire-0 is a landmark on rock and a dense
    // ground scatter on scree, and the two loops share one InstancedMesh. Twelve
    // is the landmark allowance, not a cap on the asset, so a prototype that is
    // also scattered has to keep the scatter capacity — with the landmark
    // number the spire forest was silently limited to twelve spires.
    let share = 0;
    let isScattered = false;
    for (const entries of Object.values(SURFACE_SCATTER)) {
      for (const entry of entries) {
        if (entry.asset !== name) continue;
        isScattered = true;
        share = Math.max(share, entry.share || 0);
      }
    }
    const evenSplit = Math.max(24, Math.round(tier.budget / wanted.size));
    const capacity = isScattered
      ? Math.max(evenSplit, Math.round(tier.budget * share))
      : 12;
    const meshes = parts.map(({ geometry, material }) => {
      const instanced = new THREE.InstancedMesh(geometry, material, capacity);
      instanced.name = `kaki-raid-scatter-${name}`;
      instanced.frustumCulled = false;
      instanced.castShadow = false;
      instanced.receiveShadow = false;
      instanced.count = 0;
      instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      owned?.geometries?.add(geometry);
      root.add(instanced);
      return instanced;
    });
    prototypes.set(name, { meshes, capacity, isLandmark });
  }

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scaleVector = new THREE.Vector3();
  const euler = new THREE.Euler();
  const surface = {};
  let placed = 0;
  let landmarks = 0;

  function place(name, x, y, z, yaw, scale, tiltX = 0, tiltZ = 0) {
    const prototype = prototypes.get(name);
    if (!prototype) return false;
    const first = prototype.meshes[0];
    if (first.count >= prototype.capacity) return false;
    const index = first.count;
    position.set(x, y, z);
    euler.set(tiltX, yaw, tiltZ);
    quaternion.setFromEuler(euler);
    scaleVector.set(scale, scale, scale);
    matrix.compose(position, quaternion, scaleVector);
    for (const mesh of prototype.meshes) {
      mesh.setMatrixAt(index, matrix);
      mesh.count = index + 1;
      mesh.instanceMatrix.needsUpdate = true;
    }
    return true;
  }

  function reset() {
    for (const prototype of prototypes.values()) {
      for (const mesh of prototype.meshes) mesh.count = 0;
    }
    placed = 0;
    landmarks = 0;
  }

  /**
   * Repopulate the field around a centre. Called when the terrain patch
   * recentres, not per frame.
   */
  function refresh(centreX, centreZ) {
    reset();
    const radius = tier.radius;
    const cells = Math.ceil(radius / SCATTER_CELL);
    const originCellX = Math.round(centreX / SCATTER_CELL);
    const originCellZ = Math.round(centreZ / SCATTER_CELL);

    for (let dz = -cells; dz <= cells; dz += 1) {
      for (let dx = -cells; dx <= cells; dx += 1) {
        if (placed >= tier.budget) break;
        const cellX = originCellX + dx;
        const cellZ = originCellZ + dz;
        // Jitter inside the cell so the field is not a visible grid.
        const jitterX = hash(cellX, cellZ, seed ^ 0x11) - 0.5;
        const jitterZ = hash(cellX, cellZ, seed ^ 0x22) - 0.5;
        const x = (cellX + jitterX) * SCATTER_CELL;
        const z = (cellZ + jitterZ) * SCATTER_CELL;
        const distance = Math.hypot(x - centreX, z - centreZ);
        if (distance > radius) continue;

        provider.surfaceAt(x, z, surface);
        const entries = SURFACE_SCATTER[surface.id];
        if (!entries?.length) continue;

        // Density thins with distance so the near field is dense and the far
        // field stays inside the budget.
        const baseDensity = entries[0].density ?? 0.2;
        const falloff = 1 - clamp((distance / radius) ** 1.6, 0, 0.82);
        if (hash(cellX, cellZ, seed ^ 0x33) > baseDensity * falloff) continue;

        // Steep ground sheds loose scatter.
        const height = provider.heightAt(x, z);
        const east = provider.heightAt(x + 2, z);
        const north = provider.heightAt(x, z + 2);
        const slope = Math.hypot((east - height) / 2, (north - height) / 2);
        if (slope > 0.85) continue;

        const entry = pickWeighted(entries, hash(cellX, cellZ, seed ^ 0x44));
        const scaleRoll = hash(cellX, cellZ, seed ^ 0x55);
        const scale = entry.scale[0] + (entry.scale[1] - entry.scale[0]) * scaleRoll;
        const yaw = hash(cellX, cellZ, seed ^ 0x66) * Math.PI * 2;
        // Lean rocks with the ground so nothing floats on a slope.
        const tiltX = clamp((north - height) / 2, -0.5, 0.5);
        const tiltZ = clamp(-(east - height) / 2, -0.5, 0.5);
        if (place(entry.asset, x, height, z, yaw, scale, tiltX, tiltZ)) placed += 1;
      }
    }

    // Landmarks on their own coarse lattice.
    const landmarkCells = Math.ceil((radius * 2.6) / LANDMARK_CELL);
    const landmarkOriginX = Math.round(centreX / LANDMARK_CELL);
    const landmarkOriginZ = Math.round(centreZ / LANDMARK_CELL);
    for (let dz = -landmarkCells; dz <= landmarkCells; dz += 1) {
      for (let dx = -landmarkCells; dx <= landmarkCells; dx += 1) {
        const cellX = landmarkOriginX + dx;
        const cellZ = landmarkOriginZ + dz;
        // Sparse, and jittered across most of the cell. A dense lattice reads as
        // a row of identical hills on the horizon rather than as landmarks.
        if (hash(cellX, cellZ, seed ^ 0x77) > 0.34) continue;
        const x = (cellX + (hash(cellX, cellZ, seed ^ 0x88) - 0.5) * 0.9) * LANDMARK_CELL;
        const z = (cellZ + (hash(cellX, cellZ, seed ^ 0x99) - 0.5) * 0.9) * LANDMARK_CELL;
        // The scatter loop above clips its candidates to its budget radius; this
        // loop has to clip to the drawn ground instead, or the landmark floats.
        if (Math.abs(x - centreX) > LANDMARK_VISIBLE_HALF_EXTENT) continue;
        if (Math.abs(z - centreZ) > LANDMARK_VISIBLE_HALF_EXTENT) continue;
        provider.surfaceAt(x, z, surface);
        const candidates = LANDMARK_ASSETS.filter((entry) => entry.surfaces.includes(surface.id));
        if (!candidates.length) continue;
        const entry = pickWeighted(candidates, hash(cellX, cellZ, seed ^ 0xaa));
        const scaleRoll = hash(cellX, cellZ, seed ^ 0xbb);
        const scale = entry.scale[0] + (entry.scale[1] - entry.scale[0]) * scaleRoll;
        const height = provider.heightAt(x, z);
        const yaw = hash(cellX, cellZ, seed ^ 0xcc) * Math.PI * 2;
        if (place(entry.asset, x, height - 1.5, z, yaw, scale)) landmarks += 1;
      }
    }
  }

  return {
    root,
    refresh,
    get stats() {
      return { placed, landmarks, prototypes: prototypes.size, budget: tier.budget, radius: tier.radius };
    },
    dispose() {
      for (const prototype of prototypes.values()) {
        for (const mesh of prototype.meshes) {
          mesh.dispose?.();
          mesh.geometry?.dispose?.();
          mesh.removeFromParent();
        }
      }
      prototypes.clear();
      root.removeFromParent();
    },
  };
}

export { SURFACE_SCATTER, RAID_SURFACES };
