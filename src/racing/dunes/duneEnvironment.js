import * as THREE from 'three';
import { createRacingSkyGradientMaterial } from '../../rendering/materials/racingBackdropMaterials.js';
import { nearestDuneRouteSample } from './duneEvents.js';

function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value = Math.imul(value ^ (value >>> 15), 1 | value);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function cloneAsset(gltf, name) {
  const source = gltf?.scene?.getObjectByName?.(name);
  if (!source) return null;
  const clone = source.clone(true);
  clone.name = `${name}-contents`;
  clone.position.set(0, 0, 0);
  clone.rotation.set(0, 0, 0);
  clone.scale.set(1, 1, 1);
  clone.traverse((object) => {
    if (!object.isMesh) return;
    const collider = object.name.includes('_COLLIDER') || object.userData?.collision_proxy;
    object.visible = !collider;
    object.castShadow = !collider;
    object.receiveShadow = !collider;
    object.frustumCulled = true;
  });
  // The reproducible Blender source keeps kit pieces laid out as a review
  // sheet. Re-center each cloned piece at runtime so authored sheet offsets
  // never leak into checkpoint, stamp, or landmark placement.
  const wrapper = new THREE.Group();
  wrapper.name = `${name}-runtime`;
  wrapper.add(clone);
  wrapper.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(wrapper);
  if (!bounds.isEmpty()) {
    const center = bounds.getCenter(new THREE.Vector3());
    clone.position.x -= center.x;
    clone.position.z -= center.z;
    clone.position.y -= bounds.min.y;
  }
  return wrapper;
}

function placeAsset(node, surfaceField, {
  x,
  z,
  yaw = 0,
  scale = 1,
  yOffset = 0,
} = {}) {
  if (!node) return null;
  node.position.set(x, surfaceField.heightAt(x, z) + yOffset, z);
  node.rotation.y = yaw;
  node.scale.setScalar(scale);
  node.userData.dunePlaced = true;
  return node;
}

function addLodAsset(environment, gltf, name, x, z, yaw, scale = 1) {
  const high = cloneAsset(gltf, `${name}_LOD0`);
  if (!high) return null;
  const low = cloneAsset(gltf, `${name}_LOD1`);
  const lod = new THREE.LOD();
  lod.name = `${name}-dune-lod`;
  high.position.set(0, 0, 0);
  lod.addLevel(high, 0);
  if (low) {
    low.position.set(0, 0, 0);
    lod.addLevel(low, 125);
  }
  placeAsset(lod, environment.surfaceField, { x, z, yaw, scale });
  lod.autoUpdate = true;
  environment.scenery.add(lod);
  environment.lods.push(lod);
  return lod;
}

function routeClear(environment, x, z, clearance) {
  return nearestDuneRouteSample(environment.routeRuntime, x, z, 0, 99999).distance > clearance;
}

function scatterAssets(environment, gltf) {
  const { eventDefinition, surfaceField } = environment;
  const random = seeded(eventDefinition.seed ^ 0xa7735);
  const half = eventDefinition.worldSize * 0.44;
  const attempts = environment.quality === 'low' ? 65 : environment.quality === 'medium' ? 105 : 155;
  const targetCount = environment.quality === 'low' ? 22 : environment.quality === 'medium' ? 38 : 58;
  let placed = 0;
  for (let attempt = 0; attempt < attempts && placed < targetCount; attempt += 1) {
    const x = (random() * 2 - 1) * half;
    const z = (random() * 2 - 1) * half;
    if (!routeClear(environment, x, z, eventDefinition.routeWidth * 0.78 + 7)) continue;
    const roll = random();
    const name = roll < 0.42
      ? (random() < 0.5 ? 'DuneScrub_A' : 'DuneScrub_B')
      : roll < 0.59
        ? 'DuneDeadwood_A'
        : roll < 0.86
          ? null
          : 'DuneSign_PawRoute';
    if (name) {
      const node = cloneAsset(gltf, name);
      if (!node) continue;
      const scale = name.startsWith('DuneScrub')
        ? 0.72 + random() * 0.8
        : name === 'DuneDeadwood_A' ? 0.75 + random() * 0.65 : 0.8 + random() * 0.28;
      placeAsset(node, surfaceField, {
        x,
        z,
        yaw: random() * Math.PI * 2,
        scale,
      });
      environment.scenery.add(node);
    } else {
      addLodAsset(
        environment,
        gltf,
        'DuneRockSpire_A',
        x,
        z,
        random() * Math.PI * 2,
        0.45 + random() * 0.78,
      );
    }
    placed += 1;
  }
  return placed;
}

function addCheckpointAssets(environment, gltf) {
  const gates = [];
  for (let index = 0; index < environment.checkpoints.length; index += 1) {
    const checkpoint = environment.checkpoints[index];
    const gate = cloneAsset(gltf, 'DuneRallyGate_Master');
    if (!gate) continue;
    // The authored arch is six metres wide and nearly as tall. Route flags
    // describe the full checkpoint width; scaling the arch to that full width
    // makes 25 m towers that hide every following crest.
    const gateScale = Math.max(1.2, Math.min(1.9, checkpoint.width / 12));
    placeAsset(gate, environment.surfaceField, {
      x: checkpoint.x,
      z: checkpoint.z,
      yaw: checkpoint.yaw,
      scale: gateScale,
    });
    gate.name = `DuneCheckpoint-${checkpoint.id}`;
    gate.userData.checkpointIndex = index;
    environment.checkpointGroup.add(gate);
    gates.push(gate);

    const rightX = Math.cos(checkpoint.yaw);
    const rightZ = -Math.sin(checkpoint.yaw);
    for (const side of [-1, 1]) {
      const flag = cloneAsset(gltf, 'DuneRouteFlag_Master');
      if (!flag) continue;
      const x = checkpoint.x + rightX * checkpoint.width * 0.63 * side;
      const z = checkpoint.z + rightZ * checkpoint.width * 0.63 * side;
      placeAsset(flag, environment.surfaceField, {
        x,
        z,
        yaw: checkpoint.yaw + (side < 0 ? Math.PI : 0),
        scale: 0.88,
      });
      flag.userData.windPhase = index * 0.63 + side;
      environment.flags.push(flag);
      environment.checkpointGroup.add(flag);
    }
  }
  return gates;
}

function landmarkSample(environment, progress) {
  const samples = environment.routeRuntime.samples;
  return samples[Math.min(samples.length - 1, Math.round(progress * (samples.length - 1)))];
}

function addLandmarks(environment, gltf) {
  const placements = [
    ['DuneServiceCamp_A', 0.04, -1, 14, 1],
    ['DuneOasis_A', 0.57, 1, 23, 1.15],
    ['DuneWreckedRallyProp_A', 0.31, -1, 11, 0.9],
    ['DuneDestructibleSupplyStack_A', 0.78, 1, 13, 0.95],
  ];
  for (let index = 0; index < placements.length; index += 1) {
    const [name, progress, side, distance, scale] = placements[index];
    const sample = landmarkSample(environment, progress);
    if (!sample) continue;
    const rightX = Math.cos(sample.yaw);
    const rightZ = -Math.sin(sample.yaw);
    const x = sample.x + rightX * distance * side;
    const z = sample.z + rightZ * distance * side;
    const node = cloneAsset(gltf, name);
    if (!node) continue;
    placeAsset(node, environment.surfaceField, {
      x,
      z,
      yaw: sample.yaw + (side < 0 ? Math.PI * 0.5 : -Math.PI * 0.5),
      scale,
    });
    node.name = `${name}-${environment.eventDefinition.id}`;
    environment.landmarks.add(node);
  }
  const archSample = landmarkSample(environment, 0.2);
  const arch = cloneAsset(gltf, 'DuneRockArch_A_LOD0');
  if (arch && archSample) {
    const rightX = Math.cos(archSample.yaw);
    const rightZ = -Math.sin(archSample.yaw);
    const archOffset = environment.eventDefinition.id === 'sunspine' ? 56 : 72;
    placeAsset(arch, environment.surfaceField, {
      x: archSample.x + rightX * archOffset,
      z: archSample.z + rightZ * archOffset,
      yaw: archSample.yaw,
      scale: environment.eventDefinition.id === 'sunspine' ? 1.05 : 0.85,
    });
    environment.landmarks.add(arch);
  }
  const farRadius = environment.eventDefinition.worldSize * 0.48;
  for (let index = 0; index < 8; index += 1) {
    const angle = index / 8 * Math.PI * 2 + 0.2;
    addLodAsset(
      environment,
      gltf,
      'DuneMesa_A',
      Math.cos(angle) * farRadius,
      Math.sin(angle) * farRadius,
      -angle + Math.PI * 0.5,
      3.8 + (index % 3) * 0.8,
    );
  }
}

const DRAW_JUMP_FEATURES = new Set([
  'small-kicker',
  'large-launch-ramp',
  'tabletop',
  'double-jump',
  'roller-bumps',
  'step-up',
  'step-down',
]);

function drawPlacementAsset(featureId, ordinal) {
  if (featureId === 'rally-flags' || featureId === 'checkpoint-gate') return 'DuneRouteFlag_Master';
  if (featureId === 'direction-signs' || DRAW_JUMP_FEATURES.has(featureId)) return 'DuneSign_PawRoute';
  if (featureId === 'foliage-group') return ordinal % 3 === 0 ? 'DuneDeadwood_A' : ordinal % 2 ? 'DuneScrub_A' : 'DuneScrub_B';
  if (featureId === 'theme-landmark' || featureId === 'water-splash') return 'DuneOasis_A';
  if (featureId === 'construction-equipment' || featureId === 'toy-cars') return 'DuneWreckedRallyProp_A';
  if (['wooden-crates', 'hay-bales', 'barrel-stack', 'kaki-delivery-cart', 'smash-target-chain'].includes(featureId)) {
    return 'DuneDestructibleSupplyStack_A';
  }
  return null;
}

function addDrawPlacements(environment, gltf) {
  const placements = environment.eventDefinition.drawFeaturePlacements || [];
  const samples = environment.routeRuntime.samples;
  let placed = 0;
  for (let index = 0; index < placements.length; index += 1) {
    const placement = placements[index];
    const sample = samples[Math.min(
      samples.length - 1,
      Math.max(0, Math.round(placement.fraction * (samples.length - 1))),
    )];
    if (!sample) continue;
    const rightX = Math.cos(sample.yaw);
    const rightZ = -Math.sin(sample.yaw);
    const x = sample.x + rightX * placement.lateralOffset;
    const z = sample.z + rightZ * placement.lateralOffset;
    const scale = clampDrawScale((placement.scaleX + placement.scaleY + placement.scaleZ) / 3);
    if (placement.featureId === 'rock-pile') {
      const lod = addLodAsset(
        environment,
        gltf,
        'DuneRockSpire_A',
        x,
        z,
        sample.yaw + placement.rotationOffset,
        scale * 0.72,
      );
      if (lod) {
        lod.name = `DuneDraw-${placement.id}`;
        placed += 1;
      }
      continue;
    }
    const assetName = drawPlacementAsset(placement.featureId, index);
    if (!assetName) continue;
    const node = cloneAsset(gltf, assetName);
    if (!node) continue;
    placeAsset(node, environment.surfaceField, {
      x,
      z,
      yaw: sample.yaw + placement.rotationOffset + (placement.facing === 'backward' ? Math.PI : 0),
      scale: DRAW_JUMP_FEATURES.has(placement.featureId) ? scale * 0.76 : scale,
    });
    node.name = `DuneDraw-${placement.id}`;
    node.userData.drawFeatureId = placement.featureId;
    node.userData.windPhase = index * 0.49;
    if (assetName === 'DuneRouteFlag_Master') environment.flags.push(node);
    environment.scenery.add(node);
    placed += 1;
  }
  return placed;
}

function clampDrawScale(value) {
  return Math.max(0.7, Math.min(1.5, Number(value) || 1));
}

export function buildDuneEnvironment({
  root,
  eventDefinition,
  surfaceField,
  routeRuntime,
  checkpoints = [],
  quality = 'medium',
  reduceMotion = false,
} = {}) {
  const group = new THREE.Group();
  group.name = `KakiDuneEnvironment-${eventDefinition.id}`;
  root.add(group);
  const skyMaterial = createRacingSkyGradientMaterial({
    horizon: eventDefinition.palette.horizon,
    zenith: eventDefinition.palette.skyTop,
  });
  // Racing cameras cap their far plane at 800 m. A world-sized sphere beyond
  // that plane is clipped into a circular cap, exposing the flat background
  // around it. Keep the player-centered atmosphere comfortably inside the
  // shared camera range so every view ray resolves the gradient.
  const skyRadius = Math.min(620, Math.max(420, eventDefinition.worldSize * 0.65));
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(skyRadius, 32, 16),
    skyMaterial,
  );
  sky.name = 'KakiDuneAtmosphereSky';
  sky.renderOrder = -100;
  sky.frustumCulled = false;
  group.add(sky);

  const hemisphere = new THREE.HemisphereLight(
    eventDefinition.palette.skyTop,
    0x5a3423,
    eventDefinition.weather === 'sandstorm' ? 1.45 : 1.8,
  );
  hemisphere.name = 'KakiDuneCoolAmbient';
  group.add(hemisphere);
  const sun = new THREE.DirectionalLight(
    eventDefinition.palette.sun,
    eventDefinition.timeOfDay === 'sunset' ? 4.25 : eventDefinition.weather === 'sandstorm' ? 2.75 : 3.8,
  );
  sun.name = 'KakiDuneWarmSun';
  const sunAngle = eventDefinition.timeOfDay === 'sunset' ? 0.18 : 0.48;
  const sunDistance = 190;
  sun.position.set(
    Math.cos(sunAngle) * sunDistance,
    eventDefinition.timeOfDay === 'sunset' ? 58 : 120,
    Math.sin(sunAngle) * sunDistance,
  );
  sun.castShadow = true;
  const shadowSize = quality === 'low' ? 1024 : quality === 'ultra' ? 3072 : 2048;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  const shadowExtent = quality === 'low' ? 52 : quality === 'medium' ? 72 : 94;
  sun.shadow.camera.left = -shadowExtent;
  sun.shadow.camera.right = shadowExtent;
  sun.shadow.camera.top = shadowExtent;
  sun.shadow.camera.bottom = -shadowExtent;
  sun.shadow.camera.near = 2;
  sun.shadow.camera.far = 360;
  sun.shadow.bias = -0.00035;
  group.add(sun);
  group.add(sun.target);

  const scenery = new THREE.Group();
  scenery.name = 'KakiDuneAuthoredScenery';
  const landmarks = new THREE.Group();
  landmarks.name = 'KakiDuneEventLandmarks';
  const checkpointGroup = new THREE.Group();
  checkpointGroup.name = 'KakiDuneCheckpointPresentation';
  group.add(scenery, landmarks, checkpointGroup);
  const environment = {
    group,
    sky,
    skyMaterial,
    hemisphere,
    sun,
    scenery,
    landmarks,
    checkpointGroup,
    eventDefinition,
    surfaceField,
    routeRuntime,
    checkpoints,
    quality,
    reduceMotion,
    flags: [],
    lods: [],
    kitAttached: false,
    scatterCount: 0,
    drawPlacementCount: 0,
    disposed: false,
  };
  return environment;
}

export function attachDuneEnvironmentKit(environment, gltf) {
  if (!environment || environment.kitAttached || !gltf?.scene) return false;
  environment.kitAttached = true;
  environment.scatterCount = scatterAssets(environment, gltf);
  addCheckpointAssets(environment, gltf);
  addLandmarks(environment, gltf);
  environment.drawPlacementCount = addDrawPlacements(environment, gltf);
  return true;
}

export function updateDuneEnvironment(environment, time, kart = null) {
  if (!environment || environment.disposed) return;
  const wind = environment.eventDefinition.weather === 'sandstorm' ? 1 : 0.42;
  for (let index = 0; index < environment.flags.length; index += 1) {
    const flag = environment.flags[index];
    const phase = finitePhase(flag.userData.windPhase);
    flag.rotation.z = environment.reduceMotion
      ? 0
      : Math.sin(time * (2.2 + wind) + phase) * 0.035 * wind;
  }
  if (kart) {
    environment.sky.position.set(kart.x, 0, kart.z);
    environment.sun.position.x = kart.x + Math.cos(0.18) * 190;
    environment.sun.position.z = kart.z + Math.sin(0.18) * 190;
    environment.sun.target.position.set(kart.x, 0, kart.z);
    environment.sun.target.updateMatrixWorld();
  }
}

function finitePhase(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export function duneEnvironmentSnapshot(environment) {
  return {
    eventId: environment?.eventDefinition?.id || '',
    kitAttached: !!environment?.kitAttached,
    authoredScatter: environment?.scatterCount || 0,
    flags: environment?.flags?.length || 0,
    lods: environment?.lods?.length || 0,
    checkpointGates: environment?.checkpointGroup?.children?.filter(
      (node) => node.name.startsWith('DuneCheckpoint-'),
    ).length || 0,
    drawPlacements: environment?.drawPlacementCount || 0,
    weather: environment?.eventDefinition?.weather || '',
    timeOfDay: environment?.eventDefinition?.timeOfDay || '',
  };
}

export function disposeDuneEnvironment(environment) {
  if (!environment || environment.disposed) return;
  environment.disposed = true;
  environment.group.parent?.remove(environment.group);
  environment.sky.geometry.dispose();
  environment.skyMaterial.dispose();
  if (environment.sun.shadow?.map) environment.sun.shadow.map.dispose();
}
