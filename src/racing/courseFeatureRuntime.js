import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getCourseFeature } from './courseFeatureCatalog.js';

const THEME_MATERIALS = Object.freeze({
  countryside: Object.freeze({ paint: 0xe66f45, trim: 0xffd165, structure: 0x4f695f, emissive: 0xffc85c }),
  forest: Object.freeze({ paint: 0x4f7f63, trim: 0xd8a85d, structure: 0x344b42, emissive: 0xf0bd68 }),
  desert: Object.freeze({ paint: 0xc86e45, trim: 0xf0c36c, structure: 0x79563e, emissive: 0xffc463 }),
  snow: Object.freeze({ paint: 0x73a8b8, trim: 0xf1f7e9, structure: 0x536b77, emissive: 0xb8f4ff }),
  neon: Object.freeze({ paint: 0x4b356e, trim: 0x52e5cf, structure: 0x26283b, emissive: 0xff4ca5 }),
  coastal: Object.freeze({ paint: 0x4b9fa4, trim: 0xf2d085, structure: 0x55716d, emissive: 0x80f7e7 }),
  industrial: Object.freeze({ paint: 0xd17d3d, trim: 0xf4c74e, structure: 0x4b5154, emissive: 0xffb546 }),
  arena: Object.freeze({ paint: 0x9c456d, trim: 0xffc54f, structure: 0x3d3542, emissive: 0xff5e9c }),
  meadow: Object.freeze({ paint: 0xe7737f, trim: 0xffd96d, structure: 0x547765, emissive: 0xffd77a }),
  quarry: Object.freeze({ paint: 0xb76443, trim: 0x6ee0c3, structure: 0x4c5358, emissive: 0x78f2d7 }),
  crown: Object.freeze({ paint: 0xd95d9e, trim: 0xffd36b, structure: 0x71649b, emissive: 0xff8fd0 }),
});

function materialRole(material) {
  const name = String(material?.name || '').toLowerCase();
  if (name.includes('variant_paint')) return 'paint';
  if (name.includes('variant_trim')) return 'trim';
  if (name.includes('variant_structure')) return 'structure';
  if (name.includes('variant_emissive')) return 'emissive';
  return '';
}

function themeStyle(themeId, course = {}) {
  if (THEME_MATERIALS[themeId]) return THEME_MATERIALS[themeId];
  if (course.id === 'twilight' || course.id === 'void') return THEME_MATERIALS.neon;
  if (course.id === 'cinder') return THEME_MATERIALS.industrial;
  if (course.id === 'cave') return THEME_MATERIALS.forest;
  return THEME_MATERIALS.countryside;
}

function themedMaterial(material, style, owned, materialCache) {
  if (!material?.clone) return material;
  if (materialCache.has(material)) return materialCache.get(material);
  const next = material.clone();
  const role = materialRole(material);
  if (role && next.color) next.color.setHex(style[role]);
  if (role === 'emissive' && next.emissive) {
    next.emissive.setHex(style.emissive);
    next.emissiveIntensity = Math.max(0.8, Number(next.emissiveIntensity) || 0);
  }
  next.needsUpdate = true;
  materialCache.set(material, next);
  owned?.materials?.add?.(next);
  return next;
}

function prepareClone(source, runtime, style, owned, sharedMaterialCache = null) {
  const clone = source.clone(true);
  const materialCache = sharedMaterialCache || new Map();
  clone.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
    const materials = sourceMaterials.map((material) => (
      themedMaterial(material, style, owned, materialCache)
    ));
    object.material = Array.isArray(object.material) ? materials : materials[0];
  });
  clone.name = `course-feature-${runtime.id}`;
  clone.position.set(runtime.x, runtime.y, runtime.z);
  // Blender's +Y authoring axis is exported as glTF -Z. The runtime course
  // convention is +Z-forward, so rotate the authored kit once here rather
  // than allowing visible ramps and direction-sensitive props to disagree
  // with their contact profiles.
  clone.rotation.y = runtime.yaw + Math.PI;
  clone.scale.set(runtime.scale.x, runtime.scale.y, runtime.scale.z);
  clone.userData.courseFeatureId = runtime.id;
  clone.userData.catalogId = runtime.featureId;
  return clone;
}

function moduleMatrix({
  x,
  y,
  z,
  yaw = 0,
  pitch = 0,
  scaleX = 1,
  scaleY = 1,
  scaleZ = 1,
}) {
  const position = new THREE.Vector3(x, y, z);
  const rotation = new THREE.Euler(-pitch, yaw + Math.PI, 0, 'YXZ');
  const quaternion = new THREE.Quaternion().setFromEuler(rotation);
  return new THREE.Matrix4().compose(
    position,
    quaternion,
    new THREE.Vector3(scaleX, scaleY, scaleZ),
  );
}

function promoteTransformAttributes(geometry) {
  // Meshopt/quantized glTFs commonly expose normalized integer position and
  // normal attributes. BufferGeometry.applyMatrix4() writes floats back
  // through BufferAttribute.setXYZ(), which cannot preserve those values in
  // the integer storage and collapses authored modules toward the origin.
  // Promote only attributes touched by the transform; UV/color data remains
  // compact and the production GLB stays quantized on disk.
  for (const name of ['position', 'normal', 'tangent']) {
    const attribute = geometry.getAttribute(name);
    if (!attribute) continue;
    if (!attribute.isInterleavedBufferAttribute
      && attribute.array instanceof Float32Array
      && !attribute.normalized) continue;
    const itemSize = attribute.itemSize;
    const values = new Float32Array(attribute.count * itemSize);
    for (let index = 0; index < attribute.count; index++) {
      const offset = index * itemSize;
      if (itemSize > 0) values[offset] = attribute.getX(index);
      if (itemSize > 1) values[offset + 1] = attribute.getY(index);
      if (itemSize > 2) values[offset + 2] = attribute.getZ(index);
      if (itemSize > 3) values[offset + 3] = attribute.getW(index);
    }
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, itemSize));
  }
  return geometry;
}

/**
 * Flatten a detailed authored module into one immutable geometry per material.
 * Each material group can then be instanced over every bridge on the course.
 * This preserves beveled construction detail while preventing a deck slat,
 * bolt, lamp, and splice plate from becoming separate draw calls per sample.
 */
function buildModuleTemplate(source, style, owned, materialCache) {
  source.updateWorldMatrix?.(true, true);
  const sourceInverse = source.matrixWorld.clone().invert();
  const geometryByMaterial = new Map();
  const objectMatrix = new THREE.Matrix4();
  const sourceInstanceMatrix = new THREE.Matrix4();
  const relativeMatrix = new THREE.Matrix4();
  const appendGeometry = (object, instanceMatrix = null) => {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    // Production Workshop module meshes currently use one material apiece.
    // Preserve a safe fallback for future multi-material additions.
    const sourceMaterial = materials[0];
    if (!sourceMaterial || !object.geometry) return;
    object.updateWorldMatrix?.(true, false);
    objectMatrix.copy(sourceInverse).multiply(object.matrixWorld);
    relativeMatrix.copy(objectMatrix);
    if (instanceMatrix) relativeMatrix.multiply(instanceMatrix);
    const geometry = object.geometry.clone();
    promoteTransformAttributes(geometry);
    geometry.applyMatrix4(relativeMatrix);
    if (!geometryByMaterial.has(sourceMaterial)) geometryByMaterial.set(sourceMaterial, []);
    geometryByMaterial.get(sourceMaterial).push(geometry);
  };
  source.traverse((object) => {
    if (!object.isMesh) return;
    if (object.isInstancedMesh && Number(object.count) > 0) {
      for (let index = 0; index < object.count; index++) {
        object.getMatrixAt(index, sourceInstanceMatrix);
        appendGeometry(object, sourceInstanceMatrix);
      }
      return;
    }
    appendGeometry(object);
  });
  const parts = [];
  for (const [sourceMaterial, geometries] of geometryByMaterial) {
    let geometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);
    if (!geometry) {
      for (const fallback of geometries) {
        owned?.geometries?.add?.(fallback);
        parts.push({
          geometry: fallback,
          material: themedMaterial(sourceMaterial, style, owned, materialCache),
        });
      }
      continue;
    }
    if (geometries.length > 1) geometries.forEach((entry) => entry.dispose());
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    owned?.geometries?.add?.(geometry);
    parts.push({
      geometry,
      material: themedMaterial(sourceMaterial, style, owned, materialCache),
    });
  }
  return parts;
}

export function buildCircuitFeatureVisuals({
  root,
  runtimes = [],
  assetLease,
  owned,
  course = {},
  quality = 'high',
} = {}) {
  const group = new THREE.Group();
  group.name = 'kaki-course-workshop-features';
  root?.add?.(group);
  const diagnostics = {
    requested: runtimes.length,
    built: 0,
    missing: [],
    quality,
    assetId: 'courseWorkshopKit',
  };
  let cancelled = false;
  const populate = () => {
    if (cancelled || !root?.parent) return diagnostics;
    const style = themeStyle(course.drawThemeId, course);
    const materialCache = new Map();
    for (const runtime of runtimes) {
      const source = assetLease?.models?.courseWorkshopKit?.scene
        ?.getObjectByName?.(runtime.feature.assetNode);
      if (!source) {
        diagnostics.missing.push(runtime.feature.assetNode);
        continue;
      }
      const clone = prepareClone(source, runtime, style, owned, materialCache);
      runtime.visual = clone;
      if (quality === 'low' && runtime.feature.category === 'scenery') {
        clone.traverse((object) => {
          if (object.userData?.lod === 0) object.visible = false;
        });
      }
      group.add(clone);
      diagnostics.built++;
    }
    return diagnostics;
  };
  const ready = assetLease?.whenReady
    ? assetLease.whenReady('courseWorkshopKit').then(populate)
    : Promise.resolve(populate());
  return {
    group,
    diagnostics,
    ready,
    dispose() {
      cancelled = true;
      group.removeFromParent();
      group.clear();
    },
  };
}

function bridgeRouteMetrics(samples) {
  const distances = new Float64Array(samples.length + 1);
  let total = 0;
  for (let index = 1; index <= samples.length; index++) {
    const previous = samples[index - 1];
    const current = samples[index % samples.length];
    total += Math.hypot(current.x - previous.x, current.z - previous.z);
    distances[index] = total;
  }
  return { distances, total };
}

function cyclicDistance(a, b, total) {
  const direct = Math.abs(a - b);
  return Math.min(direct, total - direct);
}

/**
 * Populate a Draw course with the authored Kaki Skyway modules from the same
 * optimized workshop GLB as the feature palette. The elevated spline remains
 * the contact authority; these modules are its exact visible construction.
 */
export function buildCourseBridgeVisuals({
  root,
  course = {},
  samples = [],
  assetLease,
  owned,
  quality = 'high',
} = {}) {
  const bridges = Array.isArray(course?.overpasses) ? course.overpasses : [];
  if (!root?.add || !bridges.length || samples.length < 8) return null;
  const group = new THREE.Group();
  group.name = 'kaki-course-workshop-skyways';
  // The elevated spline is the camera/physics authority. Detailed bolts,
  // portal badges, and under-deck slats must never become chase-camera walls.
  group.userData.cameraIgnore = true;
  root.add(group);
  const diagnostics = {
    requested: bridges.length,
    bridgeCount: 0,
    deckModules: 0,
    railModules: 0,
    supportModules: 0,
    portalModules: 0,
    moduleInstances: 0,
    drawGroups: 0,
    sourceParts: 0,
    templateBounds: {},
    missing: [],
    quality,
    assetId: 'courseWorkshopKit',
  };
  const { distances, total } = bridgeRouteMetrics(samples);
  const nearestSample = (targetRaw) => {
    const target = (targetRaw % total + total) % total;
    let best = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < samples.length; index++) {
      const distance = cyclicDistance(distances[index], target, total);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    return samples[best];
  };
  let cancelled = false;
  const populate = () => {
    if (cancelled || !root?.parent) return diagnostics;
    const scene = assetLease?.models?.courseWorkshopKit?.scene;
    const style = themeStyle(course.drawThemeId, course);
    const materialCache = new Map();
    const templateCache = new Map();
    const instanceBuckets = new Map();
    const missing = new Set();
    const sourceFor = (name) => {
      const source = scene?.getObjectByName?.(name);
      if (!source) missing.add(name);
      return source;
    };
    const templateFor = (name) => {
      if (templateCache.has(name)) return templateCache.get(name);
      const source = sourceFor(name);
      if (!source) return null;
      const parts = buildModuleTemplate(source, style, owned, materialCache);
      templateCache.set(name, parts);
      diagnostics.sourceParts += parts.length;
      const bounds = new THREE.Box3();
      for (const part of parts) {
        part.geometry.computeBoundingBox();
        if (part.geometry.boundingBox) bounds.union(part.geometry.boundingBox);
      }
      const size = bounds.getSize(new THREE.Vector3());
      diagnostics.templateBounds[name] = {
        width: Number(size.x.toFixed(3)),
        height: Number(size.y.toFixed(3)),
        length: Number(size.z.toFixed(3)),
      };
      return parts;
    };
    const addModule = (name, {
      x,
      y,
      z,
      yaw = 0,
      pitch = 0,
      scaleX = 1,
      scaleY = 1,
      scaleZ = 1,
      instanceName = name,
    }) => {
      if (!templateFor(name)?.length) return false;
      if (!instanceBuckets.has(name)) instanceBuckets.set(name, []);
      instanceBuckets.get(name).push({
        name: instanceName,
        matrix: moduleMatrix({ x, y, z, yaw, pitch, scaleX, scaleY, scaleZ }),
      });
      diagnostics.moduleInstances++;
      return true;
    };
    const widthScale = (course.trackWidth + 1.3) / 10.5;
    const deckStep = quality === 'low' ? 4 : 2;
    const railStep = quality === 'low' ? 8 : 4;
    for (let index = 0; index < samples.length; index += deckStep) {
      const sample = samples[index];
      if (sample.y < 0.45 || !sample.overpassIds?.length) continue;
      const previous = samples[(index - 1 + samples.length) % samples.length];
      const next = samples[(index + 1) % samples.length];
      const span = Math.max(0.9, Math.hypot(
        next.x - previous.x,
        next.y - previous.y,
        next.z - previous.z,
      ) * 0.58);
      const yaw = Math.atan2(sample.tangent.x, sample.tangent.z);
      const pitch = Math.atan2(sample.tangent.y, Math.hypot(sample.tangent.x, sample.tangent.z) || 1);
      if (addModule('bridge_deck_module', {
        x: sample.x,
        y: sample.y,
        z: sample.z,
        yaw,
        pitch,
        scaleX: widthScale,
        scaleZ: span / 2.45,
        instanceName: `skyway-deck-${index}`,
      })) diagnostics.deckModules++;
      if (index % railStep === 0 && addModule('bridge_guardrail_module', {
        x: sample.x,
        y: sample.y,
        z: sample.z,
        yaw,
        pitch,
        scaleX: widthScale,
        scaleZ: Math.max(0.72, span / 3.7),
        instanceName: `skyway-rail-${index}`,
      })) diagnostics.railModules++;
    }
    for (const bridge of bridges) {
      const preset = ['standard', 'tall', 'huge'].includes(String(bridge.preset || '').toLowerCase())
        ? String(bridge.preset).toLowerCase()
        : 'standard';
      const referenceHeight = preset === 'huge' ? 9.2 : preset === 'tall' ? 7 : 5.2;
      const center = ((((Number(bridge.fraction) || 0) % 1) + 1) % 1) * total;
      const approach = Math.max(20, Number(bridge.approachLength) || 30);
      for (const direction of [-1, 1]) {
        const support = nearestSample(center + direction * approach * 0.46);
        if (support.y > 1.8 && addModule(`bridge_support_${preset}`, {
          x: support.x,
          y: 0,
          z: support.z,
          yaw: Math.atan2(support.tangent.x, support.tangent.z),
          scaleX: widthScale,
          scaleY: support.y / referenceHeight,
          instanceName: `skyway-support-${bridge.id}-${direction}`,
        })) diagnostics.supportModules++;
        const portal = nearestSample(center + direction * approach * 0.27);
        if (portal.y > 2.4 && addModule(`bridge_portal_${preset}`, {
          x: portal.x,
          y: portal.y,
          z: portal.z,
          yaw: Math.atan2(portal.tangent.x, portal.tangent.z),
          pitch: portal.groundPitch || 0,
          scaleX: widthScale,
          instanceName: `skyway-portal-${bridge.id}-${direction}`,
        })) diagnostics.portalModules++;
      }
      diagnostics.bridgeCount++;
    }
    for (const [moduleName, instances] of instanceBuckets) {
      const template = templateCache.get(moduleName) || [];
      for (let partIndex = 0; partIndex < template.length; partIndex++) {
        const part = template[partIndex];
        const batch = new THREE.InstancedMesh(part.geometry, part.material, instances.length);
        batch.name = `skyway-batch-${moduleName}-${partIndex}`;
        batch.castShadow = quality !== 'low';
        batch.receiveShadow = true;
        batch.userData.bridgeModule = moduleName;
        batch.userData.cameraIgnore = true;
        batch.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        for (let index = 0; index < instances.length; index++) {
          batch.setMatrixAt(index, instances[index].matrix);
        }
        batch.instanceMatrix.needsUpdate = true;
        batch.computeBoundingBox();
        batch.computeBoundingSphere();
        group.add(batch);
        diagnostics.drawGroups++;
      }
    }
    diagnostics.missing = [...missing];
    return diagnostics;
  };
  const ready = assetLease?.whenReady
    ? assetLease.whenReady('courseWorkshopKit').then(populate)
    : Promise.resolve(populate());
  return {
    group,
    diagnostics,
    ready,
    dispose() {
      cancelled = true;
      group.removeFromParent();
      group.clear();
    },
  };
}

/**
 * Build the side-view adapter for shared Workshop assets. Physics continues to
 * sample the normalized Trials course; this adapter places the exact catalog
 * model on that same X/height pair and rotates its authored forward axis into
 * the side-scrolling +X direction.
 */
export function buildTrialsCourseFeatureVisuals({
  root,
  track,
  placements = [],
  assetLease,
  owned,
  sampleGround,
  excludePlacementIds = new Set(),
  quality = 'high',
} = {}) {
  if (!root?.add || !track) return null;
  const group = new THREE.Group();
  group.name = 'kaki-trials-workshop-features';
  root.add(group);
  const diagnostics = {
    requested: 0,
    built: 0,
    missing: [],
    quality,
    assetId: 'courseWorkshopKit',
  };
  let cancelled = false;
  const populate = () => {
    if (cancelled || !root?.parent) return diagnostics;
    const scene = assetLease?.models?.courseWorkshopKit?.scene;
    const style = themeStyle(track.themeId || track.sourceOfficialId || track.id, track);
    const materialCache = new Map();
    for (const placement of placements || []) {
      if (excludePlacementIds.has(placement.id) || placement?.anchor?.mode !== 'trials') continue;
      const feature = placement.feature || getCourseFeature(placement.featureId);
      const assetNode = feature?.assetNode;
      if (!assetNode) continue;
      diagnostics.requested++;
      const source = scene?.getObjectByName?.(assetNode);
      if (!source) {
        diagnostics.missing.push(assetNode);
        continue;
      }
      const scaleX = Number(placement.anchor.scaleX) || 1;
      const scaleY = Number(placement.anchor.scaleY) || 1;
      const rampLike = !!feature.surfaceProfile && [
        'kicker',
        'launch',
        'tabletop',
        'double',
        'rollers',
        'step-up',
        'step-down',
      ].includes(feature.surfaceProfile.kind);
      const sampleX = rampLike
        ? placement.anchor.x - feature.footprint.length * scaleX * 0.5
        : placement.anchor.x;
      const ground = sampleGround?.(sampleX) || sampleGround?.(placement.anchor.x);
      const runtime = {
        id: placement.id,
        featureId: placement.featureId,
        x: placement.anchor.x,
        y: (ground?.height || 0) + (Number(placement.anchor.groundOffset) || 0),
        z: 0.3,
        yaw: placement.anchor.facing === -1 ? -Math.PI * 0.5 : Math.PI * 0.5,
        scale: { x: scaleX, y: scaleY, z: scaleX },
      };
      const clone = prepareClone(source, runtime, style, owned, materialCache);
      clone.name = `trials-feature-${placement.id}`;
      clone.userData.trialsPlacementId = placement.id;
      placement.visual = clone;
      if (quality === 'low' && feature.category === 'scenery') clone.visible = false;
      group.add(clone);
      diagnostics.built++;
    }
    return diagnostics;
  };
  const ready = assetLease?.whenReady
    ? assetLease.whenReady('courseWorkshopKit').then(populate)
    : Promise.resolve(populate());
  return {
    group,
    diagnostics,
    ready,
    dispose() {
      cancelled = true;
      group.removeFromParent();
      group.clear();
    },
  };
}
