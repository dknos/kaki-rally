/**
 * Terra-STL AAA grass adapted to Kaki Rally's course corridor.
 *
 * Visual traits retained from the tested donor:
 * - curved tapered multi-blade carpet and emergent clumps
 * - dry, seed-head, and broad forb forms
 * - soil-darkened bases and base-to-tip color
 * - deterministic low-frequency patchiness
 * - per-instance tint and tip-weighted wind
 *
 * Rally owns smaller quality-scaled budgets and clears the complete sampled
 * road. This module is presentation-only and never changes physics.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRallyGrassMaterial } from '../rendering/materials/rallyGrassMaterial.js';
import {
  createRallyGrassLayout,
  createRallyGrassRandom,
  RALLY_GRASS_QUALITY,
  RALLY_GRASS_SCHEMA,
} from './rallyGrassLayout.js';

const _dummy = new THREE.Object3D();
const _instanceColor = new THREE.Color();

function lerp3(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta > 1e-6) {
    if (max === r) hue = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
    else if (max === g) hue = ((b - r) / delta + 2) / 6;
    else hue = ((r - g) / delta + 4) / 6;
  }
  return [hue, max < 1e-6 ? 0 : delta / max, max];
}

function hsvToRgb(h, s, v) {
  const index = Math.floor(h * 6);
  const fraction = h * 6 - index;
  const p = v * (1 - s);
  const q = v * (1 - fraction * s);
  const t = v * (1 - (1 - fraction) * s);
  switch (index % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

function createBlade({
  width,
  height,
  restBend,
  base,
  tip,
  soil,
  random,
  seedHead = false,
  broad = false,
}) {
  // Three height segments retain the authored quadratic/cubic bow while
  // cutting a quarter of the submitted card triangles versus the Terra
  // eye-level laboratory's four-segment blades.
  const geometry = new THREE.PlaneGeometry(broad ? width * 2.35 : width, height, 1, 3);
  geometry.translate(0, height * 0.5, 0);
  const positions = geometry.attributes.position;
  const uvs = geometry.attributes.uv;
  const colors = new Float32Array(positions.count * 3);
  const lean = (random() - 0.5) * 0.35;
  const bend = restBend * (0.7 + random() * 0.6);
  const hueJitter = (random() - 0.5) * 0.04;
  const valueJitter = 0.92 + random() * 0.16;

  for (let index = 0; index < positions.count; index += 1) {
    const amount = uvs.getY(index);
    const bow = bend * (amount * amount * 0.65 + amount * amount * amount * 0.35);
    const taper = 1 - amount * (broad ? 0.55 : 0.88);
    positions.setX(index, positions.getX(index) * taper + bow * lean + bow * 0.15);
    positions.setZ(index, positions.getZ(index) + bow);
    const soilMix = (1 - amount) * 0.45;
    let rgb = lerp3(base, tip, amount * amount * 0.35 + amount * 0.65);
    rgb = lerp3(rgb, soil, soilMix);
    const ao = 0.55 + 0.45 * amount;
    let [hue, saturation, value] = rgbToHsv(...rgb);
    hue = (hue + hueJitter + 1) % 1;
    saturation *= amount > 0.7 ? 0.87 : 0.95;
    value = Math.min(1.2, value * valueJitter * ao);
    const output = hsvToRgb(hue, saturation, value);
    if (seedHead && amount > 0.78) {
      const blend = (amount - 0.78) / 0.22;
      output[0] = output[0] * (1 - blend) + tip[0] * blend;
      output[1] = output[1] * (1 - blend) + tip[1] * blend;
      output[2] = output[2] * (1 - blend) + tip[2] * blend;
      positions.setX(index, positions.getX(index) * (1 + blend * 0.75));
    }
    colors[index * 3] = output[0];
    colors[index * 3 + 1] = output[1];
    colors[index * 3 + 2] = output[2];
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function createClumpGeometry(random, form, biome) {
  const palette = biome.palette;
  const emergent = form === 'emergent';
  const bladeCount = emergent
    ? 7 + Math.floor(random() * 5)
    : 12 + Math.floor(random() * 6);
  const parts = [];
  for (let index = 0; index < bladeCount; index += 1) {
    const roll = random();
    let kind = 'healthy';
    if (emergent) {
      if (roll < 0.34) kind = 'seed';
      else if (roll < 0.48) kind = 'dry';
    } else if (roll < biome.dryFraction) kind = 'dry';
    else if (roll < biome.dryFraction + 0.1) kind = 'forb';
    else if (roll < biome.dryFraction + 0.14) kind = 'seed';

    let base = palette.healthyBase;
    let tip = palette.healthyTip;
    let width = 0.028 + random() * 0.028;
    let height = (emergent ? 0.72 : 0.48) * (0.8 + random() * 0.45);
    let restBend = 0.1 + random() * 0.1;
    let seedHead = false;
    let broad = false;
    if (kind === 'dry') {
      base = palette.dryBase;
      tip = palette.dryTip;
      width = 0.035 + random() * 0.025;
      height = (emergent ? 0.7 : 0.42) * (0.75 + random() * 0.45);
      restBend = 0.18 + random() * 0.12;
    } else if (kind === 'seed') {
      base = palette.seedBase;
      tip = palette.seedTip;
      width = 0.022 + random() * 0.012;
      height = (emergent ? 0.95 : 0.72) * (0.85 + random() * 0.35);
      restBend = 0.08 + random() * 0.08;
      seedHead = true;
    } else if (kind === 'forb') {
      base = palette.forbBase;
      tip = palette.forbTip;
      width = 0.045 + random() * 0.025;
      height = 0.18 + random() * 0.12;
      restBend = 0.05 + random() * 0.05;
      broad = true;
    }

    const blade = createBlade({
      width,
      height,
      restBend,
      base,
      tip,
      soil: palette.soil,
      random,
      seedHead,
      broad,
    });
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random()) * (emergent ? 0.18 : 0.42);
    blade.rotateY(angle + (random() - 0.5) * 0.5);
    blade.rotateZ((random() - 0.5) * 0.25);
    blade.rotateX((random() - 0.5) * 0.12);
    blade.translate(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    parts.push(blade);
  }
  const geometry = mergeGeometries(parts);
  parts.forEach((part) => part.dispose());
  const normals = geometry.attributes.normal;
  for (let index = 0; index < normals.count; index += 1) normals.setXYZ(index, 0, 1, 0);
  const positions = geometry.attributes.position;
  let maximumY = 0;
  for (let index = 0; index < positions.count; index += 1) {
    maximumY = Math.max(maximumY, positions.getY(index));
  }
  const tips = new Float32Array(positions.count);
  for (let index = 0; index < positions.count; index += 1) {
    tips[index] = maximumY > 1e-6 ? positions.getY(index) / maximumY : 0;
  }
  geometry.setAttribute('tip', new THREE.BufferAttribute(tips, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function setInstance(mesh, index, placement) {
  _dummy.position.set(placement.x, placement.y, placement.z);
  _dummy.rotation.set(0, placement.rotation, 0);
  _dummy.scale.setScalar(placement.scale);
  _dummy.updateMatrix();
  mesh.setMatrixAt(index, _dummy.matrix);
}

function setInstanceTint(mesh, index, placement, biome, form) {
  // instanceColor multiplies the already-authored vertex palette. Keep it as
  // a near-white tint multiplier; feeding the palette color here would square
  // the albedo and turn distant Rally grass into black needles.
  const value = 0.84 + placement.tint * 0.3;
  const warmth = form === 'emergent' ? 0.035 : 0;
  _instanceColor.setRGB(
    value * (1 + warmth + (placement.tint - 0.5) * 0.055),
    value * (1.02 + (0.5 - placement.tint) * 0.035),
    value * (0.92 - warmth + placement.tint * 0.04),
  );
  mesh.setColorAt(index, _instanceColor);
}

function createLayerMeshes({
  group,
  form,
  placements,
  templateCount,
  random,
  biome,
  material,
  resources,
}) {
  const buckets = Array.from({ length: templateCount }, () => []);
  for (let index = 0; index < placements.length; index += 1) {
    buckets[index % templateCount].push(placements[index]);
  }
  for (let templateIndex = 0; templateIndex < templateCount; templateIndex += 1) {
    const bucket = buckets[templateIndex];
    if (!bucket.length) continue;
    const geometry = createClumpGeometry(random, form, biome);
    const mesh = new THREE.InstancedMesh(geometry, material, bucket.length);
    mesh.name = `rally-terra-grass-${form}-${templateIndex}`;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.userData.presentationOnly = true;
    mesh.userData.grassForm = form;
    for (let index = 0; index < bucket.length; index += 1) {
      setInstance(mesh, index, bucket[index]);
      setInstanceTint(mesh, index, bucket[index], biome, form);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.setUsage(THREE.StaticDrawUsage);
      mesh.instanceColor.needsUpdate = true;
    }
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    group.add(mesh);
    resources.geometries.push(geometry);
    resources.meshes.push(mesh);
  }
}

function renderStats(group) {
  let drawCalls = 0;
  let instances = 0;
  let submittedTriangles = 0;
  let geometryBytes = 0;
  let instanceBytes = 0;
  group.traverse((object) => {
    if (!object.isInstancedMesh) return;
    drawCalls += 1;
    instances += object.count;
    const geometry = object.geometry;
    const vertices = geometry.index?.count || geometry.attributes.position.count;
    submittedTriangles += vertices / 3 * object.count;
    for (const attribute of Object.values(geometry.attributes)) geometryBytes += attribute.array.byteLength;
    if (geometry.index) geometryBytes += geometry.index.array.byteLength;
    instanceBytes += object.instanceMatrix.array.byteLength;
    if (object.instanceColor) instanceBytes += object.instanceColor.array.byteLength;
  });
  return { drawCalls, instances, submittedTriangles, geometryBytes, instanceBytes };
}

export function createRallyGrassLayer({
  course,
  samples,
  quality = 'high',
  mode = course?.mode || 'circuit',
  groundSize = 360,
  heightAt,
  reduceMotion = false,
} = {}) {
  const normalizedQuality = RALLY_GRASS_QUALITY[quality] ? quality : 'high';
  const layout = createRallyGrassLayout({
    course,
    samples,
    quality: normalizedQuality,
    mode,
    groundSize,
    heightAt,
  });
  const group = new THREE.Group();
  group.name = `rally-terra-grass-${course.id}`;
  group.userData.presentationOnly = true;
  group.userData.schema = RALLY_GRASS_SCHEMA;
  const material = createRallyGrassMaterial({
    translucent: layout.biome.palette.translucent,
    windStrength: 1,
    reduceMotion,
  });
  const resources = { geometries: [], materials: [material], meshes: [] };
  const random = createRallyGrassRandom(layout.seed ^ 0x9E3779B9);
  const templateCount = RALLY_GRASS_QUALITY[normalizedQuality].templates;
  createLayerMeshes({
    group,
    form: 'carpet',
    placements: layout.carpet,
    templateCount,
    random,
    biome: layout.biome,
    material,
    resources,
  });
  createLayerMeshes({
    group,
    form: 'emergent',
    placements: layout.emergent,
    templateCount,
    random,
    biome: layout.biome,
    material,
    resources,
  });
  const gpu = renderStats(group);
  let disposed = false;
  const stats = Object.freeze({
    schema: RALLY_GRASS_SCHEMA,
    courseId: layout.courseId,
    quality: normalizedQuality,
    counts: layout.counts,
    roadClearance: layout.roadClearance,
    drawCalls: gpu.drawCalls,
    submittedTriangles: Math.round(gpu.submittedTriangles),
    geometryBytes: gpu.geometryBytes,
    instanceBytes: gpu.instanceBytes,
    wind: reduceMotion ? 'disabled-reduced-motion' : 'tsl-tip-weighted',
  });
  group.userData.stats = stats;

  return {
    group,
    layout,
    getStats: () => stats,
    update(timeSeconds) {
      if (disposed) return;
      const time = Number.isFinite(Number(timeSeconds)) ? Number(timeSeconds) : 0;
      const gust = 0.75 + 0.25 * Math.sin(time * 0.27);
      material.updateGrassWind?.(time, gust);
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      group.removeFromParent();
      for (const mesh of resources.meshes) {
        mesh.dispose?.();
        mesh.removeFromParent();
      }
      for (const geometry of resources.geometries) geometry.dispose();
      for (const ownedMaterial of resources.materials) ownedMaterial.dispose();
      resources.meshes.length = 0;
      resources.geometries.length = 0;
      resources.materials.length = 0;
      group.clear();
      return true;
    },
  };
}
