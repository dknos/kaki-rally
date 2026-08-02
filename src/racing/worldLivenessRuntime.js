import * as THREE from 'three';
import { WORLD_KITS, worldLivenessTierFor } from './worldLiveness.js';

function sourceNode(assetLease, kit, asset, lod) {
  return assetLease?.models?.[kit.assetId]?.scene?.getObjectByName?.(
    `KR_${kit.code}_${asset}_LOD${lod}`,
  ) || null;
}

function configureRenderable(root, { castShadow, maxDistance }) {
  root.traverse?.((object) => {
    if (!object.isMesh) return;
    object.castShadow = castShadow;
    object.receiveShadow = true;
    object.frustumCulled = true;
    object.userData.presentationOnly = true;
    object.userData.worldLivenessMaxDistance = maxDistance;
  });
}

function placementMatrix(placement) {
  const matrix = new THREE.Matrix4();
  const scale = Number(placement.scale) || 1;
  matrix.compose(
    new THREE.Vector3(placement.x, placement.y, placement.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), placement.yaw || 0),
    new THREE.Vector3(scale, scale, scale),
  );
  return matrix;
}

function addInstancedFamily(group, source, placements, name, tier) {
  source.updateWorldMatrix(true, true);
  const inverse = source.matrixWorld.clone().invert();
  const placementMatrices = placements.map(placementMatrix);
  let meshes = 0;
  source.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.geometry || !mesh.material) return;
    const relative = inverse.clone().multiply(mesh.matrixWorld);
    const instances = new THREE.InstancedMesh(mesh.geometry, mesh.material, placements.length);
    instances.name = `${name}-${mesh.name}-instances`;
    instances.castShadow = tier.shadows;
    instances.receiveShadow = true;
    instances.frustumCulled = true;
    instances.userData.presentationOnly = true;
    const matrix = new THREE.Matrix4();
    for (let index = 0; index < placements.length; index += 1) {
      matrix.multiplyMatrices(placementMatrices[index], relative);
      instances.setMatrixAt(index, matrix);
    }
    instances.instanceMatrix.needsUpdate = true;
    instances.computeBoundingSphere?.();
    group.add(instances);
    meshes += 1;
  });
  return meshes;
}

function addLodClone(group, assetLease, kit, placement, tier, animated) {
  const lod = new THREE.LOD();
  lod.name = `world-${kit.code.toLowerCase()}-${placement.asset.toLowerCase()}`;
  lod.position.set(placement.x, placement.y, placement.z);
  lod.rotation.y = placement.yaw || 0;
  lod.scale.setScalar(Number(placement.scale) || 1);
  const starts = tier.firstLod === 0 ? [0, 1, 2] : tier.firstLod === 1 ? [1, 2] : [2];
  for (const level of starts) {
    const source = sourceNode(assetLease, kit, placement.asset, level);
    if (!source) continue;
    const clone = source.clone(true);
    configureRenderable(clone, { castShadow: tier.shadows && level === 0, maxDistance: tier.far });
    const distance = level === starts[0] ? 0
      : level === 1 ? 95
        : tier.firstLod === 1 ? 110 : 210;
    lod.addLevel(clone, distance);
  }
  if (!lod.levels.length) return null;
  const culledLevel = new THREE.Object3D();
  culledLevel.name = `${lod.name}-distance-culled`;
  culledLevel.userData.presentationOnly = true;
  lod.addLevel(culledLevel, tier.far);
  lod.userData.presentationOnly = true;
  lod.userData.maxDistance = tier.far;
  lod.userData.routeFraction = placement.routeFraction;
  group.add(lod);
  if (placement.animated && animated.length < 18) {
    animated.push({ object: lod, kind: placement.animated, baseY: placement.y, phase: animated.length * 1.618 });
  }
  return lod;
}

/** Attach immutable clones/instances from one or more leased kit plans. */
export function attachWorldLiveness({ parent, assetLease, plans, quality = 'high', reduceMotion = false, name = 'world-liveness' }) {
  if (!parent?.add || !assetLease || !Array.isArray(plans)) return null;
  const tier = worldLivenessTierFor(quality);
  const group = new THREE.Group();
  group.name = name;
  group.userData.presentationOnly = true;
  parent.add(group);
  const animated = [];
  let placementCount = 0;
  let instancedDraws = 0;
  let lodCount = 0;

  for (const plan of plans) {
    if (!plan?.kit || !Array.isArray(plan.placements)) continue;
    const groupedRepeats = new Map();
    for (const placement of plan.placements) {
      if (placement.repeat && !placement.animated) {
        const key = placement.asset;
        if (!groupedRepeats.has(key)) groupedRepeats.set(key, []);
        groupedRepeats.get(key).push(placement);
        continue;
      }
      if (addLodClone(group, assetLease, plan.kit, placement, tier, animated)) {
        placementCount += 1;
        lodCount += 1;
      }
    }
    for (const [asset, repeats] of groupedRepeats) {
      const source = sourceNode(assetLease, plan.kit, asset, tier.repeatLod);
      if (!source) continue;
      instancedDraws += addInstancedFamily(group, source, repeats, `${plan.kit.code}-${asset}`, tier);
      placementCount += repeats.length;
    }
  }

  const state = {
    group,
    animated,
    placementCount,
    instancedDraws,
    lodCount,
    reduceMotion: !!reduceMotion,
    disposed: false,
    update(time) {
      if (state.disposed || state.reduceMotion) return;
      for (let index = 0; index < animated.length; index += 1) {
        const item = animated[index];
        if (item.kind === 'wind') item.object.rotation.z = Math.sin(time * 2.15 + item.phase) * 0.045;
        else if (item.kind === 'beacon') item.object.position.y = item.baseY + Math.sin(time * 1.4 + item.phase) * 0.025;
      }
    },
    snapshot() {
      return { placementCount, instancedDraws, lodCount, animated: animated.length, quality, disposed: state.disposed };
    },
    dispose() {
      if (state.disposed) return;
      state.disposed = true;
      group.removeFromParent();
      animated.length = 0;
      // Geometries and materials are borrowed from the reference-counted lease.
      // The session releases them after every world-liveness clone is detached.
    },
  };
  return state;
}
