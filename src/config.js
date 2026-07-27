/**
 * Standalone Kaki Rally configuration.
 *
 * Keep this file limited to values consumed by the racing runtime and its
 * driver presentation. Combat, progression, stage, enemy, weapon, and XP
 * configuration deliberately do not exist in this repository.
 */

export const HERO = Object.freeze({
  glb: 'runtime-avatars/tower-castle-plain.glb',
  targetHeight: 3.6,
  scale: 1,
});

export const AVATARS = Object.freeze([
  Object.freeze({ id: 'kitty', name: 'Kitty Kaki', icon: '🐱', glb: null, tint: 0xffffff, scaleMul: 1 }),
  Object.freeze({ id: 'sote', name: 'Sote', icon: '🐺', glb: 'runtime-avatars/sote.glb', tint: 0xffffff, scaleMul: 1 }),
  Object.freeze({ id: 'cowboy', name: 'CowboyKaki', icon: '🤠', glb: 'runtime-avatars/cowboykaki.glb', tint: 0xffffff, scaleMul: 1 }),
  Object.freeze({ id: 'pipes', name: 'Pipes', icon: '🥸', glb: 'runtime-avatars/pipes.glb', tint: 0xffffff, scaleMul: 1 }),
  Object.freeze({ id: 'bomdia', name: 'Bom Dia', icon: '☀️', glb: 'runtime-avatars/bomdia.glb', tint: 0xffffff, scaleMul: 1 }),
  Object.freeze({ id: 'mothman', name: 'Mothman', icon: '🦋', glb: 'runtime-avatars/mothman.glb', tint: 0xffffff, scaleMul: 1 }),
  Object.freeze({ id: 'camper', name: 'Camper', icon: '⛺', glb: 'runtime-avatars/camper.glb', tint: 0xffffff, scaleMul: 1 }),
  Object.freeze({ id: 'space', name: 'Space Kitty', icon: '🚀', glb: 'runtime-avatars/spacekitty.glb', tint: 0xffffff, scaleMul: 1 }),
  Object.freeze({ id: 'radcat', name: 'Radcat', icon: '☢️', glb: 'runtime-avatars/radcat.glb', tint: 0xffffff, scaleMul: 1 }),
  Object.freeze({ id: 'mona', name: 'Mona', icon: '🎨', glb: 'runtime-avatars/mona.glb', tint: 0xffffff, scaleMul: 1 }),
  Object.freeze({ id: 'bezelbug', name: 'BezelBug', icon: '💎', glb: 'runtime-avatars/bezelbug.glb', tint: 0xffffff, scaleMul: 1 }),
  Object.freeze({ id: 'rocker', name: 'RockerKaki', icon: '🎸', glb: 'runtime-avatars/rockerkaki.glb', tint: 0xffffff, scaleMul: 1 }),
  Object.freeze({ id: 'borgirboss', name: 'BorgirBoss', icon: '🍔', glb: 'runtime-avatars/borgirboss.glb', tint: 0xffffff, scaleMul: 1.15 }),
]);

export const RALLY_DISPLAY = Object.freeze({
  background: 0x0b1014,
  fog: 0x0b1014,
  desktopAspect: 16 / 9,
  mobileLandscapeAspect: 21 / 9,
  cameraHalfHeight: 18,
  dprCap: 1.25,
});
