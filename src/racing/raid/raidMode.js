// Kaki Rally Raid — mode entry point.
//
// This is the only file the shell knows about. It owns a session and every
// resource inside it, and it disposes all of them on exit: the shell keeps the
// canvas, the renderer, the scene, the animation loop, pause, and navigation.
//
// Scope note, kept honest: this is the Wave 1 lifecycle plus the Wave 2 terrain
// slice. There is no nested clipmap, no TSL terrain material, no environment
// scatter, no roadbook UI, no rivals and no audio. The terrain is a single
// CPU-displaced patch that follows the vehicle and reads the same streamed
// authority the wheels do, which is enough to prove the streaming works and to
// look at, and is deliberately simple rather than a placeholder for something
// that pretends to be finished.

import * as THREE from 'three/webgpu';

import { state } from '../../state.js';
import { isDashPressed, isHandbrakePressed } from '../../input.js';
import { buildRallyRaidVehicle } from '../racingVehicles.js';
import { buildRaidRoute, buildRaidRouteIndex, nearestRaidRouteSample, raidRouteLateral } from './raidRouteRuntime.js';
import { getRaidStage, validateRaidStage } from './raidStageBlueprints.js';
import { createRaidTerrainProvider } from './raidTerrainProvider.js';
import { RAID_SECTOR_METRES } from './raidSectorGenerator.js';
import { clamp } from './raidSurfaceField.js';
import { createRallyAssetLease } from '../racingAssets.js';
import { createRaidEnvironment } from './raidEnvironment.js';
import { createRaidHud } from './raidHud.js';
import { createRaidVehicle, stepRaidVehicle } from './raidVehiclePhysics.js';

// The visible terrain patch. 768 m across at 3 m resolution: large enough that
// the horizon is a landscape rather than a tabletop, cheap enough to re-displace
// on the CPU when the vehicle crosses a cell.
const PATCH_METRES = 1536;
const PATCH_SEGMENTS = 320;
const PATCH_STEP = PATCH_METRES / PATCH_SEGMENTS;

const FIXED_STEP = 1 / 120;
const MAX_SUBSTEPS = 8;

let _session = null;

function buildTerrainPatch(owned) {
  const geometry = new THREE.PlaneGeometry(PATCH_METRES, PATCH_METRES, PATCH_SEGMENTS, PATCH_SEGMENTS);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    flatShading: false,
  });
  const count = geometry.attributes.position.count;
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'kaki-raid-terrain';
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  owned.geometries.add(geometry);
  owned.materials.add(material);
  return mesh;
}

// Re-displace the patch around a new centre. Snapped to the terrain cell grid
// so the surface does not shimmer as the vehicle moves between updates.
const PATCH_COLOUR = new THREE.Color();
function refreshTerrainPatch(session, centreX, centreZ) {
  const snappedX = Math.round(centreX / PATCH_STEP) * PATCH_STEP;
  const snappedZ = Math.round(centreZ / PATCH_STEP) * PATCH_STEP;
  const position = session.terrain.geometry.attributes.position;
  const colour = session.terrain.geometry.attributes.color;
  const array = position.array;
  const colours = colour.array;
  const provider = session.provider;
  const surface = session.scratchSurface;
  for (let index = 0; index < position.count; index += 1) {
    const offset = index * 3;
    const worldX = snappedX + array[offset];
    const worldZ = snappedZ + array[offset + 2];
    array[offset + 1] = provider.heightAt(worldX, worldZ);
    provider.surfaceAt(worldX, worldZ, surface);
    PATCH_COLOUR.setHex(provider.surfaces[surface.id]?.colour ?? 0xc0a071);
    // Darken loose ground slightly so surface changes read at speed.
    const shade = 1 - surface.looseness * 0.16;
    colours[offset] = PATCH_COLOUR.r * shade;
    colours[offset + 1] = PATCH_COLOUR.g * shade;
    colours[offset + 2] = PATCH_COLOUR.b * shade;
  }
  session.environment?.refresh(snappedX, snappedZ);
  session.terrain.position.set(snappedX, 0, snappedZ);
  position.needsUpdate = true;
  colour.needsUpdate = true;
  session.terrain.geometry.computeVertexNormals();
  session.patchCentre.set(snappedX, 0, snappedZ);
  session.patchRefreshes += 1;
}

export async function enterRaidMode(scene, options = {}) {
  if (!scene) throw new Error('Kaki Rally Raid needs a scene');
  if (_session) exitRaidMode(scene, _session);

  const blueprint = getRaidStage(options.stageId || options.courseId);
  const route = buildRaidRoute(blueprint);
  const validation = validateRaidStage(blueprint, route);
  if (!validation.ok) {
    throw new Error(`Raid stage ${blueprint.id} is invalid: ${validation.errors.join('; ')}`);
  }

  const owned = { geometries: new Set(), materials: new Set(), textures: new Set() };
  const root = new THREE.Group();
  root.name = `kaki-raid-${blueprint.id}`;
  scene.add(root);

  const quality = state._optQuality || options.quality || 'high';
  const provider = createRaidTerrainProvider({ route, quality, useWorker: options.useWorker !== false });

  const session = {
    scene,
    root,
    owned,
    raceMode: 'raid',
    stageId: blueprint.id,
    blueprint,
    route,
    routeIndex: buildRaidRouteIndex(route),
    provider,
    disposed: false,
    cameraHost: options.cameraHost || {},
    camera: null,
    terrain: null,
    vehicleVisual: null,
    vehicle: null,
    hud: null,
    environment: null,
    assetLease: null,
    accumulator: 0,
    elapsed: 0,
    patchCentre: new THREE.Vector3(),
    patchRefreshes: 0,
    scratchSurface: {},
    referenceMeters: 0,
    traveledMeters: 0,
    offRouteMeters: 0,
    physicsTimeMs: 0,
    lights: [],
  };

  // Terrain authority must exist before the player is given control. This is
  // the one place a Raid session is allowed to await terrain.
  await provider.preloadAround(route.startX, route.startZ, 1);

  // Raid-owned asset lease. Only the Raid kit is requested, so no other mode's
  // assets are pulled in and none of Raid's leak into another mode's load set.
  session.assetLease = createRallyAssetLease({
    mode: 'raid',
    assetIds: ['raidEnvironmentKit'],
    renderer: state.renderer || null,
  });
  await session.assetLease.ready;

  session.terrain = buildTerrainPatch(owned);
  root.add(session.terrain);

  const kit = session.assetLease.models?.raidEnvironmentKit?.scene
    || session.assetLease.models?.raidEnvironmentKit
    || null;
  if (kit) {
    session.environment = createRaidEnvironment({
      kit,
      provider,
      seed: route.seed,
      quality,
      owned,
    });
    root.add(session.environment.root);
  }

  refreshTerrainPatch(session, route.startX, route.startZ);

  // Lighting. Owned by the session so exit takes it with everything else.
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
  sun.position.set(-260, 340, 180);
  const sky = new THREE.HemisphereLight(0xbfd9ff, 0xb08b56, 1.15);
  root.add(sun, sky);
  session.lights.push(sun, sky);

  // The shell makes the menu hero visible before handing over, and the vehicle
  // builder expects to adopt it as the seated driver. Skipping that leaves the
  // hero standing loose in the desert at menu scale, which is what it looks
  // like: a giant cat parked on the start line.
  const hero = state.hero?.mesh || null;
  session.savedHero = hero
    ? {
      parent: hero.parent,
      position: hero.position.clone(),
      quaternion: hero.quaternion.clone(),
      scale: hero.scale.clone(),
      visible: hero.visible,
    }
    : null;
  const vehicleVisual = buildRallyRaidVehicle({
    rallyRaidVehicleId: 'prototype',
    driver: hero,
    owned,
    isPlayer: true,
  });
  session.vehicleVisual = vehicleVisual;
  root.add(vehicleVisual.root);
  // Record each wheel's authored rest height once, so suspension travel is an
  // offset from the model rather than from an undefined field.
  for (const wheel of vehicleVisual.wheels || []) {
    if (wheel) wheel.userData.raidRestY = wheel.position.y;
  }

  const startHeight = provider.heightAt(route.startX, route.startZ);
  session.vehicle = createRaidVehicle({
    x: route.startX,
    y: startHeight,
    z: route.startZ,
    yaw: route.startYaw,
    wheelRadius: vehicleVisual.wheelRadius || 0.46,
  });

  session.camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.6, 14000);
  session.camera.name = 'kaki-raid-camera';
  root.add(session.camera);

  // Desert sky. Matched to the fog so the horizon reads as haze rather than as
  // a hard edge between terrain and a black void.
  const fog = new THREE.Fog(0xd9c49a, 1400, 7600);
  session.previousFog = scene.fog;
  session.previousBackground = scene.background;
  scene.fog = fog;
  scene.background = new THREE.Color(0xbcd2e8);
  session.background = scene.background;
  session.fog = fog;

  session.hud = createRaidHud();

  _session = session;
  state.racing = session;
  updateRaidCamera(0, { snap: true });
  return session;
}

export function tickRaidMode(dt, elapsedDt = dt) {
  const session = _session;
  if (!session || session.disposed || !(dt > 0)) return;
  const started = (globalThis.performance || Date).now();
  session.elapsed += dt;

  // Fixed-step integration, decoupled from frame rate. No await, no allocation,
  // and no terrain generation inside this loop.
  session.accumulator += Math.min(dt, 0.25);
  let steps = 0;
  while (session.accumulator >= FIXED_STEP && steps < MAX_SUBSTEPS) {
    stepRaidVehicle(session.vehicle, FIXED_STEP, session.provider, readRaidControls());
    session.accumulator -= FIXED_STEP;
    steps += 1;
  }
  if (steps >= MAX_SUBSTEPS) session.accumulator = 0;

  const vehicle = session.vehicle;
  session.provider.updateFocus(vehicle.x, vehicle.z, vehicle.velocityX, vehicle.velocityZ);

  // Re-displace the visible patch once the vehicle has left its middle third.
  const drift = Math.hypot(vehicle.x - session.patchCentre.x, vehicle.z - session.patchCentre.z);
  if (drift > PATCH_METRES * 0.16) refreshTerrainPatch(session, vehicle.x, vehicle.z);

  syncRaidVehicleVisual(session);

  // Route progress, windowed so a fold-back cannot hand out free distance.
  const sample = nearestRaidRouteSample(session.routeIndex, vehicle.x, vehicle.z, {
    hintMeters: session.referenceMeters,
  });
  if (sample) {
    session.referenceMeters = Math.max(session.referenceMeters, sample.meters);
    session.offRouteMeters = Math.abs(raidRouteLateral(sample, vehicle.x, vehicle.z));
  }
  session.traveledMeters += Math.hypot(vehicle.velocityX, vehicle.velocityZ) * dt;

  session.hud?.update(session);
  session.physicsTimeMs = (globalThis.performance || Date).now() - started;
}

const RAID_CONTROLS = { throttle: 0, steer: 0, slide: false, push: false };

function readRaidControls() {
  // Raid reads the shell's already-sampled input rather than installing its own
  // listeners, so it cannot leak a keyboard handler on exit. sampleInput() has
  // already folded keyboard, gamepad and touch into moveVec by the time the
  // frame reaches a mode, and y is negative for forward.
  const move = state.input?.moveVec;
  RAID_CONTROLS.throttle = clamp(-(Number(move?.y) || 0), -1, 1);
  RAID_CONTROLS.steer = clamp(Number(move?.x) || 0, -1, 1);
  RAID_CONTROLS.slide = isHandbrakePressed();
  RAID_CONTROLS.push = isDashPressed();
  return RAID_CONTROLS;
}

function syncRaidVehicleVisual(session) {
  const vehicle = session.vehicle;
  const visual = session.vehicleVisual;
  if (!visual?.root) return;
  visual.root.position.set(vehicle.x, vehicle.y, vehicle.z);
  visual.root.rotation.set(0, -vehicle.yaw + Math.PI * 0.5, 0);
  if (visual.bodyPivot) {
    visual.bodyPivot.rotation.set(vehicle.pitch, 0, vehicle.roll);
  }
  const wheels = visual.wheels || [];
  for (let index = 0; index < wheels.length; index += 1) {
    const wheel = wheels[index];
    const contact = vehicle.wheels[index % vehicle.wheels.length];
    const restY = wheel?.userData?.raidRestY;
    if (wheel && Number.isFinite(restY)) {
      wheel.position.y = restY - contact.compression * 0.3;
    }
    wheel.rotation.x -= vehicle.wheelSpin;
  }
}

export function updateRaidCamera(dt, options = {}) {
  const session = _session;
  if (!session || session.disposed || !session.camera) return null;
  const vehicle = session.vehicle;
  const speed = Math.hypot(vehicle.velocityX, vehicle.velocityZ);

  // Follow the direction of travel once there is meaningful movement, so a
  // slide shows the vehicle rotated inside the frame rather than nose-on.
  const travelYaw = speed > 3 ? Math.atan2(vehicle.velocityZ, vehicle.velocityX) : vehicle.yaw;
  const blend = clamp(speed / 26, 0, 1) * 0.55;
  let heading = vehicle.yaw + shortestAngle(vehicle.yaw, travelYaw) * blend;

  const distance = 13 + clamp(speed * 0.22, 0, 9) + (vehicle.airborne ? 4 : 0);
  const height = 5.4 + clamp(speed * 0.06, 0, 3.4);
  const targetX = vehicle.x - Math.cos(heading) * distance;
  const targetZ = vehicle.z - Math.sin(heading) * distance;
  const groundY = session.provider.heightAt(targetX, targetZ);
  const targetY = Math.max(vehicle.y + height, groundY + 3.2);

  const smoothing = options.snap ? 1 : 1 - Math.exp(-6.5 * Math.max(dt, 0));
  session.camera.position.x += (targetX - session.camera.position.x) * smoothing;
  session.camera.position.y += (targetY - session.camera.position.y) * smoothing;
  session.camera.position.z += (targetZ - session.camera.position.z) * smoothing;
  session.camera.lookAt(vehicle.x, vehicle.y + 1.6, vehicle.z);

  const aspect = options.aspect || session.cameraHost?.getAspect?.() || 16 / 9;
  if (Number.isFinite(aspect) && aspect > 0 && session.camera.aspect !== aspect) {
    session.camera.aspect = aspect;
    session.camera.updateProjectionMatrix();
  }
  const targetFov = 62 + clamp(speed * 0.28, 0, 12);
  session.camera.fov += (targetFov - session.camera.fov) * (options.snap ? 1 : smoothing * 0.6);
  session.camera.updateProjectionMatrix();

  return { camera: session.camera, effects: getRaidCameraConfig() };
}

function shortestAngle(from, to) {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function resizeRaidMode(aspect) {
  const session = _session;
  if (!session?.camera || !(aspect > 0)) return;
  session.camera.aspect = aspect;
  session.camera.updateProjectionMatrix();
}

export function getRaidCameraTarget() {
  const session = _session;
  if (!session) return null;
  return new THREE.Vector3(session.vehicle.x, session.vehicle.y, session.vehicle.z);
}

export function getRaidCameraConfig() {
  return { chromatic: 0.0006, bloom: 0.3, heatHaze: 0 };
}

export function getRaidSnapshot() {
  const session = _session;
  if (!session) return null;
  const vehicle = session.vehicle;
  const sectors = session.provider.getSectorState();
  return {
    raceMode: 'raid',
    stageId: session.stageId,
    stageName: session.blueprint.name,
    officialDistanceKm: session.route.officialDistanceKm,
    referenceMeters: session.referenceMeters,
    traveledMeters: session.traveledMeters,
    remainingMeters: Math.max(0, session.route.totalMeters - session.referenceMeters),
    offRouteMeters: session.offRouteMeters,
    speedKph: Math.hypot(vehicle.velocityX, vehicle.velocityZ) * 3.6,
    headingDegrees: ((-vehicle.yaw * 180) / Math.PI + 450) % 360,
    surface: vehicle.surface?.id || 'hardpack',
    airborne: !!vehicle.airborne,
    elapsed: session.elapsed,
    sectors,
    patchRefreshes: session.patchRefreshes,
    scatter: session.environment?.stats || null,
    physicsTimeMs: session.physicsTimeMs,
  };
}

export function restartRaidMode() {
  const session = _session;
  if (!session) return null;
  const { route } = session;
  const vehicle = session.vehicle;
  vehicle.x = route.startX;
  vehicle.z = route.startZ;
  vehicle.y = session.provider.heightAt(route.startX, route.startZ);
  vehicle.yaw = route.startYaw;
  vehicle.velocityX = 0;
  vehicle.velocityY = 0;
  vehicle.velocityZ = 0;
  vehicle.yawRate = 0;
  session.referenceMeters = 0;
  session.traveledMeters = 0;
  session.elapsed = 0;
  session.accumulator = 0;
  refreshTerrainPatch(session, route.startX, route.startZ);
  updateRaidCamera(0, { snap: true });
  return session;
}

export function exitRaidMode(scene, explicitSession = null) {
  const session = explicitSession || _session;
  if (!session || session.disposed) return;
  session.disposed = true;

  session.hud?.dispose();
  session.hud = null;

  try { session.provider.dispose(); } catch (_) {}
  try { session.environment?.dispose(); } catch (_) {}
  session.environment = null;
  try { session.assetLease?.release(); } catch (_) {}
  session.assetLease = null;

  const host = scene || session.scene;
  if (session.fog && host && host.fog === session.fog) host.fog = session.previousFog || null;
  if (session.background && host && host.background === session.background) {
    host.background = session.previousBackground || null;
  }

  // Give the hero back to the shell exactly as it was handed over, before the
  // vehicle root is disposed out from under it.
  const hero = state.hero?.mesh;
  if (hero && session.savedHero) {
    try { hero.parent?.remove(hero); } catch (_) {}
    hero.position.copy(session.savedHero.position);
    hero.quaternion.copy(session.savedHero.quaternion);
    hero.scale.copy(session.savedHero.scale);
    hero.visible = session.savedHero.visible;
    (session.savedHero.parent || host)?.add(hero);
  }
  session.savedHero = null;

  session.root?.parent?.remove(session.root);
  session.root?.traverse?.((object) => {
    if (object.geometry) session.owned.geometries.add(object.geometry);
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) if (material) session.owned.materials.add(material);
  });
  for (const geometry of session.owned.geometries) geometry.dispose?.();
  for (const material of session.owned.materials) {
    for (const value of Object.values(material)) if (value?.isTexture) value.dispose?.();
    material.dispose?.();
  }
  for (const texture of session.owned.textures) texture.dispose?.();
  session.owned.geometries.clear();
  session.owned.materials.clear();
  session.owned.textures.clear();

  session.lights.length = 0;
  session.terrain = null;
  session.vehicleVisual = null;
  session.camera = null;
  session.root = null;

  if (state.racing === session) state.racing = null;
  if (_session === session) _session = null;
}

/** Diagnostics-only accessor. Never used to drive gameplay. */
export function getRaidSession() {
  return _session;
}
