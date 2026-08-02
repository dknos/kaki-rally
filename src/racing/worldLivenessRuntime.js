import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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

function geometrySignature(mesh) {
  const geometry = mesh.geometry;
  const attributes = Object.entries(geometry.attributes || {})
    .map(([name, attribute]) => `${name}:${attribute.itemSize}:${attribute.normalized ? 1 : 0}:${attribute.array?.constructor?.name || ''}`)
    .sort()
    .join('|');
  return `${geometry.index ? 'indexed' : 'plain'}:${attributes}`;
}

function materialClass(material) {
  if (material.transparent || material.opacity < 0.99) return 'transparent';
  if (material.isMeshBasicMaterial || material.emissiveIntensity > 0.1 || material.emissive?.getHex?.()) return 'emissive';
  return Number(material.metalness) > 0.42 ? 'metal' : 'matte';
}

function runtimeMaterialFor(kind, cache, ownedMaterials) {
  if (cache.has(kind)) return cache.get(kind);
  let material;
  if (kind === 'emissive') {
    material = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  } else if (kind === 'transparent') {
    material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.08,
      roughness: 0.32,
      opacity: 0.48,
      transparent: true,
      depthWrite: false,
    });
  } else {
    material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      metalness: kind === 'metal' ? 0.62 : 0.08,
      roughness: kind === 'metal' ? 0.42 : 0.76,
    });
  }
  material.name = `KR_WORLD_RUNTIME_${kind.toUpperCase()}`;
  cache.set(kind, material);
  ownedMaterials.add(material);
  return material;
}

function bakeVertexColor(geometry, material) {
  const count = geometry.getAttribute('position')?.count || 0;
  const color = material.color || new THREE.Color(1, 1, 1);
  const values = new Uint8Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    values[index * 3] = Math.round(color.r * 255);
    values[index * 3 + 1] = Math.round(color.g * 255);
    values[index * 3 + 2] = Math.round(color.b * 255);
  }
  for (const name of Object.keys(geometry.attributes || {})) {
    if (!['position', 'normal', 'color'].includes(name)) geometry.deleteAttribute(name);
  }
  geometry.setAttribute('color', new THREE.Uint8BufferAttribute(values, 3, true));
}

function mergedRenderables(source, cache, ownedGeometries, materialCache, ownedMaterials) {
  if (cache.has(source)) return cache.get(source);
  source.updateWorldMatrix(true, true);
  const inverse = source.matrixWorld.clone().invert();
  const buckets = new Map();
  source.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.geometry || !mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    // World kits use one material per mesh. Preserve an unexpected grouped
    // material mesh as its own renderable instead of flattening its groups.
    const kind = materials.length === 1 ? materialClass(materials[0]) : '';
    const key = materials.length === 1
      ? `${kind}:${geometrySignature(mesh)}`
      : `grouped:${mesh.uuid}`;
    const runtimeMaterial = materials.length === 1
      ? runtimeMaterialFor(kind, materialCache, ownedMaterials)
      : mesh.material;
    if (!buckets.has(key)) buckets.set(key, { material: runtimeMaterial, geometries: [] });
    const relative = inverse.clone().multiply(mesh.matrixWorld);
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(relative);
    if (materials.length === 1) bakeVertexColor(geometry, materials[0]);
    buckets.get(key).geometries.push(geometry);
  });

  const renderables = [];
  for (const bucket of buckets.values()) {
    let geometry = bucket.geometries[0];
    if (bucket.geometries.length > 1) {
      geometry = mergeGeometries(bucket.geometries, false);
      if (geometry) bucket.geometries.forEach((part) => part.dispose());
      else {
        geometry = bucket.geometries[0];
        bucket.geometries.slice(1).forEach((part) => part.dispose());
      }
    }
    if (!geometry) continue;
    ownedGeometries.add(geometry);
    renderables.push({ geometry, material: bucket.material });
  }
  cache.set(source, renderables);
  return renderables;
}

function addInstancedFamily(
  group,
  source,
  placements,
  name,
  tier,
  cache,
  ownedGeometries,
  materialCache,
  ownedMaterials,
) {
  const placementMatrices = placements.map(placementMatrix);
  let meshes = 0;
  for (const [index, renderable] of mergedRenderables(
    source,
    cache,
    ownedGeometries,
    materialCache,
    ownedMaterials,
  ).entries()) {
    const instances = new THREE.InstancedMesh(renderable.geometry, renderable.material, placements.length);
    instances.name = `${name}-${index}-instances`;
    instances.castShadow = tier.shadows;
    instances.receiveShadow = true;
    instances.frustumCulled = true;
    instances.userData.presentationOnly = true;
    const matrix = new THREE.Matrix4();
    for (let placementIndex = 0; placementIndex < placements.length; placementIndex += 1) {
      matrix.copy(placementMatrices[placementIndex]);
      instances.setMatrixAt(placementIndex, matrix);
    }
    instances.instanceMatrix.needsUpdate = true;
    instances.computeBoundingSphere?.();
    group.add(instances);
    meshes += 1;
  }
  return meshes;
}

function addLodClone(
  group,
  assetLease,
  kit,
  placement,
  tier,
  animated,
  cache,
  ownedGeometries,
  materialCache,
  ownedMaterials,
) {
  const lod = new THREE.LOD();
  lod.name = `world-${kit.code.toLowerCase()}-${placement.asset.toLowerCase()}`;
  lod.position.set(placement.x, placement.y, placement.z);
  lod.rotation.y = placement.yaw || 0;
  lod.scale.setScalar(Number(placement.scale) || 1);
  const starts = tier.firstLod === 0 ? [0, 1, 2] : tier.firstLod === 1 ? [1, 2] : [2];
  for (const level of starts) {
    const source = sourceNode(assetLease, kit, placement.asset, level);
    if (!source) continue;
    const clone = new THREE.Group();
    clone.name = `${source.name}-merged`;
    for (const [index, renderable] of mergedRenderables(
      source,
      cache,
      ownedGeometries,
      materialCache,
      ownedMaterials,
    ).entries()) {
      const mesh = new THREE.Mesh(renderable.geometry, renderable.material);
      mesh.name = `${source.name}-merged-${index}`;
      clone.add(mesh);
    }
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
  const geometryCache = new Map();
  const ownedGeometries = new Set();
  const materialCache = new Map();
  const ownedMaterials = new Set();
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
      if (addLodClone(
        group,
        assetLease,
        plan.kit,
        placement,
        tier,
        animated,
        geometryCache,
        ownedGeometries,
        materialCache,
        ownedMaterials,
      )) {
        placementCount += 1;
        lodCount += 1;
      }
    }
    for (const [asset, repeats] of groupedRepeats) {
      const source = sourceNode(assetLease, plan.kit, asset, tier.repeatLod);
      if (!source) continue;
      instancedDraws += addInstancedFamily(
        group,
        source,
        repeats,
        `${plan.kit.code}-${asset}`,
        tier,
        geometryCache,
        ownedGeometries,
        materialCache,
        ownedMaterials,
      );
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
      ownedGeometries.forEach((geometry) => geometry.dispose());
      ownedGeometries.clear();
      ownedMaterials.forEach((material) => material.dispose());
      ownedMaterials.clear();
      geometryCache.clear();
      materialCache.clear();
      // Merged presentation geometries and their vertex-color runtime
      // materials are session-owned and disposed above.
    },
  };
  return state;
}
