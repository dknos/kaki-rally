/**
 * Frozen Kaki Catastrophe working set.
 *
 * This manifest deliberately lives inside the frozen experiment. Nothing in
 * the seven production modes imports it, and the files are requested only after
 * the localhost development gate has been enabled explicitly.
 */
export const CATASTROPHE_ASSET_MANIFEST = Object.freeze({
  decalAtlas: Object.freeze({
    url: 'assets/racing/kaki-rally-decal-atlas-imagegen-v1.webp',
    kind: 'color',
  }),
  crashVehicleKitV2: Object.freeze({
    url: 'assets/racing/crash/kaki-catastrophe-vehicles-v2.glb',
    kind: 'model',
  }),
  crashEnvironmentV2: Object.freeze({
    url: 'assets/racing/crash/pawprint-moonpaw-environment-v2.glb',
    kind: 'model',
  }),
  skyTwilight: Object.freeze({
    url: 'assets/textures/sky_twilight.webp',
    kind: 'color',
  }),
});

export const CATASTROPHE_ASSET_IDS = Object.freeze([
  'decalAtlas',
  'crashVehicleKitV2',
  'crashEnvironmentV2',
  'skyTwilight',
]);
