import {
  Fn,
  float,
  sin,
  smoothstep,
  uv,
  vec2,
  vec4,
} from 'three/tsl';

/**
 * Reproduces the legacy radial RGB split without a composite RTT. Both inputs
 * are already stable textures, so base + bloom can be sampled directly at the
 * three channel UVs. This saves one full-resolution render target and pass.
 */
export function createChromaticAberration({
  sceneColorNode,
  bloomTextureNode = null,
  amount,
  heatHaze = float(0),
  time = float(0),
  reduceMotion,
  enabled = float(1),
}) {
  if (!sceneColorNode?.sample) {
    throw new TypeError('createChromaticAberration requires a scene color texture node.');
  }

  const coord = sceneColorNode.uvNode || uv();
  const sampleComposite = (sampleUv) => {
    const base = sceneColorNode.sample(sampleUv);
    return bloomTextureNode ? base.rgb.add(bloomTextureNode.sample(sampleUv).rgb) : base.rgb;
  };

  const effectNode = Fn(() => {
    // Dune Run reuses this already-warmed scene sampler for a very small,
    // lower-frame heat refraction. DOM HUD remains crisp, and reduced-motion
    // gates both this shimmer and the radial RGB split.
    const motionGate = float(1).sub(reduceMotion);
    const lowerMask = float(1).sub(smoothstep(0.54, 0.92, coord.y))
      .mul(smoothstep(0.01, 0.18, coord.y));
    const heatWaveX = sin(coord.y.mul(172).add(time.mul(3.1)))
      .add(sin(coord.x.mul(61).sub(time.mul(2.35))).mul(0.45));
    const heatWaveY = sin(coord.x.mul(93).add(coord.y.mul(37)).add(time.mul(1.85)));
    const heatOffset = vec2(heatWaveX, heatWaveY.mul(0.38))
      .mul(heatHaze)
      .mul(lowerMask)
      .mul(motionGate);
    const distortedCoord = coord.add(heatOffset);
    const delta = distortedCoord.sub(0.5);
    const distance = delta.length();
    const chromaticGate = motionGate.mul(enabled);
    const offset = delta.mul(amount).mul(distance).mul(2).mul(chromaticGate);

    const red = sampleComposite(distortedCoord.add(offset)).r;
    const green = sampleComposite(distortedCoord).g;
    const blue = sampleComposite(distortedCoord.sub(offset)).b;

    return vec4(red, green, blue, 1);
  })();

  return {
    node: effectNode,
    inputTextures: bloomTextureNode ? [sceneColorNode, bloomTextureNode] : [sceneColorNode],
    dispose() {},
  };
}
