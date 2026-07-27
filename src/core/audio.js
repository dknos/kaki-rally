let context = null;
let masterBus = null;
let musicBus = null;
let sfxBus = null;
let ambientBus = null;
let menuMusic = null;
let racingAudio = null;
let racingNoise = null;
let enabled = true;
let masterVolume = 1;
let musicVolume = 0.55;
let sfxVolume = 0.72;
let ambientVolume = 0.5;
const cleanupTimers = new Set();
const counters = { menu: 0, racing: 0, impact: 0, sfx: 0 };

function audioContextClass() {
  return globalThis.AudioContext || globalThis.webkitAudioContext || null;
}

function ensureContext() {
  if (context) return context;
  const Context = audioContextClass();
  if (!Context) return null;
  context = new Context();
  masterBus = context.createGain();
  musicBus = context.createGain();
  sfxBus = context.createGain();
  ambientBus = context.createGain();
  masterBus.gain.value = masterVolume;
  musicBus.gain.value = musicVolume;
  sfxBus.gain.value = sfxVolume;
  ambientBus.gain.value = ambientVolume;
  musicBus.connect(masterBus);
  sfxBus.connect(masterBus);
  ambientBus.connect(masterBus);
  masterBus.connect(context.destination);
  return context;
}

function scheduleCleanup(callback, delay) {
  const timer = setTimeout(() => {
    cleanupTimers.delete(timer);
    callback();
  }, delay);
  cleanupTimers.add(timer);
  return timer;
}

function tone({
  frequency = 220,
  endFrequency = frequency,
  duration = 0.1,
  gain = 0.08,
  type = 'triangle',
  destination = sfxBus,
} = {}) {
  if (!enabled) return false;
  const ctx = ensureContext();
  if (!ctx || ctx.state !== 'running' || !destination) return false;
  const now = ctx.currentTime;
  const oscillator = ctx.createOscillator();
  const envelope = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(Math.max(20, frequency), now);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), now + duration);
  envelope.gain.setValueAtTime(Math.max(0.0001, gain), now);
  envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(envelope).connect(destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.015);
  scheduleCleanup(() => {
    try { oscillator.disconnect(); } catch (_) {}
    try { envelope.disconnect(); } catch (_) {}
  }, Math.ceil((duration + 0.08) * 1000));
  counters.sfx += 1;
  return true;
}

function noiseBuffer(ctx) {
  if (racingNoise) return racingNoise;
  const length = Math.max(1, Math.round(ctx.sampleRate * 0.75));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 0x4b414b49;
  for (let index = 0; index < length; index++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    data[index] = ((seed >>> 0) / 0xffffffff) * 2 - 1;
  }
  racingNoise = buffer;
  return buffer;
}

function noiseHit({ duration = 0.12, gain = 0.08, frequency = 760, type = 'bandpass' } = {}) {
  if (!enabled) return false;
  const ctx = ensureContext();
  if (!ctx || ctx.state !== 'running' || !sfxBus) return false;
  const now = ctx.currentTime;
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const envelope = ctx.createGain();
  source.buffer = noiseBuffer(ctx);
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = 0.8;
  envelope.gain.setValueAtTime(Math.max(0.0001, gain), now);
  envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  source.connect(filter).connect(envelope).connect(sfxBus);
  source.start(now);
  source.stop(now + duration + 0.015);
  scheduleCleanup(() => {
    for (const node of [source, filter, envelope]) try { node.disconnect(); } catch (_) {}
  }, Math.ceil((duration + 0.08) * 1000));
  counters.sfx += 1;
  return true;
}

export async function unlockAudio() {
  const ctx = ensureContext();
  if (!ctx) return false;
  if (ctx.state === 'suspended') {
    try { await ctx.resume(); } catch (_) {}
  }
  return ctx.state === 'running';
}

export function setEnabled(value) {
  enabled = !!value;
}

export function setMasterVolume(value) {
  masterVolume = Math.max(0, Math.min(1, Number(value) || 0));
  if (masterBus) masterBus.gain.value = masterVolume;
}

export function setMusicVolume(value) {
  musicVolume = Math.max(0, Math.min(1, Number(value) || 0));
  if (musicBus) musicBus.gain.value = musicVolume;
}

export function setSfxVolume(value) {
  sfxVolume = Math.max(0, Math.min(1, Number(value) || 0));
  if (sfxBus) sfxBus.gain.value = sfxVolume;
}

export function setAmbientVolume(value) {
  ambientVolume = Math.max(0, Math.min(1, Number(value) || 0));
  if (ambientBus) ambientBus.gain.value = ambientVolume;
}

export function setVolume(value) {
  setMasterVolume(value);
}

function ensureRacingAudio() {
  if (!enabled) return null;
  const ctx = ensureContext();
  if (!ctx || ctx.state !== 'running') return null;
  if (racingAudio) return racingAudio;

  const engine = ctx.createOscillator();
  const engineGain = ctx.createGain();
  const harmonic = ctx.createOscillator();
  const harmonicGain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  const mix = ctx.createGain();
  engine.type = 'sawtooth';
  harmonic.type = 'square';
  engine.frequency.value = 54;
  harmonic.frequency.value = 108;
  engineGain.gain.value = 0.0001;
  harmonicGain.gain.value = 0.0001;
  filter.type = 'lowpass';
  filter.frequency.value = 520;
  filter.Q.value = 1.3;
  mix.gain.value = 0.0001;
  engine.connect(engineGain).connect(filter);
  harmonic.connect(harmonicGain).connect(filter);
  filter.connect(mix).connect(sfxBus);

  const tire = ctx.createBufferSource();
  const tireFilter = ctx.createBiquadFilter();
  const tireGain = ctx.createGain();
  tire.buffer = noiseBuffer(ctx);
  tire.loop = true;
  tireFilter.type = 'bandpass';
  tireFilter.frequency.value = 760;
  tireFilter.Q.value = 0.72;
  tireGain.gain.value = 0.0001;
  tire.connect(tireFilter).connect(tireGain).connect(sfxBus);
  engine.start();
  harmonic.start();
  tire.start();
  racingAudio = {
    ctx,
    engine,
    engineGain,
    harmonic,
    harmonicGain,
    filter,
    mix,
    tire,
    tireFilter,
    tireGain,
    lastGear: 1,
    shiftDip: 0,
  };
  counters.racing += 1;
  return racingAudio;
}

export function updateRacingAudio({
  speed = 0,
  throttle = 0,
  slip = 0,
  airborne = false,
  boost = false,
  turboHeat = 0,
  monster = false,
  wheelRpm = 0,
  gear = 1,
  engineLoad = 0,
  vehicleId = '',
  groundedWheels = 4,
} = {}) {
  const audio = ensureRacingAudio();
  if (!audio) return false;
  const now = audio.ctx.currentTime;
  const safeSpeed = Math.max(0, Number(speed) || 0);
  const speedRatio = Math.min(1.35, safeSpeed / (monster ? 24 : 29));
  const throttleLoad = Math.min(1, Math.abs(Number(throttle) || 0));
  const load = monster ? Math.min(1, Math.max(throttleLoad * 0.62, Number(engineLoad) || 0)) : throttleLoad;
  const safeSlip = Math.min(1, Math.abs(Number(slip) || 0));
  const heat = Math.min(1, Math.max(0, Number(turboHeat) || 0));
  const safeGear = Math.max(1, Math.min(5, Math.round(Number(gear) || 1)));
  if (monster && safeGear !== audio.lastGear) audio.shiftDip = 1;
  audio.lastGear = safeGear;
  audio.shiftDip *= 0.84;
  const wheelRatio = Math.min(1.5, Math.abs(Number(wheelRpm) || 0) / 220);
  const gearRatio = [0, 1.72, 1.43, 1.2, 1.02, 0.88][safeGear];
  const planted = Math.min(1, Math.max(0, Number(groundedWheels) || 0) / 4);
  const cyber = monster && vehicleId === 'cyber';
  const base = monster ? (cyber ? 38 : 46) : 62;
  const drivenRpm = monster
    ? wheelRatio * 86 * gearRatio + load * (cyber ? 15 : 22) + (1 - planted) * 10
    : speedRatio * 154 + load * 31;
  const rpm = base + drivenRpm - audio.shiftDip * (monster ? 18 : 0);
  const boostLift = boost ? (monster ? 26 : 42) : 0;
  audio.engine.frequency.setTargetAtTime(rpm + boostLift, now, 0.045);
  audio.harmonic.frequency.setTargetAtTime((rpm + boostLift) * (monster ? (cyber ? 1.38 : 1.56) : 1.92), now, 0.055);
  audio.engineGain.gain.setTargetAtTime(0.38, now, 0.04);
  audio.harmonicGain.gain.setTargetAtTime(monster ? (cyber ? 0.105 : 0.135) : 0.075, now, 0.055);
  audio.filter.frequency.setTargetAtTime(
    (monster ? 360 : 520) + speedRatio * 980 + load * 300 + (boost ? 1150 : 0) + heat * 220,
    now,
    0.06,
  );
  audio.mix.gain.setTargetAtTime(
    (0.018 + load * 0.022 + speedRatio * 0.018 + (boost ? 0.018 : 0)) * (airborne ? 0.7 : 1),
    now,
    airborne ? 0.12 : 0.055,
  );
  const tireAmount = airborne ? 0 : Math.min(1, safeSlip * 1.35 + speedRatio * 0.07);
  audio.tireFilter.frequency.setTargetAtTime(480 + safeSpeed * 31 + safeSlip * 620, now, 0.045);
  audio.tireGain.gain.setTargetAtTime(tireAmount * (monster ? 0.038 : 0.048), now, 0.045);
  return true;
}

export function stopRacingAudio({ immediate = false } = {}) {
  const audio = racingAudio;
  if (!audio) return false;
  racingAudio = null;
  const now = audio.ctx.currentTime;
  const release = immediate ? 0.01 : 0.14;
  for (const parameter of [audio.mix.gain, audio.tireGain.gain]) {
    try {
      parameter.cancelScheduledValues(now);
      parameter.setValueAtTime(Math.max(0.0001, parameter.value), now);
      parameter.exponentialRampToValueAtTime(0.0001, now + release);
    } catch (_) {}
  }
  for (const source of [audio.engine, audio.harmonic, audio.tire]) {
    try { source.stop(now + release + 0.015); } catch (_) {}
  }
  scheduleCleanup(() => {
    for (const node of [
      audio.engine, audio.engineGain, audio.harmonic, audio.harmonicGain,
      audio.filter, audio.mix, audio.tire, audio.tireFilter, audio.tireGain,
    ]) try { node.disconnect(); } catch (_) {}
  }, Math.ceil((release + 0.06) * 1000));
  return true;
}

export function playRacingImpact({ strength = 0.5, kind = 'crash' } = {}) {
  const amount = Math.max(0, Math.min(1.6, Number(strength) || 0));
  if (!(amount > 0)) return false;
  counters.impact += 1;
  noiseHit({
    duration: 0.08 + amount * (kind === 'smash' ? 0.22 : 0.12),
    gain: 0.018 + amount * 0.075,
    frequency: kind === 'smash' ? 980 : kind === 'landing' ? 340 : 700,
    type: kind === 'landing' ? 'lowpass' : 'bandpass',
  });
  return tone({
    frequency: kind === 'smash' ? 96 : kind === 'landing' ? 72 : 118,
    endFrequency: 34,
    duration: 0.09 + amount * 0.12,
    gain: 0.015 + amount * 0.07,
    type: 'sine',
  });
}

export const sfx = Object.freeze({
  hit: () => playRacingImpact({ strength: 0.35, kind: 'crash' }),
  victory: () => {
    tone({ frequency: 392, endFrequency: 523, duration: 0.18, gain: 0.08 });
    scheduleCleanup(() => tone({ frequency: 659, endFrequency: 784, duration: 0.24, gain: 0.07 }), 130);
  },
  uiClick: () => tone({ frequency: 420, endFrequency: 560, duration: 0.055, gain: 0.045, type: 'square' }),
  uiCancel: () => tone({ frequency: 300, endFrequency: 180, duration: 0.08, gain: 0.04, type: 'triangle' }),
  speedBoostActivate: () => tone({ frequency: 220, endFrequency: 820, duration: 0.18, gain: 0.065, type: 'sawtooth' }),
  racingBoost: () => noiseHit({ duration: 0.13, gain: 0.06, frequency: 1300 }),
  explosion: () => playRacingImpact({ strength: 1.25, kind: 'smash' }),
  crystalShatter: () => noiseHit({ duration: 0.16, gain: 0.055, frequency: 2600, type: 'highpass' }),
  grappleImpact: () => playRacingImpact({ strength: 0.28, kind: 'landing' }),
  bossShockwave: () => playRacingImpact({ strength: 1.45, kind: 'smash' }),
  bossWarn: () => tone({ frequency: 220, endFrequency: 220, duration: 0.32, gain: 0.07, type: 'sine' }),
});

export function playMenuMusic() {
  if (!enabled || typeof Audio === 'undefined') return false;
  const ctx = ensureContext();
  if (!ctx || ctx.state === 'closed') return false;
  if (!menuMusic) {
    const element = new Audio(new URL('../../assets/music/menu_glitch.mp3', import.meta.url).href);
    element.loop = true;
    element.preload = 'auto';
    let source = null;
    let gain = null;
    try {
      source = ctx.createMediaElementSource(element);
      gain = ctx.createGain();
      gain.gain.value = 0.68;
      source.connect(gain).connect(musicBus);
    } catch (error) {
      console.warn('[Kaki Rally audio] menu track routing failed', error?.message || error);
    }
    menuMusic = { element, source, gain };
  }
  counters.menu += 1;
  const promise = menuMusic.element.play();
  promise?.catch?.(() => {});
  return true;
}

export function stopMenuMusic() {
  if (!menuMusic) return false;
  try { menuMusic.element.pause(); } catch (_) {}
  return true;
}

export const playMenuBed = playMenuMusic;
export const stopMenuBed = stopMenuMusic;

export async function suspendAudio() {
  stopMenuMusic();
  if (context?.state === 'running') {
    try { await context.suspend(); } catch (_) {}
  }
}

export async function resumeAudio({ menu = false } = {}) {
  if (context?.state === 'suspended') {
    try { await context.resume(); } catch (_) {}
  }
  if (menu) playMenuMusic();
}

export function getAudioDiagnostics() {
  return {
    contextState: context?.state || 'uninitialized',
    menuPlaying: !!menuMusic && !menuMusic.element.paused,
    racingActive: !!racingAudio,
    cleanupTimers: cleanupTimers.size,
    volumes: { master: masterVolume, music: musicVolume, sfx: sfxVolume, ambient: ambientVolume },
    counters: { ...counters },
  };
}

export async function disposeAudio() {
  stopRacingAudio({ immediate: true });
  if (menuMusic) {
    try { menuMusic.element.pause(); } catch (_) {}
    try { menuMusic.source?.disconnect(); } catch (_) {}
    try { menuMusic.gain?.disconnect(); } catch (_) {}
    menuMusic = null;
  }
  for (const timer of cleanupTimers) clearTimeout(timer);
  cleanupTimers.clear();
  if (context && context.state !== 'closed') {
    try { await context.close(); } catch (_) {}
  }
  context = null;
  masterBus = musicBus = sfxBus = ambientBus = null;
  racingNoise = null;
}
