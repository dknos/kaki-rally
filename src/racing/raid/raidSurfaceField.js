// Kaki Rally Raid — deterministic global surface field.
//
// This module is the single source of truth for what the desert looks and feels
// like at any point on the planet. Everything here is a PURE function of world
// metres and the stage seed. Nothing is a function of a sector origin, a grid
// index, an iteration order, or a camera position.
//
// That purity is the whole reason a 24 km stage can be streamed without seams:
// two neighbouring sectors evaluate the shared boundary from identical inputs,
// so they produce identical outputs by construction rather than by a fix-up
// pass. The seam test in tools/smoke-raid-sector-seams.mjs is a regression
// guard on that property, not the mechanism that provides it.
//
// One world unit is one metre. The field is evaluated in float64 and only the
// stored heightfield is narrowed to float32, so the value a wheel samples and
// the texel the terrain shader samples are the same number.

const TAU = Math.PI * 2;

export function clamp(value, minimum, maximum) {
  return value < minimum ? minimum : (value > maximum ? maximum : value);
}

export function smoothstep(edge0, edge1, value) {
  const span = edge1 - edge0;
  if (!(Math.abs(span) > 1e-9)) return value < edge0 ? 0 : 1;
  const amount = clamp((value - edge0) / span, 0, 1);
  return amount * amount * (3 - 2 * amount);
}

export function mix(a, b, t) {
  return a + (b - a) * t;
}

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------

// The lattice is addressed with signed 32-bit integers. A stage that reaches
// 24 km with a shortest feature wavelength of 8 m needs |lattice| <= 3000, so
// the safety margin before wraparound is enormous; RAID_MAX_LATTICE documents
// the bound the seam test asserts against.
export const RAID_MAX_LATTICE = 0x3fffffff;

function hash2i(ix, iz, seed) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ (seed | 0);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  h = Math.imul(h ^ (h >>> 13), 0x9e3779b1);
  return (h ^ (h >>> 16)) >>> 0;
}

// Eight evenly spaced unit gradients. Gradient noise rather than value noise:
// dune flanks need a continuous first derivative or the terrain normal, and
// therefore the wheel contact normal, steps at every lattice line.
const GRADIENT_X = new Float64Array(8);
const GRADIENT_Z = new Float64Array(8);
for (let index = 0; index < 8; index += 1) {
  const angle = (index / 8) * TAU;
  GRADIENT_X[index] = Math.cos(angle);
  GRADIENT_Z[index] = Math.sin(angle);
}

function quintic(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function dotGradient(ix, iz, seed, dx, dz) {
  const slot = hash2i(ix, iz, seed) & 7;
  return GRADIENT_X[slot] * dx + GRADIENT_Z[slot] * dz;
}

// Perlin-style gradient noise in [-1, 1].
export function gradientNoise(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = quintic(fx);
  const v = quintic(fz);
  const n00 = dotGradient(ix, iz, seed, fx, fz);
  const n10 = dotGradient(ix + 1, iz, seed, fx - 1, fz);
  const n01 = dotGradient(ix, iz + 1, seed, fx, fz - 1);
  const n11 = dotGradient(ix + 1, iz + 1, seed, fx - 1, fz - 1);
  const top = mix(n00, n10, u);
  const bottom = mix(n01, n11, u);
  // Gradient noise peaks near 1/sqrt(2); normalise so callers get a full range.
  return clamp(mix(top, bottom, v) * 1.4142135623730951, -1, 1);
}

export function fbm(x, z, seed, octaves = 4, lacunarity = 2.03, gain = 0.5) {
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let weight = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += gradientNoise(x * frequency, z * frequency, (seed + octave * 0x9e3779b1) | 0) * amplitude;
    weight += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return total / Math.max(1e-9, weight);
}

// Ridged multifractal. Sharp positive crests over soft basins is exactly the
// silhouette of a rock shelf or a wind-packed ridge line.
export function ridgedNoise(x, z, seed, octaves = 4, lacunarity = 2.07, gain = 0.5) {
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let weight = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    const value = 1 - Math.abs(gradientNoise(x * frequency, z * frequency, (seed + octave * 0x85ebca6b) | 0));
    total += value * value * amplitude;
    weight += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return clamp((total / Math.max(1e-9, weight)) * 2 - 1, -1, 1);
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

// Physical identity of what the tyres are actually on. `momentum` is the share
// of recovered lateral energy that becomes forward speed when a slide is
// caught, which is what makes salt feel fast and powder feel like glue.
//
// `glow` is emissive weight, not a physical property: it is how much light the
// ground gives back rather than takes. Every natural surface is 0 and says so
// explicitly, so a renderer can read one key on every surface instead of
// branching on an id.
function surface(id, name, values) {
  return Object.freeze({ id, name, glow: 0, ...values });
}

export const RAID_SURFACES = Object.freeze({
  salt: surface('salt', 'Salt flat', {
    grip: 1.06, drag: 0.028, sinkage: 0.02, roughness: 0.05, momentum: 0.86,
    dust: 0.22, tyreWear: 0.9, punctureRisk: 0.05, colour: 0xd9dbd2,
  }),
  hardpack: surface('hardpack', 'Hardpack', {
    grip: 0.98, drag: 0.045, sinkage: 0.05, roughness: 0.16, momentum: 0.78,
    dust: 0.45, tyreWear: 1, punctureRisk: 0.1, colour: 0xc0a071,
  }),
  compacted: surface('compacted', 'Compacted sand', {
    grip: 0.9, drag: 0.075, sinkage: 0.14, roughness: 0.22, momentum: 0.66,
    dust: 0.72, tyreWear: 1.05, punctureRisk: 0.08, colour: 0xd8b47e,
  }),
  loose: surface('loose', 'Loose sand', {
    grip: 0.78, drag: 0.14, sinkage: 0.32, roughness: 0.3, momentum: 0.44,
    dust: 1, tyreWear: 1.15, punctureRisk: 0.05, colour: 0xe4c48f,
  }),
  powder: surface('powder', 'Powder basin', {
    grip: 0.62, drag: 0.27, sinkage: 0.56, roughness: 0.24, momentum: 0.2,
    dust: 1.35, tyreWear: 1.2, punctureRisk: 0.04, colour: 0xefdcb4,
  }),
  gravel: surface('gravel', 'Wadi gravel', {
    grip: 0.86, drag: 0.09, sinkage: 0.1, roughness: 0.48, momentum: 0.58,
    dust: 0.6, tyreWear: 1.35, punctureRisk: 0.34, colour: 0xa89170,
  }),
  rock: surface('rock', 'Broken rock', {
    grip: 0.94, drag: 0.11, sinkage: 0.02, roughness: 0.85, momentum: 0.5,
    dust: 0.3, tyreWear: 1.7, punctureRisk: 0.72, colour: 0x8d7f6d,
  }),
  // Talus. What a cliff or a pinnacle leaves at its own foot: angular stone
  // that has never been packed by anything, so it is the one surface that is
  // both loose AND sharp. Low grip like sand, puncture risk like rock.
  scree: surface('scree', 'Canyon scree', {
    grip: 0.72, drag: 0.135, sinkage: 0.19, roughness: 0.72, momentum: 0.38,
    dust: 0.78, tyreWear: 1.55, punctureRisk: 0.58, colour: 0x9a8b78,
  }),
  // Caliche pan. Millennia of ground water have cemented the silt around the
  // ruins into a pale, dead-flat crust — the fastest natural surface in the
  // desert after salt, and the reason a ruin field is where lap times are won.
  duricrust: surface('duricrust', 'Ruin pan', {
    grip: 1.02, drag: 0.036, sinkage: 0.03, roughness: 0.11, momentum: 0.82,
    dust: 0.3, tyreWear: 0.95, punctureRisk: 0.09, colour: 0xcbb894,
  }),
  // The rift itself. Sand fused to glass along the fracture walls: it holds a
  // tyre superbly and raises almost no dust, but it is brittle enough to bite,
  // and it is the only surface in the desert that emits rather than reflects.
  riftglass: surface('riftglass', 'Rift crust', {
    grip: 1.04, drag: 0.052, sinkage: 0.01, roughness: 0.34, momentum: 0.8,
    dust: 0.16, tyreWear: 1.45, punctureRisk: 0.44, colour: 0x7c7386, glow: 0.9,
  }),
});

export const RAID_SURFACE_ORDER = Object.freeze([
  // Append-only. The index is packed into a uint8 channel of every streamed
  // sector, so reordering this list would reinterpret terrain already in flight.
  'salt', 'hardpack', 'compacted', 'loose', 'powder', 'gravel', 'rock',
  'scree', 'duricrust', 'riftglass',
]);

const SURFACE_INDEX = Object.freeze(Object.fromEntries(
  RAID_SURFACE_ORDER.map((id, index) => [id, index]),
));

export function raidSurfaceIndex(id) {
  return SURFACE_INDEX[id] ?? SURFACE_INDEX.hardpack;
}

export function raidSurfaceByIndex(index) {
  return RAID_SURFACES[RAID_SURFACE_ORDER[clamp(index | 0, 0, RAID_SURFACE_ORDER.length - 1)]];
}

// ---------------------------------------------------------------------------
// Terrain zones
// ---------------------------------------------------------------------------

// A zone is a macro terrain identity. Zones are authored along the route in
// metres, then blended over hundreds of metres so a stage never switches
// biome at a sector boundary.
function zone(id, name, values) {
  return Object.freeze({ id, name, ...values });
}

export const RAID_ZONES = Object.freeze({
  'salt-flat': zone('salt-flat', 'Salt flat', {
    macroHeight: 1.6, macroScale: 620, ridgeHeight: 0.35, ridgeWavelength: 210,
    detailHeight: 0.16, detailScale: 26, roughness: 0.05, rockiness: 0,
    softness: 0.04, baseSurface: 'salt', crestSurface: 'salt', hollowSurface: 'hardpack',
  }),
  'hardpack-plateau': zone('hardpack-plateau', 'Hardpack plateau', {
    macroHeight: 7.5, macroScale: 480, ridgeHeight: 1.4, ridgeWavelength: 150,
    detailHeight: 0.42, detailScale: 21, roughness: 0.2, rockiness: 0.12,
    softness: 0.15, baseSurface: 'hardpack', crestSurface: 'hardpack', hollowSurface: 'compacted',
  }),
  'rolling-dunes': zone('rolling-dunes', 'Rolling dunes', {
    macroHeight: 13, macroScale: 380, ridgeHeight: 6.2, ridgeWavelength: 118,
    detailHeight: 0.66, detailScale: 17, roughness: 0.22, rockiness: 0,
    softness: 0.62, baseSurface: 'compacted', crestSurface: 'loose', hollowSurface: 'loose',
  }),
  'dune-sea': zone('dune-sea', 'Dune sea', {
    macroHeight: 21, macroScale: 460, ridgeHeight: 15.5, ridgeWavelength: 176,
    detailHeight: 0.85, detailScale: 15, roughness: 0.24, rockiness: 0,
    softness: 0.88, baseSurface: 'loose', crestSurface: 'loose', hollowSurface: 'powder',
  }),
  'wadi-gravel': zone('wadi-gravel', 'Wadi gravel', {
    macroHeight: 9.5, macroScale: 300, ridgeHeight: 3.1, ridgeWavelength: 96,
    detailHeight: 0.95, detailScale: 12, roughness: 0.52, rockiness: 0.48,
    softness: 0.12, baseSurface: 'gravel', crestSurface: 'rock', hollowSurface: 'compacted',
  }),
  'rock-shelf': zone('rock-shelf', 'Rock shelf', {
    macroHeight: 16, macroScale: 340, ridgeHeight: 8.4, ridgeWavelength: 88,
    detailHeight: 1.25, detailScale: 10, roughness: 0.8, rockiness: 0.86,
    softness: 0.05, baseSurface: 'rock', crestSurface: 'rock', hollowSurface: 'gravel',
  }),
  'powder-basin': zone('powder-basin', 'Powder basin', {
    macroHeight: 6, macroScale: 520, ridgeHeight: 1.9, ridgeWavelength: 240,
    detailHeight: 0.3, detailScale: 30, roughness: 0.1, rockiness: 0,
    softness: 1, baseSurface: 'powder', crestSurface: 'loose', hollowSurface: 'powder',
  }),

  // --- Landform zones -----------------------------------------------------
  //
  // The seven above are spectra: relief is noise summed in bands. The five
  // below are STRUCTURES — a canyon has an inside and an outside, a crater has
  // a centre, a spire has a footprint. `profile` selects which structure the
  // zone builds, and the *Share fields say what fraction of the zone's declared
  // height budget each part of that structure is allowed to spend.
  //
  // The shares matter: `macroHeight + ridgeHeight + detailHeight·(1+4.2·rockiness)`
  // is the contract the field tests bound every zone against, so a landform may
  // not invent amplitude, only divide up what the table already declares.

  // A deep incision with a flat sandy floor, an inner slot with near-vertical
  // fluted walls, a mid-height terrace, and a rim lip to launch off. Depth is
  // modulated along the canyon so it periodically shallows to a saddle: the
  // field cannot know where the route goes, so every canyon has to be crossable
  // everywhere, and the saddles are also where the descent tracks switchback in.
  'slot-canyon': zone('slot-canyon', 'Slot canyon', {
    macroHeight: 8.5, macroScale: 520, ridgeHeight: 46, ridgeWavelength: 150,
    detailHeight: 0.9, detailScale: 14, roughness: 0.6, rockiness: 0.52,
    softness: 0.3, baseSurface: 'hardpack', crestSurface: 'rock', hollowSurface: 'loose',
    profile: 'canyon', carveShare: 0.94, lipShare: 0.06,
  }),
  // The same canyon network seen from on top. It shares the locator field with
  // slot-canyon exactly, so blending between them deepens ONE canyon in place
  // rather than cross-fading two canyons in different places.
  'canyon-rim': zone('canyon-rim', 'Canyon rim', {
    macroHeight: 11, macroScale: 470, ridgeHeight: 24, ridgeWavelength: 160,
    detailHeight: 0.8, detailScale: 16, roughness: 0.45, rockiness: 0.4,
    softness: 0.22, baseSurface: 'hardpack', crestSurface: 'rock', hollowSurface: 'scree',
    profile: 'canyon', carveShare: 0.8, lipShare: 0.2,
  }),
  // Plinths of rock standing out of the sand, clustered into groves by a slow
  // density field and driveable between. The heightfield resolves the FOOTPRINT
  // — 2 m cells cannot carry a hoodoo silhouette — and the instanced scatter
  // stands the thin spires on top of it.
  'spire-forest': zone('spire-forest', 'Spire forest', {
    macroHeight: 9, macroScale: 430, ridgeHeight: 27, ridgeWavelength: 130,
    detailHeight: 0.7, detailScale: 15, roughness: 0.55, rockiness: 0.45,
    softness: 0.35, baseSurface: 'scree', crestSurface: 'rock', hollowSurface: 'loose',
    profile: 'spire', spireShare: 0.9, skirtShare: 0.1,
  }),
  // The rift. A wide crater with a raised rim, and fracture channels radiating
  // out of it across the sand. The bowl and the rim are LANDFORM — they go into
  // `macro`, so the ground inside the crater still reads as ground — while the
  // fractures are cut below it, which is what makes them, and only them,
  // classify as the glowing crust.
  'rift-crater': zone('rift-crater', 'Rift crater', {
    macroHeight: 44, macroScale: 640, ridgeHeight: 6, ridgeWavelength: 200,
    detailHeight: 0.5, detailScale: 22, roughness: 0.3, rockiness: 0.2,
    softness: 0.3, baseSurface: 'compacted', crestSurface: 'rock', hollowSurface: 'riftglass',
    profile: 'rift', broadShare: 0.3, bowlShare: 0.58, rimShare: 0.1,
  }),
  // Ground around the ruins. Broad relief is quantised into terraces with long
  // flat pads and short shallow risers, so an amphitheatre or a gateway arch has
  // level ground to stand on and the driving stays fast and legible.
  'ruin-flat': zone('ruin-flat', 'Ruin flat', {
    macroHeight: 7.5, macroScale: 560, ridgeHeight: 2, ridgeWavelength: 190,
    detailHeight: 0.28, detailScale: 24, roughness: 0.14, rockiness: 0.06,
    softness: 0.12, baseSurface: 'duricrust', crestSurface: 'hardpack', hollowSurface: 'compacted',
    profile: 'terrace', terraceStep: 3.2,
  }),
});

export const RAID_ZONE_ORDER = Object.freeze(Object.keys(RAID_ZONES));

export function getRaidZone(id) {
  return RAID_ZONES[id] || RAID_ZONES['hardpack-plateau'];
}

// Blend two zones.
//
// Scale parameters — macroScale, ridgeWavelength, detailScale — are NOT
// interpolated. They divide the world coordinate, so interpolating them shifts
// the noise sample point in proportion to distance from the origin: at 5 km a
// 1% wavelength change slides the ridge phase by tens of metres, and the whole
// landscape visibly swims as the stage crosses a zone transition. Interpolating
// amplitudes alone has the same defect through the phase warp.
//
// So a blend keeps both zones intact and mixes their evaluated HEIGHTS instead.
// That is continuous by construction because it is a linear interpolation
// between two continuous fields, and it costs a second noise evaluation only
// inside a transition band.
//
// Non-phase-bearing scalars (roughness, rockiness, softness) are safe to mix
// directly and are used by dust, wear, and sinkage rather than by geometry.
const BLENDED_SCALAR_KEYS = Object.freeze(['roughness', 'rockiness', 'softness']);

export function blendRaidZones(fromId, toId, t) {
  const from = getRaidZone(fromId);
  const to = getRaidZone(toId);
  const amount = clamp(t, 0, 1);
  const blend = { from, to, t: amount };
  for (const key of BLENDED_SCALAR_KEYS) blend[key] = mix(from[key], to[key], amount);
  // Discrete identities follow the dominant zone. The switch is invisible
  // because the mixed relief has already morphed around the midpoint.
  const dominant = amount < 0.5 ? from : to;
  blend.baseSurface = dominant.baseSurface;
  blend.crestSurface = dominant.crestSurface;
  blend.hollowSurface = dominant.hollowSurface;
  // raidRelief() divides by these, and it is legitimate to hand it a blend.
  // Without them the divisor is undefined and relief comes back NaN, which
  // classifies as neither crest nor hollow — a silent flattening rather than a
  // failure. They follow the dominant zone, exactly as the sector generator's
  // own hand-built classification parameters do.
  blend.ridgeHeight = dominant.ridgeHeight;
  blend.detailHeight = dominant.detailHeight;
  blend.id = dominant.id;
  blend.reliefBound = Math.max(zoneReliefBound(from), zoneReliefBound(to));
  return Object.freeze(blend);
}

export function zoneReliefBound(zone) {
  return zone.macroHeight + zone.ridgeHeight + zone.detailHeight * (1 + zone.rockiness * 4.2);
}

// ---------------------------------------------------------------------------
// Landforms
// ---------------------------------------------------------------------------
//
// A landform is a structure rather than a spectrum: it has an inside, an
// outside, and a centre. Everything here is still a pure function of world
// metres and the seed, and three rules keep it seam-exact:
//
//  1. Feature lattices are addressed by flooring the WORLD position. Two
//     samples either side of a sector boundary scan the same 3x3 neighbourhood
//     of cells and see the same feature points.
//  2. Nothing depends on WHICH feature is nearest. Per-feature attributes are
//     only ever read inside that feature's own influence radius, and the
//     influence radius is smaller than the 3x3 scan can miss, so there is no
//     Voronoi boundary at which an answer could jump. Overlapping features are
//     combined with a smooth union, never with min/max, so no crease forms
//     where two of them meet.
//  3. Coverage is always in 0..1 and is multiplied by an amplitude the zone
//     table already declared, so a landform can never exceed the relief bound
//     the field tests hold every zone to.

// Smooth union of two coverages in 0..1. Overlapping features deepen toward 1
// without ever passing it; a + b - ab is C-infinity where min/max would crease.
function unionCoverage(a, b) {
  return a + b - a * b;
}

// A signed jitter in -0.5..0.5 pulled out of one hash, for feature placement.
function hashUnit(hash, shift) {
  return ((hash >>> shift) & 0xffff) / 65535 - 0.5;
}

// --- Canyons ---------------------------------------------------------------

// Canyon locator. The zero set of a warped low-frequency field is a winding
// network of curves; the canyon is carved along it. Both canyon zones use these
// constants unchanged, which is what makes them the SAME canyon at different
// depths rather than two different canyons.
const CANYON_WAVELENGTH = 1200;
const CANYON_FLOOR_HALF = 34;   // half width of the flat sandy floor, metres
const CANYON_SLOT_WALL = 18;    // horizontal run of the inner near-vertical wall
const CANYON_TERRACE_OUT = 66;  // outer edge of the mid-height terrace
const CANYON_WALL_OUT = 92;     // where the upper wall meets the plateau
const CANYON_TERRACE_SHARE = 0.55; // fraction of full depth the terrace sits at
const CANYON_LIP_CENTRE = 104;  // rim lip, just outside the upper wall
const CANYON_LIP_HALF = 20;

function canyonAxis(worldX, worldZ, seed) {
  // A single coarse warp keeps the network from reading as parallel bands.
  const warp = gradientNoise(worldX / 2100, worldZ / 2100, seed ^ 0x3ac81f97);
  return fbm(
    worldX / CANYON_WAVELENGTH + warp * 0.35,
    worldZ / CANYON_WAVELENGTH - warp * 0.28,
    seed ^ 0x51ab7d3f, 2, 2.05, 0.5,
  );
}

// Approximate distance IN METRES from the canyon axis. Dividing the field value
// by its own gradient converts "how far from the zero set" out of noise units,
// so the canyon keeps a consistent width instead of ballooning wherever the
// locator happens to be flat. Forward differences are enough here and cost two
// evaluations instead of four.
function canyonDistance(worldX, worldZ, seed) {
  const centre = canyonAxis(worldX, worldZ, seed);
  const step = 8;
  const gx = (canyonAxis(worldX + step, worldZ, seed) - centre) / step;
  const gz = (canyonAxis(worldX, worldZ + step, seed) - centre) / step;
  return Math.abs(centre) / Math.max(2e-5, Math.hypot(gx, gz));
}

// Depth envelope along the canyon. The field cannot know where the route goes,
// so the canyon must be crossable everywhere: this drops it to about a third of
// full depth every few hundred metres, which is both the saddle a driver can
// cross at and the ramp a descent track would switchback down.
function canyonDepthScale(worldX, worldZ, seed) {
  const envelope = fbm(worldX / 300, worldZ / 300, seed ^ 0x2c9f61b3, 2, 2.03, 0.5);
  return 0.22 + 0.78 * smoothstep(-0.42, 0.34, envelope);
}

const CANYON_PARTS = { carve: 0, lift: 0, floor: 0 };

// Cross-section, from the axis outward: flat floor, fluted inner wall, terrace,
// upper wall, rim lip, plateau. `carve` and `lift` are both 0..1 coverages.
function canyonProfile(worldX, worldZ, seed, target = CANYON_PARTS) {
  // Fluting: shifting the wall in and out with a short-wavelength field ribs it
  // vertically, because the shift depends on where you are along the wall and
  // not on how high up it you are.
  const flute = fbm(worldX / 27, worldZ / 27, seed ^ 0x7f4a1d63, 2, 2.11, 0.5);
  const distance = canyonDistance(worldX, worldZ, seed) + flute * 4.5;
  const slot = 1 - smoothstep(CANYON_FLOOR_HALF, CANYON_FLOOR_HALF + CANYON_SLOT_WALL, distance);
  const terrace = 1 - smoothstep(CANYON_TERRACE_OUT, CANYON_WALL_OUT, distance);
  const depth = canyonDepthScale(worldX, worldZ, seed);
  // The terrace share is spent everywhere inside the terrace, the rest only
  // inside the slot, so the two together never exceed one full depth.
  target.carve = depth * (CANYON_TERRACE_SHARE * terrace + (1 - CANYON_TERRACE_SHARE) * slot);
  const lip = clamp(1 - Math.abs(distance - CANYON_LIP_CENTRE) / CANYON_LIP_HALF, 0, 1);
  // Smoothstep of a triangle: zero slope at both feet and at the crest, so the
  // lip is a launch ramp rather than a kerb.
  target.lift = lip * lip * (3 - 2 * lip);
  target.floor = slot;
  return target;
}

// --- Spires ----------------------------------------------------------------

// Plinth footprints. Cell size and jitter bound how close two plinths can be:
// 72 m cells with +-0.25 jitter keep centres at least 36 m apart, so a 15 m
// plinth never meets another plinth and only the soft debris skirts overlap.
//
// The crown-to-foot run is 8 m — four of the 2 m terrain cells. Anything
// narrower would alias into a one-cell spike that the mesh and the bilinear
// height fallback both render as garbage. The thin hoodoo silhouette in the
// reference is the scatter mesh's job; the field only owns the footprint.
const SPIRE_CELL = 72;
const SPIRE_JITTER = 0.25;
const SPIRE_CROWN = 7;    // flat crown radius
const SPIRE_FOOT = 15;    // where the plinth meets the sand
const SPIRE_SKIRT = 26;   // outer edge of the debris apron

const SPIRE_PARTS = { plinth: 0, skirt: 0 };

function spireField(worldX, worldZ, seed, target = SPIRE_PARTS) {
  const cellX = Math.floor(worldX / SPIRE_CELL);
  const cellZ = Math.floor(worldZ / SPIRE_CELL);
  let plinth = 0;
  let skirt = 0;
  for (let oz = -1; oz <= 1; oz += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      const gx = cellX + ox;
      const gz = cellZ + oz;
      const hash = hash2i(gx, gz, seed ^ 0x1d3a77b1);
      const px = (gx + 0.5 + hashUnit(hash, 0) * 2 * SPIRE_JITTER) * SPIRE_CELL;
      const pz = (gz + 0.5 + hashUnit(hash, 16) * 2 * SPIRE_JITTER) * SPIRE_CELL;
      const distance = Math.hypot(worldX - px, worldZ - pz);
      if (distance >= SPIRE_SKIRT) continue;
      // The crown is raised to a fractional power so the sides steepen and the
      // top stays broad: a plinth, not a cone.
      const core = 1 - smoothstep(SPIRE_CROWN, SPIRE_FOOT, distance);
      if (core > 0) plinth = unionCoverage(plinth, Math.pow(core, 0.55));
      skirt = unionCoverage(skirt, 1 - smoothstep(SPIRE_FOOT, SPIRE_SKIRT, distance));
    }
  }
  target.plinth = plinth;
  target.skirt = skirt;
  return target;
}

// --- Rift craters ----------------------------------------------------------

// Crater lattice. 880 m cells with +-0.3 jitter mean a feature outside the 3x3
// scan is always more than 1.2 cells away, so an influence radius under 1000 m
// is exactly represented by the nine cells actually visited.
const RIFT_CELL = 880;
const RIFT_JITTER = 0.3;
const RIFT_BOWL = 260;       // bowl radius
const RIFT_RIM = 300;        // centre of the raised rim ring
const RIFT_RIM_HALF = 68;
const RIFT_CRACK_REACH = 620; // how far the fractures run out across the sand

const RIFT_PARTS = { bowl: 0, rim: 0, crack: 0 };

function riftField(worldX, worldZ, seed, target = RIFT_PARTS) {
  const cellX = Math.floor(worldX / RIFT_CELL);
  const cellZ = Math.floor(worldZ / RIFT_CELL);
  // One shared wobble so the fractures wander instead of being drawn with a
  // ruler. It is a function of position, so it stays continuous across the
  // boundary between one crater's fracture field and the next.
  const wobble = fbm(worldX / 130, worldZ / 130, seed ^ 0x6f1e93a5, 2, 2.09, 0.5) * 0.85;
  let bowl = 0;
  let rim = 0;
  let crack = 0;
  for (let oz = -1; oz <= 1; oz += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      const gx = cellX + ox;
      const gz = cellZ + oz;
      const hash = hash2i(gx, gz, seed ^ 0x4c1b9d27);
      const px = (gx + 0.5 + hashUnit(hash, 0) * 2 * RIFT_JITTER) * RIFT_CELL;
      const pz = (gz + 0.5 + hashUnit(hash, 16) * 2 * RIFT_JITTER) * RIFT_CELL;
      const dx = worldX - px;
      const dz = worldZ - pz;
      const radius = Math.hypot(dx, dz);
      if (radius >= RIFT_CRACK_REACH) continue;

      const q = clamp(radius / RIFT_BOWL, 0, 1);
      bowl = unionCoverage(bowl, 1 - q * q * (3 - 2 * q));
      const ring = clamp(1 - Math.abs(radius - RIFT_RIM) / RIFT_RIM_HALF, 0, 1);
      rim = unionCoverage(rim, ring * ring * (3 - 2 * ring));

      // Radiating fractures. The spoke count must be an integer or the pattern
      // would tear where atan2 wraps; the phase is per-crater so no two rifts
      // share an orientation.
      const spokes = 5 + ((hash >>> 28) & 3);
      const phase = (((hash >>> 8) & 0xff) / 255) * TAU;
      const swing = Math.sin(Math.atan2(dz, dx) * spokes + phase + wobble);
      // Angular offset converted to metres, so a channel keeps its width
      // instead of fanning out with distance from the centre.
      const across = (Math.abs(swing) * radius) / spokes;
      const channel = 1 - smoothstep(3.5, 12, across);
      if (channel > 0) {
        crack = unionCoverage(crack, channel * smoothstep(RIFT_CRACK_REACH, RIFT_BOWL * 0.9, radius));
      }
    }
  }
  target.bowl = bowl;
  target.rim = rim;
  target.crack = crack;
  return target;
}

// --- Terraces --------------------------------------------------------------

// Quantise broad relief into flat pads joined by short risers. The eased
// fractional part is C1 at every step boundary, so a terrace edge is a shallow
// ramp a car drives up, not a wall it hits, and the pads themselves are dead
// level for ruins to stand on.
function terraceHeight(broad, step) {
  const scaled = broad / step;
  const tread = Math.floor(scaled);
  return (tread + smoothstep(0.35, 0.65, scaled - tread)) * step;
}

// ---------------------------------------------------------------------------
// Height
// ---------------------------------------------------------------------------

// Terrain height in metres for a single zone, split into its broad and local
// parts. `windAngle` is stage-wide so dune ridge lines stay coherent across zone
// boundaries instead of pinwheeling.
//
// `macro` is the broad relief alone — what the land would be without ridges,
// rock, or ripples. Surface classification needs it: "am I on a crest or in a
// hollow" is a question about height RELATIVE to the local landform, and
// absolute height answers it wrongly on a slope.
export function raidZoneHeightParts(worldX, worldZ, params, seed, windAngle, target = { macro: 0, height: 0 }) {
  const windX = Math.cos(windAngle);
  const windZ = Math.sin(windAngle);
  // Along-wind and cross-wind axes. Dunes are stretched perpendicular to the
  // wind, so the ridge term must be evaluated in this rotated frame.
  const along = worldX * windX + worldZ * windZ;
  const cross = worldX * -windZ + worldZ * windX;

  // Broad relief: what the stage looks like from ten kilometres away. A zone
  // that spends part of its macro budget on a landform declares `broadShare` and
  // gets the remainder here; an unset share is 1 and leaves the term untouched.
  const macro = fbm(worldX / params.macroScale, worldZ / params.macroScale, seed ^ 0x1b873593, 4, 1.97, 0.52);
  const basin = fbm(worldX / (params.macroScale * 2.4), worldZ / (params.macroScale * 2.4), seed ^ 0x6b43a9b5, 3, 2.11, 0.5);
  const broad = (macro * 0.74 + basin * 0.26) * params.macroHeight * (params.broadShare ?? 1);
  let height = broad;
  // The landform a point sits on. Relief — and therefore which surface is
  // underfoot — is measured against this, so anything that is scenery the
  // player drives ACROSS belongs here, and anything cut INTO the ground does
  // not: that distinction is what puts sand on a canyon floor and glowing crust
  // in a fracture while leaving a crater floor as ordinary ground.
  let landform = broad;
  let detailFactor = 1;
  let rockFactor = 1;

  switch (params.profile) {
    case 'canyon': {
      // Incision below, launch lip above, both out of the ridge budget.
      const canyon = canyonProfile(worldX, worldZ, seed);
      height += canyon.lift * params.ridgeHeight * (params.lipShare ?? 0)
        - canyon.carve * params.ridgeHeight * (params.carveShare ?? 1);
      // The floor is swept sand: no rock rubble, and calmer chatter.
      rockFactor = 1 - canyon.floor;
      detailFactor = 1 - canyon.floor * 0.55;
      break;
    }
    case 'spire': {
      // Groves. The density field scales plinth height rather than gating it,
      // so a grove thins out into stumps instead of ending at a line.
      const grove = smoothstep(-0.35, 0.55, fbm(worldX / 300, worldZ / 300, seed ^ 0x53a1d7f3, 2, 2.05, 0.5));
      const spires = spireField(worldX, worldZ, seed);
      height += (spires.plinth * params.ridgeHeight * (params.spireShare ?? 1)
        + spires.skirt * params.ridgeHeight * (params.skirtShare ?? 0)) * grove;
      break;
    }
    case 'rift': {
      const rift = riftField(worldX, worldZ, seed);
      // Bowl and rim are ground the player drives on, so they are landform.
      const shape = rift.rim * params.macroHeight * (params.rimShare ?? 0)
        - rift.bowl * params.macroHeight * (params.bowlShare ?? 0);
      landform += shape;
      // The fractures are cut below it. Only they read as hollow, which is what
      // confines the glowing crust to the cracks.
      height += shape - rift.crack * params.ridgeHeight;
      detailFactor = 1 - rift.crack * 0.7;
      break;
    }
    case 'terrace': {
      // Flat pads with short risers, sized out of the ridge budget.
      const terraced = terraceHeight(broad, params.terraceStep ?? 3.2);
      height = terraced;
      landform = terraced;
      break;
    }
    default: {
      // Ridge lines. A phase warp keeps them from reading as a sine grating, and
      // the asymmetric power shapes a broad windward face against a sharp lee lip,
      // which is what makes a dune crest legible at speed.
      if (params.ridgeHeight > 0.01) {
        const warp = fbm(along / (params.ridgeWavelength * 1.9), cross / (params.ridgeWavelength * 3.1), seed ^ 0x2f8a1c3d, 3, 2.02, 0.5);
        const phase = (cross / params.ridgeWavelength) * TAU * 0.5 + warp * 2.3 + Math.sin(along / (params.ridgeWavelength * 1.4)) * 0.6;
        const wave = Math.sin(phase);
        const shape = wave >= 0 ? Math.pow(wave, 1.52) : wave * 0.36;
        const envelope = 0.66 + 0.34 * (fbm(along / (params.ridgeWavelength * 3.4), cross / (params.ridgeWavelength * 4), seed ^ 0x0f1bbcdc, 2) * 0.5 + 0.5);
        height += shape * params.ridgeHeight * envelope;
      }
      break;
    }
  }

  // Rock structure. Ridged noise only where the zone is actually rocky.
  if (params.rockiness > 0.01) {
    const rock = ridgedNoise(worldX / 74, worldZ / 74, seed ^ 0x27d4eb2f, 4, 2.09, 0.52);
    height += rock * params.rockiness * params.detailHeight * 4.2 * rockFactor;
  }

  // Surface detail: ripples, chatter, and the small chop that gives the
  // suspension something to do between the big features.
  const detail = fbm(worldX / params.detailScale, worldZ / params.detailScale, seed ^ 0x165667b1, 3, 2.13, 0.48);
  height += detail * params.detailHeight * detailFactor;

  target.macro = landform;
  target.height = height;
  return target;
}

const HEIGHT_PARTS = { macro: 0, height: 0 };

/** Terrain height in metres for a single zone. */
export function raidZoneHeight(worldX, worldZ, params, seed, windAngle) {
  return raidZoneHeightParts(worldX, worldZ, params, seed, windAngle, HEIGHT_PARTS).height;
}

/**
 * How far a point stands above or below its own landform, normalised to
 * roughly -1..1. Positive is a scoured crest, negative a collecting hollow.
 * This is the input surface classification actually needs.
 */
export function raidRelief(height, macro, params) {
  const scale = Math.max(0.35, params.ridgeHeight * 0.55 + params.detailHeight * (1 + params.rockiness * 2.1));
  return clamp((height - macro) / scale, -1, 1);
}

// Terrain height in metres for a zone blend. Inside a transition band this
// mixes two intact fields; outside one it degenerates to a single evaluation.
export function raidTerrainHeight(worldX, worldZ, blend, seed, windAngle) {
  const t = blend.t;
  if (!(t > 0)) return raidZoneHeight(worldX, worldZ, blend.from, seed, windAngle);
  if (!(t < 1)) return raidZoneHeight(worldX, worldZ, blend.to, seed, windAngle);
  const from = raidZoneHeight(worldX, worldZ, blend.from, seed, windAngle);
  const to = raidZoneHeight(worldX, worldZ, blend.to, seed, windAngle);
  return mix(from, to, t);
}

// Analytic-free normal. Central differences on the same pure field, so the
// normal agrees with the height everywhere including across sector boundaries.
export function raidTerrainNormal(worldX, worldZ, blend, seed, windAngle, epsilon = 0.75, target = { x: 0, y: 1, z: 0 }) {
  const west = raidTerrainHeight(worldX - epsilon, worldZ, blend, seed, windAngle);
  const east = raidTerrainHeight(worldX + epsilon, worldZ, blend, seed, windAngle);
  const south = raidTerrainHeight(worldX, worldZ - epsilon, blend, seed, windAngle);
  const north = raidTerrainHeight(worldX, worldZ + epsilon, blend, seed, windAngle);
  const dx = (west - east) / (2 * epsilon);
  const dz = (south - north) / (2 * epsilon);
  const inverse = 1 / Math.hypot(dx, 1, dz);
  target.x = dx * inverse;
  target.y = inverse;
  target.z = dz * inverse;
  return target;
}

// ---------------------------------------------------------------------------
// Surface classification
// ---------------------------------------------------------------------------

// Which surface is actually underfoot. Crests get scoured to the zone's crest
// surface, hollows collect the zone's hollow surface, slope exposes rock, and a
// slow drift field breaks up the boundaries so the map never reads as tiles.
export function classifyRaidSurface(worldX, worldZ, params, seed, {
  height = 0,
  slope = 0,
  relief = 0,
} = {}) {
  const drift = fbm(worldX / 190, worldZ / 190, seed ^ 0x45d9f3b1, 3, 2.05, 0.5);
  const exposure = clamp(relief * 0.5 + drift * 0.32, -1, 1);

  if (params.rockiness > 0.35 && slope > 0.32 + drift * 0.08) return params.crestSurface;
  if (exposure > 0.26) return params.crestSurface;
  if (exposure < -0.3) return params.hollowSurface;
  return params.baseSurface;
}

// Continuous 0..1 looseness used by sinkage and dust. Kept separate from the
// discrete surface id so deep sand can deepen gradually inside one zone.
export function raidLooseness(worldX, worldZ, params, seed, relief = 0) {
  const drift = fbm(worldX / 145, worldZ / 145, seed ^ 0x9e3779b9, 3, 2.07, 0.5);
  const settled = clamp(params.softness + drift * 0.18 - relief * 0.22, 0, 1);
  return settled;
}
