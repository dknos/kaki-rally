/**
 * Kaki Dune Run — first-class deformable-sand event runtime.
 *
 * The app shell still owns the canvas, renderer, input sampling, pause state
 * and animation loop. This module owns one Dune Run session and advances its
 * shared kart controller at a fixed 120 Hz.
 */
import * as THREE from 'three';
import { state } from '../../state.js';
import { navigateToMenu, restartRallySession } from '../../navigation.js';
import { gamepadState } from '../../gamepad.js';
import {
  consumeJump,
  isDashPressed,
  isHandbrakePressed,
} from '../../input.js';
import {
  playRacingImpact,
  sfx,
  stopRacingAudio,
  updateRacingAudio,
} from '../../audio.js';
import { getRendererDiagnostics } from '../../rendering/rendererAccess.js';
import {
  attachCyberTruckModel,
  attachMightyMeowsterModel,
  attachTipsyTumblerModel,
  buildRallyRaidVehicle,
  buildGhostVehicle,
  updateVehicleAnimation,
  updateVehicleWheelPresentation,
} from '../racingVehicles.js';
import {
  buildCyberTruck,
  buildMonsterTruck,
  buildTipsyTumbler,
} from '../monsterSmash.js';
import {
  createMonsterScoreState,
  stepMonsterStunts,
} from '../monsterScoring.js';
import {
  createRallyAssetLease,
  getRallyAssetCacheSnapshot,
} from '../racingAssets.js';
import { attachRacingCameraManager } from '../cameras/cameraSessionBinding.js';
import { clamp, formatRaceTime, normalizeAngle } from '../physics.js';
import { mapRacingSteerInput } from '../racingSteering.js';
import {
  createDrawDuneEvent,
  DUNE_EVENTS,
  duneWindVector,
  getDuneEvent,
  sampleDuneRoute,
} from './duneEvents.js';
import {
  DuneDeformationField,
  DuneSurfaceField,
} from './duneDeformation.js';
import { buildDuneClipmap, duneClipmapRenderedHeightAt } from './duneClipmap.js';
import {
  attachDuneEnvironmentKit,
  buildDuneEnvironment,
  disposeDuneEnvironment,
  duneEnvironmentSnapshot,
  updateDuneEnvironment,
} from './duneEnvironment.js';
import {
  createDuneDust,
  disposeDuneDust,
  duneDustSnapshot,
  emitAmbientDuneDust,
  emitDuneDust,
  updateDuneDust,
} from './duneDust.js';
import { generateDuneHeightfield } from './duneHeightfield.js';
import {
  createDuneRaceState,
  recoverDuneRace,
  stepDuneRace,
} from './duneRace.js';
import {
  createDuneGhostPlayback,
  createDuneRecordRun,
  duneRecordKey,
  finishDuneRecordRun,
  readDuneRecords,
  sampleDuneGhost,
  stepDuneRecordRun,
} from './duneRecords.js';
import {
  createDuneRoosterTail,
  disposeDuneRoosterTail,
  duneRoosterTailSnapshot,
  emitDuneRoosterTail,
  updateDuneRoosterTail,
} from './duneRoosterTail.js';
import {
  createDuneVehicleState,
  DuneVehicleRuntime,
  getDuneVehicleProfile,
  getDuneVehicleTelemetry,
  stepDuneVehicle,
} from './duneVehiclePhysics.js';
import {
  getRallyRaidVehicle,
  RALLY_RAID_EXPEDITION,
  ROADBOOK_ASSISTS,
  roadbookSnapshot,
  createRoadbookState,
  stepRoadbook,
  finishRoadbook,
  readRallyRaidProgress,
  recordRallyRaidStage,
} from './duneRallyRaid.js';

const DUNE_CX = 720;
const DUNE_CZ = -520;
const COUNTDOWN_SECONDS = 3.35;
const FIXED_STEP = 1 / 120;
const MAX_FIXED_STEPS = 8;
const _cameraTarget = new THREE.Vector3(DUNE_CX, 0, DUNE_CZ);
const _wind = { x: 0, z: 0 };
const RALLY_RAID_VEHICLE_IDS = Object.freeze(['buggy', 'prototype', 'truck']);
const DUNE_CAMERA_FX_DEFAULTS = Object.freeze({ shake: 0, roll: 0, punch: 0, phase: 0 });

function ensureDuneCameraFx(session) {
  if (!session.cameraFx || typeof session.cameraFx !== 'object' || Array.isArray(session.cameraFx)) {
    session.cameraFx = { ...DUNE_CAMERA_FX_DEFAULTS };
  }
  const fx = session.cameraFx;
  fx.shake = Number.isFinite(fx.shake) ? Math.max(0, fx.shake) : 0;
  fx.roll = Number.isFinite(fx.roll) ? fx.roll : 0;
  fx.punch = Number.isFinite(fx.punch) ? Math.max(0, fx.punch) : 0;
  fx.phase = Number.isFinite(fx.phase) ? fx.phase : 0;
  return fx;
}

function stepDuneCameraFx(session, dt) {
  const fx = ensureDuneCameraFx(session);
  fx.phase = (fx.phase + Math.max(0, dt) * 17) % (Math.PI * 2);
  fx.shake = Math.max(0, fx.shake - Math.max(0, dt) * 3.6);
  fx.roll *= Math.exp(-Math.max(0, dt) * 9);
  fx.punch = Math.max(0, fx.punch - Math.max(0, dt) * 4.8);
  return fx;
}

function isRallyRaidVehicle(id) {
  return RALLY_RAID_VEHICLE_IDS.includes(id);
}

function safeSfx(name) {
  try { sfx?.[name]?.(); } catch (_) {}
}

function hex(value) {
  return `#${Number(value || 0).toString(16).padStart(6, '0')}`;
}

function qualityValue(value, fallback = 'medium') {
  return ['low', 'medium', 'high', 'ultra'].includes(value) ? value : fallback;
}

function resolveQuality(options = {}) {
  const globalQuality = qualityValue(options.quality || state.options?.quality, 'high');
  const dustSetting = ['off', 'low', 'medium', 'high'].includes(options.duneDust)
    ? options.duneDust
    : 'high';
  return {
    terrain: qualityValue(options.duneTerrain, globalQuality),
    deformation: qualityValue(options.duneDeformation, globalQuality),
    particles: qualityValue(options.duneParticles, globalQuality),
    shadow: qualityValue(options.duneShadow, globalQuality),
    dustEnabled: dustSetting !== 'off' && options.duneDust !== false,
    dustScale: ({ off: 0, low: 0.5, medium: 0.78, high: 1.08 })[dustSetting],
    heatHaze: options.duneHeatHaze !== false && !state._optReduceMotion,
  };
}

function routeSamplesWithTerrain(routeRuntime, surfaceField) {
  const source = routeRuntime.samples;
  const samples = new Array(source.length);
  for (let index = 0; index < source.length; index += 1) {
    const sample = source[index];
    const previous = source[index > 0 ? index - 1 : routeRuntime.loop ? source.length - 1 : 0];
    const next = source[index < source.length - 1 ? index + 1 : routeRuntime.loop ? 0 : source.length - 1];
    const dx = next.x - previous.x;
    const dz = next.z - previous.z;
    const inverse = 1 / Math.max(1e-6, Math.hypot(dx, dz));
    const tangentX = dx * inverse;
    const tangentZ = dz * inverse;
    samples[index] = {
      ...sample,
      y: surfaceField.heightAt(sample.x, sample.z),
      tangent: new THREE.Vector3(tangentX, 0, tangentZ),
      normal: new THREE.Vector3(tangentZ, 0, -tangentX),
    };
  }
  return samples;
}

function saveHero(hero) {
  const saved = {
    parent: hero.parent,
    position: hero.position.clone(),
    quaternion: hero.quaternion.clone(),
    scale: hero.scale.clone(),
    visible: hero.visible,
    shadowStates: [],
  };
  hero.traverse?.((object) => {
    if (object.isMesh) saved.shadowStates.push({ object, castShadow: object.castShadow });
  });
  return saved;
}

function restoreHero(session, scene) {
  const hero = state.hero?.mesh;
  if (!hero || !session.savedHero) return;
  try { hero.parent?.remove(hero); } catch (_) {}
  hero.position.copy(session.savedHero.position);
  hero.quaternion.copy(session.savedHero.quaternion);
  hero.scale.copy(session.savedHero.scale);
  hero.visible = session.savedHero.visible;
  for (const entry of session.savedHero.shadowStates || []) {
    entry.object.castShadow = entry.castShadow;
  }
  (session.savedHero.parent || scene || session.scene)?.add(hero);
}

function buildPlayerVisual(session, hero) {
  const decalTexture = session.assetLease?.textures?.monsterDecal || null;
  if (session.isRallyRaid) {
    const raidVehicle = getRallyRaidVehicle(session.vehicleId);
    const visual = buildRallyRaidVehicle({
      driver: hero,
      owned: session.owned,
      decalTexture,
      color: raidVehicle.color,
      accent: raidVehicle.accent,
      rallyRaidVehicleId: session.vehicleId,
      isPlayer: true,
    });
    visual.root.name = `KakiRallyRaid-${session.vehicleId}`;
    visual.root.userData.mode = 'rally-raid';
    visual.bodyBaseY = visual.bodyPivot.position.y;
    session.root.add(visual.root);
    return visual;
  }
  const options = {
    driver: hero,
    owned: session.owned,
    decalTexture,
    color: session.vehicleId === 'cyber'
      ? 0x71899a
      : session.vehicleId === 'tipsy' ? 0xf19a4b : 0xd53d92,
  };
  const visual = session.vehicleId === 'cyber'
    ? buildCyberTruck(options)
    : session.vehicleId === 'tipsy'
      ? buildTipsyTumbler(options)
      : buildMonsterTruck(options);
  visual.root.name = `KakiDuneRun-${session.vehicleId}`;
  visual.root.userData.mode = 'dunes';
  visual.bodyBaseY = visual.bodyPivot.position.y;
  session.root.add(visual.root);
  return visual;
}

function attachPlayerBody(session) {
  if (session.isRallyRaid) return true;
  const bodyAssetId = session.vehicleId === 'cyber'
    ? 'cyberKakiBody'
    : session.vehicleId === 'tipsy'
      ? 'tipsyTumblerBody'
      : 'mightyMeowsterBody';
  const model = session.assetLease.models[bodyAssetId];
  if (!model) return false;
  return session.vehicleId === 'cyber'
    ? attachCyberTruckModel(session.visual, model, session.owned)
    : session.vehicleId === 'tipsy'
      ? attachTipsyTumblerModel(session.visual, model)
      : attachMightyMeowsterModel(session.visual, model, session.owned);
}

function buildGhost(session) {
  const playback = createDuneGhostPlayback(session.previousRecord);
  const visual = buildGhostVehicle({
    owned: session.owned,
    color: session.event.palette.accent,
    opacity: 0.2,
  });
  visual.root.name = 'KakiDunePersonalBestGhost';
  visual.root.scale.setScalar(1.52);
  visual.root.visible = playback.visible;
  visual.bodyPivot.position.y = 0.25;
  session.root.add(visual.root);
  return { playback, visual };
}

function bindHeld(button, target, key) {
  if (!button) return;
  const release = () => {
    target[key] = false;
    button.classList.remove('is-held');
  };
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    try { button.setPointerCapture?.(event.pointerId); } catch (_) {}
    target[key] = true;
    button.classList.add('is-held');
  });
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
}

function mountHud(session) {
  if (typeof document === 'undefined') return;
  const root = document.createElement('div');
  root.className = 'kkr-hud kkd-hud';
  root.dataset.mode = 'dunes';
  root.style.setProperty('--kkd-accent', hex(session.event.palette.accent));
  root.innerHTML = `
    <div class="kkd-topbar">
      <div><span>${session.isRallyRaid ? 'KAKI RALLY RAID' : 'KAKI DUNE RUN'} · ${session.event.subtitle}</span><strong>${session.event.name}</strong><em>${session.vehicle.name}</em></div>
      <button type="button" data-action="menu">MENU</button>
    </div>
    <div class="kkd-route">
      <span>${session.event.routeType === 'freeride' ? 'FREERIDE STYLE' : 'ROUTE PROGRESS'}</span>
      <strong data-role="route-primary">0%</strong>
      <em data-role="route-secondary">${session.event.routeType === 'circuit' ? `LAP 1 / ${session.event.laps}` : 'GATE 1'}</em>
      <div><i data-role="progress"></i></div>
    </div>
    <div class="kkd-clock"><span>${session.event.routeType === 'freeride' ? 'SESSION' : 'RUN TIME'}</span><strong>0:00.000</strong><em>PB —</em></div>
    <div class="kkd-speed"><strong>0</strong><span>KM/H</span><em>DUNE SAND</em></div>
    <div class="kkd-zoomies"><span>ZOOMIES HEAT</span><div><i></i></div><strong>READY</strong></div>
    <div class="kkd-deformation"><span>SAND STATE</span><strong>4 CONTACTS</strong><em>RUTS 0 CM · PACK 0%</em></div>
    ${session.isRallyRaid ? `
      <div class="kkd-roadbook" aria-label="Rally Raid roadbook">
        <div class="kkd-roadbook-head"><span>ROADBOOK · <b data-role="roadbook-assist">${ROADBOOK_ASSISTS[session.navigationAssist]?.name || 'RALLY'}</b></span><strong data-role="roadbook-distance">— M</strong></div>
        <div class="kkd-roadbook-call"><b data-role="roadbook-symbol">CAP</b><strong data-role="roadbook-instruction">READ AHEAD</strong></div>
        <div class="kkd-roadbook-meta"><span data-role="roadbook-cap">CAP —</span><span data-role="roadbook-hazard">HAZARD —</span><span data-role="roadbook-waypoint">WP 0 / 0</span></div>
        <div class="kkd-roadbook-status" data-role="roadbook-status">READ AHEAD</div>
      </div>` : ''}
    <div class="kkr-callout kkd-callout"></div>
    <div class="kkd-countdown"></div>
    <div class="kkd-controls">W/S GAS · BRAKE · A/D STEER · SPACE POWERSLIDE · SHIFT ZOOMIES / AIR TRIM · R RECOVER</div>
    <div class="kkr-camera-control">
      <button class="kkr-camera-cycle" type="button" aria-label="Camera: chase. Activate to cycle; hold for camera list."><span>CAMERA</span><strong>CHASE</strong></button>
      <div class="kkr-camera-list" role="menu" aria-label="Dune Run camera" hidden>
        <button type="button" role="menuitem" data-camera-mode="isometric">ISOMETRIC</button>
        <button type="button" role="menuitem" data-camera-mode="chase">CHASE</button>
        <button type="button" role="menuitem" data-camera-mode="driver_fpv">DRIVER FPV</button>
      </div>
    </div>
    <div class="kkd-touch" aria-label="Dune Run touch actions">
      <button type="button" data-touch="slide">SLIDE</button>
      <button type="button" data-touch="boost">ZOOMIES</button>
      <button type="button" data-touch="recover">↺ RECOVER</button>
    </div>
    ${session.event.routeType === 'freeride'
      ? '<button class="kkd-bank" type="button" data-action="bank">BANK RUN</button>'
      : ''}
    <div class="kkd-finish" hidden>
      <section>
        <span>${session.isRallyRaid ? 'RALLY RAID SELECTIVE COMPLETE' : 'DUNE RUN COMPLETE'}</span>
        <h2>${session.isRallyRaid ? 'ROADBOOK CLOSED!' : 'PAWS IN THE SAND!'}</h2>
        <strong data-role="medal">FINISH</strong>
        <p data-role="result"></p>
        <em data-role="record"></em>
        <div><button type="button" data-action="retry">RACE AGAIN</button><button type="button" data-action="menu">GARAGE</button></div>
      </section>
    </div>`;
  (document.querySelector('#ui-root') || document.body).appendChild(root);
  bindHeld(root.querySelector('[data-touch="slide"]'), session.touch, 'slide');
  bindHeld(root.querySelector('[data-touch="boost"]'), session.touch, 'boost');
  root.querySelector('[data-touch="recover"]')?.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    session.recoverQueued = true;
  });
  root.querySelectorAll('[data-action="menu"]').forEach((button) => {
    button.addEventListener('click', () => navigateToMenu('dune-garage'));
  });
  root.querySelector('[data-action="retry"]')?.addEventListener('click', () => {
    void restartRallySession();
  });
  root.querySelector('[data-action="bank"]')?.addEventListener('click', () => finishRun(session));
  session.hud = {
    root,
    routePrimary: root.querySelector('[data-role="route-primary"]'),
    routeSecondary: root.querySelector('[data-role="route-secondary"]'),
    progress: root.querySelector('[data-role="progress"]'),
    clock: root.querySelector('.kkd-clock strong'),
    best: root.querySelector('.kkd-clock em'),
    speed: root.querySelector('.kkd-speed strong'),
    surface: root.querySelector('.kkd-speed em'),
    heat: root.querySelector('.kkd-zoomies'),
    heatFill: root.querySelector('.kkd-zoomies i'),
    heatLabel: root.querySelector('.kkd-zoomies strong'),
    sandPrimary: root.querySelector('.kkd-deformation strong'),
    sandSecondary: root.querySelector('.kkd-deformation em'),
    roadbook: root.querySelector('.kkd-roadbook'),
    roadbookAssist: root.querySelector('[data-role="roadbook-assist"]'),
    roadbookDistance: root.querySelector('[data-role="roadbook-distance"]'),
    roadbookSymbol: root.querySelector('[data-role="roadbook-symbol"]'),
    roadbookInstruction: root.querySelector('[data-role="roadbook-instruction"]'),
    roadbookCap: root.querySelector('[data-role="roadbook-cap"]'),
    roadbookHazard: root.querySelector('[data-role="roadbook-hazard"]'),
    roadbookWaypoint: root.querySelector('[data-role="roadbook-waypoint"]'),
    roadbookStatus: root.querySelector('[data-role="roadbook-status"]'),
    callout: root.querySelector('.kkd-callout'),
    countdown: root.querySelector('.kkd-countdown'),
    finish: root.querySelector('.kkd-finish'),
    medal: root.querySelector('[data-role="medal"]'),
    result: root.querySelector('[data-role="result"]'),
    record: root.querySelector('[data-role="record"]'),
  };
}

function setCallout(session, text, duration = 1.2, tone = '') {
  session.callout = text;
  session.calloutTime = duration;
  session.calloutTone = tone;
}

function applyRoadbookEvents(session, events = []) {
  if (!session.isRallyRaid || !events.length) return;
  for (const event of events) {
    if (event.type === 'penalty' && event.seconds > 0) {
      session.race.penaltySeconds = (session.race.penaltySeconds || 0) + event.seconds;
      session.recordRun.elapsed += event.seconds;
      setCallout(session, `${event.reason === 'speed-control' ? 'SPEED CONTROL' : 'WAYPOINT'} +${event.seconds}s`, 1.4, 'penalty');
    } else if (event.type === 'validated' && event.note) {
      setCallout(session, `${event.note.symbol} · ${event.note.instruction}`, 1.15, 'roadbook');
    }
  }
}

function readControls(session) {
  const move = state.input?.moveVec || { x: 0, y: 0 };
  const active = session.phase === 'racing';
  const handbrake = active && (session.touch.slide || isHandbrakePressed());
  const controls = session.controls;
  controls.throttle = active ? clamp(-(Number(move.y) || 0), -1, 1) : 0;
  controls.steer = active ? mapRacingSteerInput(Number(move.x) || 0) : 0;
  if (active && session.steeringAssist && session.kart.grounded) {
    const assistStrength = session.difficulty === 'relaxed' ? 0.2 : 0.11;
    controls.steer = clamp(
      controls.steer - clamp((session.kart.lateralSpeed || 0) / 12, -assistStrength, assistStrength),
      -1,
      1,
    );
  }
  controls.handbrake = handbrake;
  controls.drift = handbrake;
  controls.boost = active && (session.touch.boost || isDashPressed());
  controls.hop = false;
  controls.airPitch = controls.throttle;
  controls.lean = controls.steer;
  if (session.qaControlsTime > 0) {
    Object.assign(controls, session.qaControls);
  }
  // Space owns a held handbrake in racing; drain the shared edge queue so it
  // cannot become an overworld jump after mode exit.
  consumeJump();
  return controls;
}

function updatePlayerVisual(session, dt) {
  const kart = session.kart;
  const visual = session.visual;
  visual.root.position.set(kart.x, kart.y, kart.z);
  visual.root.rotation.y = kart.yaw;
  const pitch = kart.grounded
    ? (kart.contactPitch ?? kart.groundPitch ?? 0)
    : (kart.stuntPitch || 0);
  const roll = kart.grounded
    ? (kart.contactRoll ?? kart.groundRoll ?? 0)
    : (kart.stuntRoll || 0);
  const amount = Math.min(1, dt * 15);
  visual.bodyPivot.rotation.x += (pitch - visual.bodyPivot.rotation.x) * amount;
  visual.bodyPivot.rotation.z += (roll - visual.bodyPivot.rotation.z) * amount;
  const compression = clamp(kart.suspensionCompression || 0, 0, 1.25);
  visual.bodyPivot.position.y += (
    (visual.bodyBaseY || 0) - compression * 0.18 - visual.bodyPivot.position.y
  ) * Math.min(1, dt * 18);
  const signedSpeed = (kart.vx || 0) * Math.sin(kart.yaw) + (kart.vz || 0) * Math.cos(kart.yaw);
  updateVehicleAnimation(visual, signedSpeed, dt);
  for (let index = 0; index < visual.wheels.length; index += 1) {
    const wheel = visual.wheels[index];
    const contactId = `${wheel.userData.side}${wheel.userData.axle === 'front' ? 'Front' : 'Rear'}`;
    const contact = kart.wheelContacts?.[contactId];
    const base = wheel.userData.basePosition;
    if (base) {
      const targetY = base.y + (contact?.visualOffset || 0);
      wheel.position.y += (targetY - wheel.position.y) * Math.min(1, dt * 20);
    }
    const targetSteer = wheel.userData.steerable ? (contact?.steerAngle || 0) : 0;
    updateVehicleWheelPresentation(wheel, {
      spinDelta: signedSpeed / Math.max(0.2, visual.wheelRadius || 1.05) * dt,
      targetSteer,
      dt,
      steeringResponse: 16,
    });
  }
  for (const spring of visual.suspension || []) {
    const contactId = `${spring.userData.side}${spring.userData.axle === 'front' ? 'Front' : 'Rear'}`;
    const contact = kart.wheelContacts?.[contactId];
    const base = spring.userData.baseScale;
    if (!base || !contact) continue;
    const targetScale = base.y * clamp(1 - contact.compression * 0.34, 0.58, 1.08);
    spring.scale.y += (targetScale - spring.scale.y) * Math.min(1, dt * 20);
  }
  for (const flame of visual.flames || []) {
    flame.visible = kart.boostTime > 0 && !kart.overheated;
    if (flame.visible) flame.scale.y = 0.85 + Math.sin(session.visualTime * 48 + flame.id) * 0.18;
  }
  const altitude = Math.max(0, kart.y - (kart.groundHeight || 0));
  if (visual.shadow?.material) {
    visual.shadow.material.opacity = clamp(0.3 - altitude * 0.035, 0.07, 0.3);
    visual.shadow.scale.setScalar(1 + altitude * 0.075);
  }
}

function updateGhost(session) {
  const ghost = session.ghost;
  if (!ghost?.playback?.visible || session.phase === 'countdown') return;
  const sample = sampleDuneGhost(ghost.playback, session.recordRun.elapsed);
  if (!sample) return;
  ghost.visual.root.visible = session.phase !== 'finished';
  ghost.visual.root.position.set(sample.x, sample.y + 0.05, sample.z);
  ghost.visual.root.rotation.y = sample.yaw;
  ghost.visual.bodyPivot.rotation.x = sample.pitch;
  ghost.visual.bodyPivot.rotation.z = sample.roll;
}

function recover(session, automatic = false) {
  if (!session || session.kart.recoveryCooldown > 0) return false;
  recoverDuneRace(session.race, session.kart, session.surfaceField, session.routeRuntime);
  session.invertedTime = 0;
  session.cameraManager?.onVehicleRespawned();
  setCallout(session, automatic ? 'SAFE RECOVERY' : 'BACK ON YOUR PAWS!', 1.25, 'recover');
  playRacingImpact({ strength: automatic ? 0.28 : 0.16, kind: 'landing' });
  safeSfx('uiClick');
  return true;
}

function finishRun(session) {
  if (!session || session.phase === 'finished') return session?.result || null;
  if (session.isRallyRaid) {
    finishRoadbook(session.roadbook);
    applyRoadbookEvents(session, session.roadbook.events);
  }
  session.race.finished = true;
  session.race.finishTime = session.recordRun.elapsed;
  session.recordRun.score = Math.max(session.recordRun.score, Math.round(session.race.score));
  session.result = finishDuneRecordRun(session.recordRun, session.event);
  if (session.isRallyRaid) {
    session.expedition = recordRallyRaidStage({
      progress: session.expedition,
      stageId: session.event.id,
      vehicleId: session.vehicleId,
      stageTime: session.recordRun.elapsed,
      recoveries: session.race.recoveryCount,
      serviceId: session.serviceChoice,
    });
    session.result = {
      ...session.result,
      expedition: {
        completedStages: session.expedition.completedStages.length,
        totalStages: RALLY_RAID_EXPEDITION.stages.length,
        cumulativeTime: session.expedition.cumulativeTime,
        service: session.serviceChoice,
        serviceSeconds: session.expedition.serviceSeconds,
        damage: session.expedition.damage,
      },
    };
  }
  session.phase = 'finished';
  session.kart.vx = 0;
  session.kart.vz = 0;
  session.kart.vy = 0;
  session.kart.boostTime = 0;
  setCallout(
    session,
    session.result.improved ? 'NEW DUNE RECORD!' : `${session.result.medal} RUN COMPLETE`,
    2.4,
    'finish',
  );
  safeSfx('victory');
  return session.result;
}

function fixedStep(session, controls, dt) {
  if (session.recoverQueued || gamepadState.justPressed?.y) {
    session.recoverQueued = false;
    recover(session);
  }
  session.kart.recoveryCooldown = Math.max(0, (session.kart.recoveryCooldown || 0) - dt);
  const cameraFx = stepDuneCameraFx(session, dt);
  const previousCheckpointCount = session.race.checkpointCount;
  const events = stepDuneVehicle(
    session.kart,
    controls,
    session.surfaceField,
    session.deformation,
    session.vehicleRuntime,
    dt,
  );
  const stunt = stepMonsterStunts(
    session.stuntRun,
    session.kart,
    controls,
    events,
    dt,
    session.vehicleProfile,
  );
  if (stunt.points > 0) {
    session.race.score += stunt.points;
    setCallout(session, `${stunt.label || 'DUNE AIR'} +${Math.round(stunt.points)}`, 1.4, stunt.perfect ? 'perfect' : 'style');
  }
  if (events.landed) {
    const impact = clamp(events.landingSpeed / 18, 0.12, 1);
    cameraFx.shake = Math.max(cameraFx.shake, impact);
    cameraFx.punch = Math.max(cameraFx.punch, impact * 0.72);
    cameraFx.roll += clamp((session.kart.contactRoll ?? session.kart.groundRoll ?? 0) * 0.08, -0.045, 0.045);
    playRacingImpact({ strength: clamp(events.landingSpeed / 20, 0.16, 1), kind: 'landing' });
  }
  stepDuneRace(session.race, session.event, session.routeRuntime, session.kart, dt);
  if (session.isRallyRaid) {
    applyRoadbookEvents(
      session,
      stepRoadbook(session.roadbook, session.event, session.routeRuntime, session.kart, session.race, dt),
    );
  }
  if (session.race.checkpointCount !== previousCheckpointCount) {
    setCallout(session, session.race.lastEvent, 1.1, 'checkpoint');
    safeSfx('levelUp');
  }
  stepDuneRecordRun(session.recordRun, session.kart, dt, {
    score: session.race.score,
    active: session.phase === 'racing',
  });
  emitDuneRoosterTail(session.roosterTail, session.kart, session.vehicleRuntime.contact, dt);
  if (session.quality.dustEnabled) {
    emitDuneDust(
      session.dust,
      session.kart,
      session.vehicleRuntime.contact,
      controls,
      events,
      dt * session.quality.dustScale,
    );
  }

  const inverted = session.kart.grounded && (
    Math.abs(normalizeAngle(session.kart.stuntRoll || 0)) > 1.35
    || Math.abs(normalizeAngle(session.kart.stuntPitch || 0)) > 1.72
  );
  session.invertedTime = inverted ? session.invertedTime + dt : Math.max(0, session.invertedTime - dt * 2);
  if (session.recoveryAssist && session.invertedTime > 1.25) recover(session, true);
  if (session.race.finished && session.phase === 'racing') finishRun(session);
}

function updateHud(session) {
  const hud = session.hud;
  if (!hud) return;
  const now = performance.now();
  if (now < session.nextHudUpdateAt) return;
  session.nextHudUpdateAt = now + 1000 / 30;
  const kart = session.kart;
  const race = session.race;
  const telemetry = getDuneVehicleTelemetry(session.vehicleRuntime);
  const progress = session.event.routeType === 'freeride'
    ? clamp(race.score / Math.max(1, session.event.medals.S), 0, 1)
    : session.event.routeType === 'circuit'
      ? clamp((race.completedLaps + race.routeProgress) / session.event.laps, 0, 1)
      : clamp(race.routeProgress, 0, 1);
  hud.progress.style.transform = `scaleX(${progress})`;
  hud.routePrimary.textContent = session.event.routeType === 'freeride'
    ? Math.round(race.score).toLocaleString()
    : `${Math.round(progress * 100)}%`;
  hud.routeSecondary.textContent = session.event.routeType === 'freeride'
    ? `${race.styleCombo.toFixed(1)}× STYLE · ${race.lastEvent || 'FIND A LINE'}`
    : session.event.routeType === 'circuit'
      ? `LAP ${Math.min(session.event.laps, race.completedLaps + 1)} / ${session.event.laps} · GATE ${race.nextCheckpoint + 1}/${race.checkpoints.length}`
      : `GATE ${Math.min(race.checkpoints.length, race.nextCheckpoint + 1)} / ${race.checkpoints.length}`;
  hud.clock.textContent = formatRaceTime(session.recordRun.elapsed);
  const previous = session.previousRecord;
  hud.best.textContent = previous
    ? session.event.routeType === 'freeride'
      ? `PB ${Number(previous.score || 0).toLocaleString()}`
      : `PB ${formatRaceTime(previous.time)}`
    : 'PB —';
  hud.speed.textContent = String(Math.round(kart.speed * 3.6));
  hud.surface.textContent = String(kart.currentSurface || 'dune-sand').replaceAll('-', ' ').toUpperCase();
  hud.heatFill.style.transform = `scaleX(${clamp(kart.boostHeat || 0, 0, 1)})`;
  hud.heat.classList.toggle('is-active', kart.boostTime > 0);
  hud.heat.classList.toggle('is-overheated', !!kart.overheated);
  hud.heatLabel.textContent = kart.overheated ? 'COOLING' : kart.boostTime > 0 ? 'CHURNING' : 'READY';
  hud.sandPrimary.textContent = `${telemetry.groundedWheels} CONTACT${telemetry.groundedWheels === 1 ? '' : 'S'}`;
  hud.sandSecondary.textContent = `RUT ${(telemetry.sinkage * 100).toFixed(1)} CM · SLIP ${Math.round(telemetry.wheelSlip * 100)}%`;
  if (session.isRallyRaid && hud.roadbook) {
    const book = roadbookSnapshot(session.roadbook, race);
    const next = book?.next;
    hud.roadbookAssist.textContent = book?.assist?.toUpperCase() || 'RALLY';
    hud.roadbookDistance.textContent = next ? `${next.distanceMeters} M` : 'FINISH';
    hud.roadbookSymbol.textContent = next?.symbol || 'FIN';
    hud.roadbookInstruction.textContent = next?.instruction || 'EXPEDITION COMPLETE';
    hud.roadbookCap.textContent = next ? `CAP ${String(next.cap).padStart(3, '0')}` : 'CAP —';
    hud.roadbookHazard.textContent = next ? `HAZARD ${(next.hazard || 'NONE').replaceAll('-', ' ')}` : 'HAZARD —';
    hud.roadbookWaypoint.textContent = `WP ${book?.validated || 0} / ${book?.total || 0} · +${book?.penaltySeconds || 0}s`;
    hud.roadbookStatus.textContent = book?.status || 'READ AHEAD';
    hud.roadbook.dataset.status = book?.missed > 0 ? 'penalty' : book?.activeSpeedZone ? 'speed' : 'clear';
  }
  hud.callout.textContent = session.calloutTime > 0 ? session.callout : '';
  hud.callout.dataset.tone = session.calloutTone || '';
  hud.countdown.textContent = session.phase === 'countdown'
    ? String(Math.max(1, Math.ceil(session.countdown)))
    : session.goTime > 0 ? 'GO!' : '';
  hud.finish.hidden = session.phase !== 'finished';
  if (session.result) {
    hud.medal.textContent = session.result.medal;
    hud.result.textContent = session.event.routeType === 'freeride'
      ? `${session.result.score.toLocaleString()} STYLE · ${session.race.recoveryCount} RECOVERIES`
      : session.isRallyRaid
        ? `${formatRaceTime(session.result.time)} · ${session.roadbook?.validated || 0}/${session.roadbook?.notes?.length || 0} WP · +${session.race.penaltySeconds || 0}s`
        : `${formatRaceTime(session.result.time)} · ${session.race.checkpointCount} GATES`;
    hud.record.textContent = session.isRallyRaid && session.result.expedition
      ? `EXPEDITION ${session.result.expedition.completedStages}/${session.result.expedition.totalStages} · CUM ${formatRaceTime(session.result.expedition.cumulativeTime)} · ${session.result.expedition.service === 'repair' ? 'SERVICE +18s' : 'PUSH ON'}`
      : session.result.improved ? 'NEW PERSONAL BEST · GHOST SAVED' : 'RUN SAVED · PERSONAL BEST HOLDS';
  }
  hud.root.dataset.phase = session.phase;
  hud.root.dataset.event = session.event.id;
  hud.root.dataset.vehicle = session.vehicleId;
  hud.root.dataset.surface = kart.currentSurface || '';
  hud.root.dataset.groundedWheels = String(telemetry.groundedWheels);
  hud.root.dataset.rutDepth = session.deformation.maximumDepression.toFixed(4);
  hud.root.dataset.bermHeight = session.deformation.maximumBerm.toFixed(4);
  hud.root.dataset.fps = String(Math.round(1 / Math.max(1 / 240, session.frameTimeEma)));
  hud.root.dataset.assetError = session.assetError || '';
}

function installQaHooks(session) {
  if (typeof window === 'undefined') return;
  const warp = (fraction = 0.25, speed = 0) => {
    const samples = session.routeRuntime.samples;
    const index = Math.min(samples.length - 1, Math.max(0, Math.round(clamp(Number(fraction) || 0, 0, 1) * (samples.length - 1))));
    const sample = samples[index];
    session.kart.x = sample.x;
    session.kart.z = sample.z;
    session.kart.y = session.surfaceField.heightAt(sample.x, sample.z);
    session.kart.yaw = sample.yaw;
    session.kart.previousX = sample.x;
    session.kart.previousZ = sample.z;
    session.kart.previousYaw = sample.yaw;
    session.kart.vx = Math.sin(sample.yaw) * speed;
    session.kart.vz = Math.cos(sample.yaw) * speed;
    session.kart.speed = Math.abs(speed);
    session.kart.forwardSpeed = speed;
    session.kart.vy = 0;
    session.kart.grounded = true;
    session.race.routeIndex = index;
    session.race.routeProgress = sample.progress;
    session.cameraManager?.onVehicleRespawned();
    return true;
  };
  const showState = (kind = 'slide') => {
    session.phase = 'racing';
    session.countdown = 0;
    if (kind === 'landing') {
      warp(0.32, 17);
      session.kart.y += 7;
      session.kart.vy = -8.5;
      session.kart.grounded = false;
      session.kart.airTime = 0.7;
      session.kart.stuntPitch = -0.06;
      session.qaControls = { throttle: 0.2, steer: 0, drift: false, handbrake: false, boost: false, hop: false };
      session.qaControlsTime = 1.4;
    } else if (kind === 'wheelspin') {
      warp(0.18, 2.6);
      session.qaControls = { throttle: 1, steer: 0.2, drift: false, handbrake: false, boost: true, hop: false };
      session.qaControlsTime = 3;
    } else if (kind === 'crest') {
      let best = 0;
      for (let index = 1; index < session.samples.length; index += 1) {
        if (session.samples[index].y > session.samples[best].y) best = index;
      }
      warp(best / Math.max(1, session.samples.length - 1), 19);
      session.qaControls = { throttle: 1, steer: 0, drift: false, handbrake: false, boost: false, hop: false };
      session.qaControlsTime = 2.5;
    } else if (kind === 'big-jump') {
      const hero = (session.event.routeProfile?.stamps || []).reduce((best, stamp) => (
        (stamp.elevation || 0) > (best?.elevation || -Infinity) ? stamp : best
      ), null);
      warp(hero?.fraction ?? 0.5, 22);
      session.kart.groundHeight = session.surfaceField.heightAt(session.kart.x, session.kart.z);
      session.kart.y = session.kart.groundHeight + 34;
      session.kart.vy = 11.5;
      session.kart.grounded = false;
      session.kart.groundedWheelCount = 0;
      session.kart.airTime = 0.9;
      session.kart.stuntPitch = -0.12;
      session.qaControls = { throttle: 0.45, steer: 0, drift: false, handbrake: false, boost: false, hop: false };
      session.qaControlsTime = 2.8;
    } else {
      warp(0.24, 17);
      const yaw = session.kart.yaw;
      session.kart.vx += Math.cos(yaw) * 5.5;
      session.kart.vz -= Math.sin(yaw) * 5.5;
      session.qaControls = { throttle: 0.82, steer: 0.72, drift: true, handbrake: true, boost: kind === 'boost', hop: false };
      session.qaControlsTime = 3;
    }
    return true;
  };
  const launchJump = (verticalSpeed = 38) => {
    // Preserve the current camera and horizontal driving state. This produces
    // a continuous ballistic launch instead of the old QA teleport, which
    // accidentally reset ISO and hid the real takeoff handoff.
    session.phase = 'racing';
    session.countdown = 0;
    session.kart.groundHeight = session.surfaceField.heightAt(session.kart.x, session.kart.z);
    session.kart.y = Math.max(session.kart.y, session.kart.groundHeight + 1.35);
    session.kart.vy = clamp(Number(verticalSpeed) || 38, 12, 44);
    session.kart.grounded = false;
    session.kart.groundedWheelCount = 0;
    session.kart.airTime = Math.max(0.01, session.kart.airTime || 0);
    session.qaControls = {
      throttle: 0.45,
      steer: 0,
      drift: false,
      handbrake: false,
      boost: false,
      hop: false,
    };
    session.qaControlsTime = 3.5;
    return true;
  };
  window.__kkRacing = {
    _duneSession: session,
    snapshot: () => getDuneSnapshot(),
    skipCountdown: () => {
      session.countdown = 0;
      session.phase = 'racing';
      session.goTime = 0.7;
      return true;
    },
    setCameraMode: (mode) => session.cameraManager?.setCameraMode(mode, { instant: true }) || false,
    cycleCamera: (direction = 1) => session.cameraManager?.cycleCamera(direction) || false,
    warpDuneProgress: warp,
    showDuneState: showState,
    launchDuneJump: launchJump,
    recover: () => recover(session),
    finish: () => finishRun(session),
  };
}

export async function enterDuneMode(scene, options = {}) {
  if (!scene || !state.hero?.mesh) throw new Error('Kaki Dune Run needs a scene and loaded hero');
  if (state.racing) {
    if (state.racing.raceMode === 'dunes') exitDuneMode(scene, state.racing);
    else throw new Error('Exit the active Kaki Rally session before entering Dune Run');
  }
  const event = options.customCourse?.isDrawTrack && options.customCourse?.drawThemeId === 'dune'
    ? createDrawDuneEvent(options.customCourse, options.customTrack)
    : getDuneEvent(options.duneEvent || options.eventId || 'whiskerwind');
  const requestedVehicleId = options.duneVehicle || options.monsterVehicle;
  const vehicleId = ['meowster', 'cyber', 'tipsy', ...RALLY_RAID_VEHICLE_IDS].includes(requestedVehicleId)
    ? requestedVehicleId
    : 'meowster';
  const vehicleProfile = getDuneVehicleProfile(vehicleId);
  const isRallyRaid = !!event.isRallyRaid;
  const quality = resolveQuality(options);
  const hero = state.hero.mesh;
  const owned = { geometries: new Set(), materials: new Set(), textures: new Set() };
  const root = new THREE.Group();
  root.name = `${isRallyRaid ? 'kaki-rally-raid' : 'kaki-dunes'}-${event.id}-${vehicleId}`;
  root.position.set(DUNE_CX, 0, DUNE_CZ);
  scene.add(root);
  const session = {
    scene,
    root,
    owned,
    raceMode: 'dunes',
    event,
    customCourse: event.isDrawTrack ? options.customCourse : null,
    customTrack: event.isDrawTrack ? (options.customTrack || options.customCourse?.drawDraft) : null,
    course: {
      id: event.id,
      name: event.name,
      trackWidth: event.routeWidth,
      laps: event.laps,
      surface: 'dune-sand',
      isDrawTrack: !!event.isDrawTrack,
      customTrackId: event.customTrackId || null,
    },
    quality,
    playerAvatarId: options.playerAvatarId || 'kitty',
    vehicleId,
    duneVehicleId: vehicleId,
    isRallyRaid,
    raidVehicle: isRallyRaidVehicle(vehicleId) ? getRallyRaidVehicle(vehicleId) : null,
    navigationAssist: ROADBOOK_ASSISTS[options.duneNavigationAssist]
      ? options.duneNavigationAssist
      : 'rally',
    serviceChoice: ['push', 'repair'].includes(options.duneService) ? options.duneService : 'push',
    expedition: isRallyRaid ? readRallyRaidProgress(vehicleId) : null,
    roadbook: null,
    vehicle: vehicleProfile,
    vehicleProfile,
    duneVehicleProfile: vehicleProfile,
    cameraHost: options.cameraHost || {},
    savedHero: saveHero(hero),
    difficulty: ['relaxed', 'standard', 'pro'].includes(options.duneDifficulty)
      ? options.duneDifficulty
      : 'standard',
    steeringAssist: options.duneSteeringAssist !== false && options.duneDifficulty !== 'pro',
    recoveryAssist: options.duneRecoveryAssist !== false && options.duneDifficulty !== 'pro',
    cameraShake: clamp(Number(options.duneCameraShake ?? 0.72), 0, 1),
    savedBackground: scene.background,
    savedFog: scene.fog,
    savedEnvVisible: state.envGroup ? state.envGroup.visible : true,
    assetLease: null,
    assetError: '',
    heightfield: null,
    deformation: null,
    surfaceField: null,
    routeRuntime: null,
    samples: [],
    checkpoints: [],
    race: null,
    recordRun: null,
    previousRecord: null,
    result: null,
    visual: null,
    ghost: null,
    cars: [],
    clipmap: null,
    duneEnvironment: null,
    roosterTail: null,
    dust: null,
    vehicleRuntime: null,
    stuntRun: createMonsterScoreState(0),
    kart: null,
    hud: null,
    phase: 'countdown',
    countdown: COUNTDOWN_SECONDS,
    goTime: 0,
    raceTime: 0,
    visualTime: 0,
    frameTimeEma: 1 / 60,
    physicsTimeMs: 0,
    accumulator: 0,
    nextHudUpdateAt: 0,
    controls: {
      throttle: 0,
      steer: 0,
      drift: false,
      handbrake: false,
      boost: false,
      hop: false,
      airPitch: 0,
      lean: 0,
    },
    touch: { slide: false, boost: false },
    recoverQueued: false,
    invertedTime: 0,
    callout: '',
    calloutTime: 0,
    calloutTone: '',
    cameraFx: { ...DUNE_CAMERA_FX_DEFAULTS },
    qaControls: null,
    qaControlsTime: 0,
    keyHandler: null,
    disposed: false,
  };
  try {
    session.assetLease = createRallyAssetLease({
      courseId: event.id,
      mode: 'dunes',
      monsterVehicleId: vehicleId,
      rendererService: state.rendererService,
    });
    const heightResolution = quality.terrain === 'low' ? 257 : event.heightResolution;
    const [heightfield] = await Promise.all([
      generateDuneHeightfield(event, { width: heightResolution, height: heightResolution }),
      session.assetLease.ready,
    ]);
    if (session.disposed) throw new Error('Dune Run loading was cancelled');
    session.heightfield = heightfield;
    session.routeRuntime = sampleDuneRoute(event, 3.5);
    session.deformation = new DuneDeformationField({
      worldSize: heightfield.worldSize,
      worldMinX: heightfield.minX,
      worldMinZ: heightfield.minZ,
      quality: quality.deformation,
      focusX: session.routeRuntime.samples[0].x,
      focusZ: session.routeRuntime.samples[0].z,
    });
    session.surfaceField = new DuneSurfaceField(heightfield, session.deformation);
    session.samples = routeSamplesWithTerrain(session.routeRuntime, session.surfaceField);
    session.race = createDuneRaceState(event, session.routeRuntime);
    session.roadbook = isRallyRaid
      ? createRoadbookState(event, session.routeRuntime, session.navigationAssist)
      : null;
    session.checkpoints = session.race.checkpoints;
    const start = session.routeRuntime.samples[0];
    const startY = session.surfaceField.heightAt(start.x, start.z);
    session.kart = createDuneVehicleState({
      vehicleId,
      x: start.x,
      y: startY,
      z: start.z,
      yaw: start.yaw,
    });
    session.vehicleRuntime = new DuneVehicleRuntime({
      vehicleId,
      quality: quality.deformation,
    });
    const progress = readDuneRecords();
    session.previousRecord = progress.records[duneRecordKey(event.id, vehicleId)] || null;
    session.recordRun = createDuneRecordRun({
      eventId: event.id,
      vehicleId,
      previousRecord: session.previousRecord,
    });

    scene.background = new THREE.Color(event.palette.skyTop);
    scene.fog = new THREE.Fog(
      event.palette.fog,
      event.weather === 'sandstorm' ? 38 : 110,
      event.weather === 'sandstorm' ? 260 : Math.max(560, event.worldSize * 0.86),
    );
    if (state.envGroup) state.envGroup.visible = false;
    session.clipmap = buildDuneClipmap({
      heightfield,
      deformation: session.deformation,
      palette: event.palette,
      quality: quality.terrain,
      detailTexture: session.assetLease.textures.duneSandDetail,
    });
    root.add(session.clipmap.root);
    session.duneEnvironment = buildDuneEnvironment({
      root,
      eventDefinition: event,
      surfaceField: session.surfaceField,
      routeRuntime: session.routeRuntime,
      checkpoints: session.checkpoints,
      quality: quality.shadow,
      reduceMotion: !!state._optReduceMotion,
    });
    if (!attachDuneEnvironmentKit(session.duneEnvironment, session.assetLease.models.duneEnvironmentKit)) {
      throw new Error('The authored Dune Run environment kit could not be attached');
    }

    hero.parent?.remove(hero);
    session.visual = buildPlayerVisual(session, hero);
    if (!attachPlayerBody(session)) {
      session.assetError = `${vehicleProfile.name} authored body did not attach; finished procedural running gear remains active.`;
    }
    session.cars = [{
      id: 'player',
      name: vehicleProfile.name,
      avatarId: session.playerAvatarId,
      gridIndex: 0,
      physics: session.kart,
      visual: session.visual,
    }];
    session.ghost = buildGhost(session);
    session.roosterTail = createDuneRoosterTail(root, {
      quality: quality.particles,
      reduceMotion: !!state._optReduceMotion,
    });
    session.dust = createDuneDust(root, {
      quality: quality.particles,
      reduceMotion: !!state._optReduceMotion,
    });
    mountHud(session);
    state.racing = session;
    state.mode = 'racing';
    state.gameOver = false;
    state.victory = false;
    attachRacingCameraManager(session, session.cameraHost);
    updatePlayerVisual(session, 0);
    session.clipmap.update(session.kart.x, session.kart.z, 0, event.terrain.windAngle);
    updateDuneEnvironment(session.duneEnvironment, 0, session.kart);
    installQaHooks(session);
    session.keyHandler = (keyEvent) => {
      if (
        keyEvent.code === 'KeyR'
        && !keyEvent.repeat
        && !keyEvent.ctrlKey
        && !keyEvent.metaKey
        && !keyEvent.altKey
      ) {
        session.recoverQueued = true;
        keyEvent.preventDefault();
      }
    };
    globalThis.addEventListener?.('keydown', session.keyHandler);
    consumeJump();
    return session;
  } catch (error) {
    try { exitDuneMode(scene, session); } catch (_) {}
    throw error;
  }
}

export function tickDuneMode(dt, elapsedDt = dt) {
  const session = state.racing?.raceMode === 'dunes' ? state.racing : null;
  if (!session || !(dt > 0)) return;
  const wallDt = Math.min(0.1, Math.max(0, Number(elapsedDt) || dt));
  const safeDt = Math.min(0.05, Number(dt) || 0);
  session.frameTimeEma += (wallDt - session.frameTimeEma) * 0.06;
  session.visualTime += wallDt;
  session.goTime = Math.max(0, session.goTime - wallDt);
  session.calloutTime = Math.max(0, session.calloutTime - wallDt);
  session.qaControlsTime = Math.max(0, session.qaControlsTime - wallDt);
  if (session.qaControlsTime <= 0) session.qaControls = null;
  const controls = readControls(session);
  if (session.phase === 'countdown') {
    session.countdown -= wallDt;
    if (session.countdown <= 0) {
      session.countdown = 0;
      session.phase = 'racing';
      session.goTime = 0.72;
      setCallout(session, 'DROP A PAW!', 0.9, 'start');
      safeSfx('uiClick');
    }
  }
  if (session.phase === 'racing') {
    session.accumulator = Math.min(session.accumulator + safeDt, FIXED_STEP * MAX_FIXED_STEPS);
    const physicsStarted = performance.now();
    let steps = 0;
    while (session.accumulator >= FIXED_STEP && steps < MAX_FIXED_STEPS) {
      fixedStep(session, controls, FIXED_STEP);
      session.accumulator -= FIXED_STEP;
      steps += 1;
    }
    session.physicsTimeMs = performance.now() - physicsStarted;
    session.raceTime = session.recordRun.elapsed;
  } else {
    session.accumulator = 0;
  }

  duneWindVector(session.event, _wind);
  const windStrength = session.event.weather === 'sandstorm' ? 1.15 : 0.42;
  if (session.quality.dustEnabled) {
    emitAmbientDuneDust(
      session.dust,
      session.kart,
      wallDt * session.quality.dustScale,
      windStrength,
    );
  }
  updateDuneDust(session.dust, wallDt, _wind.x * windStrength * 3.8, _wind.z * windStrength * 3.8);
  updateDuneRoosterTail(
    session.roosterTail,
    session.visualTime,
    _wind.x * windStrength * 2.1,
    _wind.z * windStrength * 2.1,
  );
  session.clipmap.update(
    session.kart.x,
    session.kart.z,
    session.visualTime,
    session.event.terrain.windAngle,
  );
  updateDuneEnvironment(session.duneEnvironment, session.visualTime, session.kart);
  updatePlayerVisual(session, wallDt);
  updateGhost(session);
  _cameraTarget.set(
    DUNE_CX + session.kart.x,
    session.kart.y + 1.8,
    DUNE_CZ + session.kart.z,
  );
  updateHud(session);
  if (session.phase === 'finished') {
    if (!session.audioStopped) {
      session.audioStopped = true;
      stopRacingAudio();
    }
  } else {
    updateRacingAudio({
      speed: session.kart.speed,
      throttle: controls.throttle,
      slip: Math.max(
        Math.abs(session.kart.lateralSpeed || 0) / 7,
        session.kart.wheelSlip || 0,
      ),
      airborne: !session.kart.grounded,
      boost: session.kart.boostTime > 0,
      turboHeat: session.kart.boostHeat || 0,
      monster: true,
      wheelRpm: session.kart.wheelRpm || 0,
      gear: session.kart.gear || 1,
      engineLoad: session.kart.engineLoad || 0,
      engineBraking: session.kart.engineBrake || 0,
      acceleration: session.kart.acceleration || 0,
      vehicleId: session.vehicleId,
      groundedWheels: session.kart.groundedWheelCount || 0,
      surface: session.kart.currentSurface || 'dune-sand',
      environment: 'dunes',
      raceMode: 'dunes',
    });
  }
}

export function restartDuneMode(scene, options = {}) {
  const current = state.racing?.raceMode === 'dunes' ? state.racing : null;
  const next = {
    duneEvent: options.duneEvent || current?.event?.id || 'whiskerwind',
    duneVehicle: options.duneVehicle || current?.vehicleId || 'meowster',
    duneTerrain: current?.quality?.terrain,
    duneDeformation: current?.quality?.deformation,
    duneParticles: current?.quality?.particles,
    duneDust: current?.quality?.dustEnabled,
    duneShadow: current?.quality?.shadow,
    duneHeatHaze: current?.quality?.heatHaze,
    duneDifficulty: current?.difficulty,
    duneSteeringAssist: current?.steeringAssist,
    duneRecoveryAssist: current?.recoveryAssist,
    duneCameraShake: current?.cameraShake,
    duneNavigationAssist: options.duneNavigationAssist || current?.navigationAssist || 'rally',
    duneService: options.duneService || current?.serviceChoice || 'push',
    playerAvatarId: options.playerAvatarId || current?.playerAvatarId || 'kitty',
    cameraHost: options.cameraHost || current?.cameraHost || {},
    customCourse: options.customCourse || current?.customCourse || null,
    customTrack: options.customTrack || current?.customTrack || null,
  };
  const ownerScene = scene || current?.scene || state.scene;
  if (current) exitDuneMode(ownerScene, current);
  return enterDuneMode(ownerScene, next);
}

export function exitDuneMode(scene, explicitSession = null) {
  const session = explicitSession || (state.racing?.raceMode === 'dunes' ? state.racing : null);
  if (!session || session.disposed) return;
  session.disposed = true;
  session.touch.slide = false;
  session.touch.boost = false;
  if (session.keyHandler) globalThis.removeEventListener?.('keydown', session.keyHandler);
  try { session.cameraManager?.dispose(); } catch (_) {}
  stopRacingAudio();
  try { session.hud?.root?.remove(); } catch (_) {}
  restoreHero(session, scene);
  try { disposeDuneRoosterTail(session.roosterTail); } catch (_) {}
  try { disposeDuneDust(session.dust); } catch (_) {}
  try { session.clipmap?.dispose(); } catch (_) {}
  try { disposeDuneEnvironment(session.duneEnvironment); } catch (_) {}
  try {
    session.root?.traverse?.((object) => {
      if (object.isLight && object.shadow?.map) object.shadow.map.dispose();
    });
  } catch (_) {}
  try { session.root?.parent?.remove(session.root); } catch (_) {}
  for (const texture of session.owned?.textures || []) { try { texture.dispose(); } catch (_) {} }
  for (const material of session.owned?.materials || []) { try { material.dispose(); } catch (_) {} }
  for (const geometry of session.owned?.geometries || []) { try { geometry.dispose(); } catch (_) {} }
  try { session.assetLease?.release(); } catch (_) {}
  const ownerScene = scene || session.scene;
  if (ownerScene) {
    ownerScene.background = session.savedBackground;
    ownerScene.fog = session.savedFog;
  }
  if (state.envGroup) state.envGroup.visible = session.savedEnvVisible;
  if (state.racing === session) state.racing = null;
  try {
    if (window.__kkRacing?._duneSession === session) delete window.__kkRacing;
  } catch (_) {}
}

export function getDuneCameraTarget() {
  return _cameraTarget;
}

export function getDuneCameraConfig() {
  const session = state.racing?.raceMode === 'dunes' ? state.racing : null;
  if (!session) return { offset: 29, height: 43, frustum: 21, lookAtBase: 1.4 };
  const speed = clamp(session.kart.speed / session.vehicleProfile.tuning.boostSpeed, 0, 1.2);
  const altitude = clamp((session.kart.y - session.kart.groundHeight) / 12, 0, 1.2);
  return {
    offset: 27 + speed * 4,
    height: 40 + speed * 4.4 + altitude * 5,
    frustum: 20 + speed * 2.4 + altitude * 2,
    lookAtBase: 1.4 + speed * 0.32,
    damping: session.kart.grounded ? 0.16 : 0.105,
    chromatic: state._optReduceMotion ? 0 : 0.0008 + (session.kart.boostTime > 0 ? 0.0014 : 0),
    heatHaze: session.quality.heatHaze
      ? session.event.weather === 'heat' ? 0.00145 : session.event.weather === 'sandstorm' ? 0.00042 : 0.00072
      : 0,
    bloom: 0.37 + (session.kart.boostTime > 0 ? 0.14 : 0),
  };
}

export function getDuneSnapshot() {
  const session = state.racing?.raceMode === 'dunes' ? state.racing : null;
  if (!session) return null;
  const telemetry = getDuneVehicleTelemetry(session.vehicleRuntime);
  const renderedHeight = duneClipmapRenderedHeightAt(
    session.clipmap,
    session.kart.x,
    session.kart.z,
  );
  const physicsHeight = session.surfaceField.heightAt(session.kart.x, session.kart.z);
  return {
    mode: 'racing',
    raceMode: 'dunes',
    phase: session.phase,
    eventId: session.event.id,
    event: {
      id: session.event.id,
      name: session.event.name,
      routeType: session.event.routeType,
      weather: session.event.weather,
      timeOfDay: session.event.timeOfDay,
      isDrawTrack: !!session.event.isDrawTrack,
      customTrackId: session.event.customTrackId || null,
    },
    vehicleId: session.vehicleId,
    vehicle: { id: session.vehicleId, name: session.vehicle.name },
    rallyRaid: session.isRallyRaid
      ? {
          vehicle: session.raidVehicle,
          navigationAssist: session.navigationAssist,
          serviceChoice: session.serviceChoice,
          expedition: session.expedition,
          roadbook: roadbookSnapshot(session.roadbook, session.race),
        }
      : null,
    speed: session.kart.speed,
    x: session.kart.x,
    y: session.kart.y,
    z: session.kart.z,
    grounded: session.kart.grounded,
    telemetry,
    race: {
      elapsed: session.recordRun.elapsed,
      progress: session.race.routeProgress,
      lap: session.race.completedLaps,
      targetLaps: session.race.targetLaps,
      checkpoint: session.race.nextCheckpoint,
      checkpoints: session.race.checkpoints.length,
      score: Math.round(session.race.score),
      penaltySeconds: session.race.penaltySeconds || 0,
      recoveries: session.race.recoveryCount,
      finished: session.race.finished,
    },
    terrain: {
      heightfield: session.heightfield.getSnapshot(),
      clipmap: session.clipmap.snapshot(),
      rendererPhysicsDelta: Math.abs(renderedHeight - physicsHeight),
      authorityShared: renderedHeight === physicsHeight,
    },
    deformation: session.deformation.snapshot(),
    environment: duneEnvironmentSnapshot(session.duneEnvironment),
    vfx: {
      roosterTail: duneRoosterTailSnapshot(session.roosterTail),
      dust: duneDustSnapshot(session.dust),
    },
    records: {
      key: session.recordRun.key,
      previous: session.previousRecord,
      result: session.result,
      samples: session.recordRun.sampleCount,
      ghostVisible: !!session.ghost?.visual?.root?.visible,
    },
    visual: {
      authoredBody: !!session.visual?.modelAttached || session.isRallyRaid,
      wheels: session.visual?.wheels?.length || 0,
      suspension: session.visual?.suspension?.length || 0,
    },
    quality: session.quality,
    assists: {
      difficulty: session.difficulty,
      steering: session.steeringAssist,
      recovery: session.recoveryAssist,
      cameraShake: session.cameraShake,
    },
    camera: session.cameraManager?.getSnapshot() || null,
    assets: {
      ids: session.assetLease?.ids || [],
      error: session.assetError || '',
      cache: getRallyAssetCacheSnapshot(),
    },
    performance: {
      fps: Math.round(1 / Math.max(1 / 240, session.frameTimeEma)),
      physicsMs: session.physicsTimeMs,
      drawCalls: getRendererDiagnostics(state).drawCalls ?? null,
      triangles: getRendererDiagnostics(state).triangles ?? null,
    },
  };
}
