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
import { attachTipsyTumblerModel, buildTipsyTumblerVisual } from '../racingVehicles.js';
import { buildRaidRoute, buildRaidRouteIndex, nearestRaidRouteSample, raidRouteLateral } from './raidRouteRuntime.js';
import { getRaidStage, validateRaidStage } from './raidStageBlueprints.js';
import { createRaidTerrainProvider } from './raidTerrainProvider.js';
import { RAID_SECTOR_METRES } from './raidSectorGenerator.js';
import { clamp } from './raidSurfaceField.js';
import { createRallyAssetLease } from '../racingAssets.js';
import { createRaidEnvironment } from './raidEnvironment.js';
import { createRaidDust } from './raidDust.js';
import { createRaidTrails } from './raidTrails.js';
import { createRaidHud } from './raidHud.js';
import { createRaidVehicle, stepRaidVehicle } from './raidVehiclePhysics.js';

// The visible terrain patch. 768 m across at 3 m resolution: large enough that
// the horizon is a landscape rather than a tabletop, cheap enough to re-displace
// on the CPU when the vehicle crosses a cell.
const PATCH_METRES = 1280;
const PATCH_SEGMENTS = 176;
const PATCH_STEP = PATCH_METRES / PATCH_SEGMENTS;

const FIXED_STEP = 1 / 60;
const MAX_SUBSTEPS = 12;

let _session = null;

// Wind ripples.
//
// The corrugation on a dune has a wavelength of about a metre, and the terrain
// grid samples every two metres, so ripples cannot live in the geometry without
// aliasing into noise. They belong in the normal instead: generated once as a
// tiling normal map, rotated to the stage wind, and tiled densely enough to read
// underfoot while dissolving into tone at distance.
function createRippleNormalMap(owned) {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x / size) * Math.PI * 2;
      const v = (y / size) * Math.PI * 2;
      // Primary corrugation across the wind, with a slow meander along it so the
      // crests wander instead of ruling straight lines across the desert.
      const meander = Math.sin(v * 3) * 0.55 + Math.sin(v * 7 + 1.3) * 0.22;
      const wave = Math.sin(u * 18 + meander * 2.4);
      const fine = Math.sin(u * 47 + Math.sin(v * 11) * 1.7) * 0.28;
      const slope = (wave + fine) * 0.5;
      const index = (y * size + x) * 4;
      // Tangent-space normal: perturb x, keep z dominant.
      const nx = clamp(slope * 0.85, -1, 1);
      const ny = clamp(Math.sin(v * 9 + u * 2) * 0.12, -1, 1);
      const nz = Math.sqrt(Math.max(0.02, 1 - nx * nx - ny * ny));
      data[index] = Math.round((nx * 0.5 + 0.5) * 255);
      data[index + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[index + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(PATCH_METRES / 22, PATCH_METRES / 22);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 16;
  texture.needsUpdate = true;
  owned?.textures?.add(texture);
  return texture;
}

function buildTerrainPatch(owned, windAngle) {
  const geometry = new THREE.PlaneGeometry(PATCH_METRES, PATCH_METRES, PATCH_SEGMENTS, PATCH_SEGMENTS);
  geometry.rotateX(-Math.PI / 2);
  const ripples = createRippleNormalMap(owned);
  ripples.center.set(0.5, 0.5);
  ripples.rotation = windAngle;
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.97,
    metalness: 0,
    flatShading: false,
    normalMap: ripples,
    normalScale: new THREE.Vector2(0.6, 0.6),
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
  if (session.sun) {
    session.sun.position.set(snappedX - 620, 210, snappedZ + 300);
    session.sun.target.position.set(snappedX, 0, snappedZ);
    session.sun.target.updateMatrixWorld();
  }
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
    dust: null,
    sun: null,
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
    cameraMode: RAID_CAMERA_MODES.includes(options.cameraMode) ? options.cameraMode : 'chase',
    // Free look. Drag orbits around the vehicle, wheel/pinch zooms. Held values
    // decay back to the travel direction so the chase camera reclaims the frame
    // once the player stops steering it.
    orbitYaw: 0,
    orbitPitch: 0,
    orbitZoom: 1,
    orbitHeldUntil: 0,
    pointerListeners: null,
    trails: null,
    windVector: { x: Math.cos(route.windAngle), z: Math.sin(route.windAngle) },
  };

  // Terrain authority must exist before the player is given control. This is
  // the one place a Raid session is allowed to await terrain.
  await provider.preloadAround(route.startX, route.startZ, 1);

  // Raid-owned asset lease. Only the Raid kit is requested, so no other mode's
  // assets are pulled in and none of Raid's leak into another mode's load set.
  session.assetLease = createRallyAssetLease({
    mode: 'raid',
    assetIds: ['raidEnvironmentKit', 'tipsyTumblerBody', 'monsterDecal'],
    renderer: state.renderer || null,
  });
  await session.assetLease.ready;

  session.terrain = buildTerrainPatch(owned, route.windAngle);
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
  // Low raking sun. Long shadows are what make dune relief legible; an
  // overhead light flattens the whole desert into one tone.
  const sun = new THREE.DirectionalLight(0xffe0b0, 3.1);
  sun.position.set(-620, 210, 300);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 900;
  sun.shadow.camera.left = -160;
  sun.shadow.camera.right = 160;
  sun.shadow.camera.top = 160;
  sun.shadow.camera.bottom = -160;
  sun.shadow.bias = -0.0006;
  const sky = new THREE.HemisphereLight(0xcfe2f5, 0xc08d52, 1.05);
  root.add(sun, sky);
  root.add(sun.target);
  session.sun = sun;
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
  // Tipsy Tumbler is the hero machine. It is a finished, authored Kaki monster
  // truck with a real GLB body, long-travel suspension and proper wheels, so it
  // reads far better at rally-raid scale than a procedural cage would.
  const vehicleVisual = buildTipsyTumblerVisual({ driver: hero, owned, color: 0xf19a4b });
  vehicleVisual.root.name = 'KakiRaid-tipsy';
  const tipsyBody = session.assetLease.models?.tipsyTumblerBody;
  if (tipsyBody) attachTipsyTumblerModel(vehicleVisual, tipsyBody);
  session.vehicleVisual = vehicleVisual;
  vehicleVisual.root.traverse?.((object) => { if (object.isMesh) object.castShadow = true; });
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
    wheelRadius: vehicleVisual.wheelRadius || 0.72,
  });

  session.camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.6, 14000);
  session.camera.name = 'kaki-raid-camera';
  root.add(session.camera);

  // Desert sky. Matched to the fog so the horizon reads as haze rather than as
  // a hard edge between terrain and a black void.
  // Fog must reach full strength BEFORE the terrain patch ends, or the ground
  // stops in a hard unfogged line against the sky. The patch is PATCH_METRES
  // across and recentred on the vehicle, so drawn ground exists to half that on
  // each axis; fogging out just inside it turns the edge into haze. Sky and fog
  // share a colour so the transition is invisible.
  const fog = new THREE.Fog(0xe6d3b4, PATCH_METRES * 0.19, PATCH_METRES * 0.47);
  session.previousFog = scene.fog;
  session.previousBackground = scene.background;
  scene.fog = fog;
  scene.background = new THREE.Color(0xe6d3b4);
  session.background = scene.background;
  session.fog = fog;

  session.dust = createRaidDust({ quality, owned });
  root.add(session.dust.mesh);
  session.trails = createRaidTrails({ quality, provider, owned });
  root.add(session.trails.mesh);

  installRaidPointerControls(session);
  session.hud = createRaidHud();

  _session = session;
  state.racing = session;
  updateRaidCamera(0, { snap: true });
  return session;
}

// Pointer look. The shell owns input sampling for driving, but free-look is a
// camera concern that only Raid has, so Raid owns these listeners and takes them
// with it on exit rather than adding a mode-specific branch to shared input.
function installRaidPointerControls(session) {
  const canvas = session.cameraHost?.canvas || document.querySelector('canvas');
  if (!canvas) return;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let pinch = 0;

  const hold = () => { session.orbitHeldUntil = session.elapsed + 2.2; };

  const down = (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    hold();
  };
  const move = (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    session.orbitYaw = clamp(session.orbitYaw - dx * 0.006, -Math.PI, Math.PI);
    session.orbitPitch = clamp(session.orbitPitch + dy * 0.004, -0.5, 1.05);
    hold();
  };
  const up = () => { dragging = false; };
  const wheel = (event) => {
    event.preventDefault();
    session.orbitZoom = clamp(session.orbitZoom * (1 + Math.sign(event.deltaY) * 0.12), 0.45, 3.2);
    hold();
  };
  const touchStart = (event) => {
    if (event.touches.length === 2) {
      pinch = Math.hypot(
        event.touches[0].clientX - event.touches[1].clientX,
        event.touches[0].clientY - event.touches[1].clientY,
      );
    } else if (event.touches.length === 1) {
      dragging = true;
      lastX = event.touches[0].clientX;
      lastY = event.touches[0].clientY;
    }
    hold();
  };
  const touchMove = (event) => {
    if (event.touches.length === 2 && pinch > 0) {
      const span = Math.hypot(
        event.touches[0].clientX - event.touches[1].clientX,
        event.touches[0].clientY - event.touches[1].clientY,
      );
      session.orbitZoom = clamp(session.orbitZoom * (pinch / Math.max(1, span)), 0.45, 3.2);
      pinch = span;
      hold();
      return;
    }
    if (dragging && event.touches.length === 1) {
      move(event.touches[0]);
    }
  };
  const touchEnd = () => { dragging = false; pinch = 0; };

  canvas.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('touchstart', touchStart, { passive: true });
  canvas.addEventListener('touchmove', touchMove, { passive: true });
  canvas.addEventListener('touchend', touchEnd, { passive: true });

  session.pointerListeners = () => {
    canvas.removeEventListener('pointerdown', down);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    canvas.removeEventListener('wheel', wheel);
    canvas.removeEventListener('touchstart', touchStart);
    canvas.removeEventListener('touchmove', touchMove);
    canvas.removeEventListener('touchend', touchEnd);
  };
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
  session.dust?.update(dt, vehicle, vehicle.surface || { dust: 0.6, looseness: 0.5 }, session.windVector);
  session.trails?.update(dt, vehicle, vehicle.surface || { looseness: 0.5 });

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

// The shell's camera selector offers these three. Raid has no cameraManager, so
// it answers the same calls itself; without this the menu's Camera control
// silently did nothing.
export const RAID_CAMERA_MODES = Object.freeze(['chase', 'isometric', 'driver']);

export function getRaidCameraMode() {
  return _session?.cameraMode || 'chase';
}

export function setRaidCameraMode(mode, options = {}) {
  const session = _session;
  if (!session || session.disposed) return false;
  const normalized = mode === 'fpv' ? 'driver' : mode;
  if (!RAID_CAMERA_MODES.includes(normalized)) return false;
  session.cameraMode = normalized;
  updateRaidCamera(0, { ...options, snap: true });
  return true;
}

export function cycleRaidCamera(direction = 1) {
  const session = _session;
  if (!session || session.disposed) return false;
  const current = RAID_CAMERA_MODES.indexOf(session.cameraMode || 'chase');
  const next = (current + (direction >= 0 ? 1 : RAID_CAMERA_MODES.length - 1)) % RAID_CAMERA_MODES.length;
  return setRaidCameraMode(RAID_CAMERA_MODES[next]);
}

export function updateRaidCamera(dt, options = {}) {
  const session = _session;
  if (!session || session.disposed || !session.camera) return null;
  const vehicle = session.vehicle;
  const speed = Math.hypot(vehicle.velocityX, vehicle.velocityZ);
  const mode = session.cameraMode || 'chase';

  // Follow the direction of travel once there is meaningful movement, so a
  // slide shows the vehicle rotated inside the frame rather than nose-on.
  const travelYaw = speed > 3 ? Math.atan2(vehicle.velocityZ, vehicle.velocityX) : vehicle.yaw;
  const blend = clamp(speed / 26, 0, 1) * 0.55;
  let heading = vehicle.yaw + shortestAngle(vehicle.yaw, travelYaw) * blend;

  let distance = 13 + clamp(speed * 0.22, 0, 9) + (vehicle.airborne ? 4 : 0);
  let height = 5.4 + clamp(speed * 0.06, 0, 3.4);
  if (mode === 'isometric') {
    // High and pulled back, so the dune relief and the route ahead read as a
    // landscape rather than as a wall.
    distance = 34 + clamp(speed * 0.3, 0, 12);
    height = 26 + clamp(speed * 0.12, 0, 8);
    heading = vehicle.yaw;
  } else if (mode === 'driver') {
    distance = -0.35;
    height = 2.05;
    heading = vehicle.yaw;
  }
  const targetX = vehicle.x - Math.cos(heading) * distance;
  const targetZ = vehicle.z - Math.sin(heading) * distance;
  const groundY = session.provider.heightAt(targetX, targetZ);
  const targetY = mode === 'driver'
    ? vehicle.y + height
    : Math.max(vehicle.y + height, groundY + 3.2);

  // Free look decays back to the travel direction once the player lets go, so
  // it never fights the chase camera or strands them facing backwards.
  if (session.elapsed > session.orbitHeldUntil) {
    const decay = Math.exp(-1.6 * Math.max(dt, 0));
    session.orbitYaw *= decay;
    session.orbitPitch *= decay;
  }
  heading += session.orbitYaw;
  distance *= session.orbitZoom;
  height += session.orbitPitch * distance * 0.85;

  const responsiveness = mode === 'driver' ? 16 : mode === 'isometric' ? 4.2 : 6.5;
  const smoothing = options.snap ? 1 : 1 - Math.exp(-responsiveness * Math.max(dt, 0));
  session.camera.position.x += (targetX - session.camera.position.x) * smoothing;
  session.camera.position.y += (targetY - session.camera.position.y) * smoothing;
  session.camera.position.z += (targetZ - session.camera.position.z) * smoothing;
  if (mode === 'driver') {
    // Look down the bonnet rather than at the vehicle you are sitting in.
    const look = vehicle.yaw + session.orbitYaw;
    session.camera.lookAt(
      vehicle.x + Math.cos(look) * 30,
      vehicle.y + height - 1.2 - session.orbitPitch * 18,
      vehicle.z + Math.sin(look) * 30,
    );
  } else {
    session.camera.lookAt(vehicle.x, vehicle.y + 1.6, vehicle.z);
  }
  if (session.vehicleVisual?.root) session.vehicleVisual.root.visible = mode !== 'driver';

  const aspect = options.aspect || session.cameraHost?.getAspect?.() || 16 / 9;
  if (Number.isFinite(aspect) && aspect > 0 && session.camera.aspect !== aspect) {
    session.camera.aspect = aspect;
    session.camera.updateProjectionMatrix();
  }
  const targetFov = (mode === 'isometric' ? 38 : mode === 'driver' ? 74 : 62) + clamp(speed * 0.28, 0, 12);
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
    dust: session.dust ? { alive: session.dust.alive, capacity: session.dust.capacity } : null,
    trails: session.trails ? { alive: session.trails.alive, capacity: session.trails.capacity } : null,
    cameraMode: session.cameraMode,
    orbit: { yaw: session.orbitYaw, pitch: session.orbitPitch, zoom: session.orbitZoom },
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
  try { session.dust?.dispose(); } catch (_) {}
  session.dust = null;
  try { session.trails?.dispose(); } catch (_) {}
  session.trails = null;
  try { session.pointerListeners?.(); } catch (_) {}
  session.pointerListeners = null;
  // A shadow-casting light owns a render target. Disposing the light's Object3D
  // does not free it, so the map leaks one texture pair per session without this.
  try { session.sun?.shadow?.dispose?.(); } catch (_) {}
  session.sun = null;
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
