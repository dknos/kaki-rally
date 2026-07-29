import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  FloatType,
  LinearFilter,
  MeshStandardNodeMaterial,
  NearestFilter,
  RedFormat,
  RepeatWrapping,
  UnsignedByteType,
  Vector2,
} from 'three/webgpu';
import {
  abs,
  attribute,
  float,
  floor,
  max,
  mix,
  positionLocal,
  sin,
  smoothstep,
  texture as textureNode,
  transformNormalToView,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';

function configureDataTexture(texture, {
  linear = true,
  name = 'KakiDuneDataTexture',
} = {}) {
  texture.name = name;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.magFilter = linear ? LinearFilter : NearestFilter;
  texture.minFilter = linear ? LinearFilter : NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

export function createDuneHeightTexture(heightfield) {
  if (!(heightfield?.heights instanceof Float32Array)) {
    throw new TypeError('Dune height texture requires the authoritative Float32Array');
  }
  return configureDataTexture(new DataTexture(
    heightfield.heights,
    heightfield.width,
    heightfield.height,
    RedFormat,
    FloatType,
  ), {
    name: `KakiDuneHeight-${heightfield.eventId}`,
  });
}

function createFloatTexture(data, resolution, name) {
  return configureDataTexture(new DataTexture(
    data,
    resolution,
    resolution,
    RedFormat,
    FloatType,
  ), { name });
}

function createByteTexture(data, resolution, name) {
  return configureDataTexture(new DataTexture(
    data,
    resolution,
    resolution,
    RedFormat,
    UnsignedByteType,
  ), { name });
}

export function createDuneDeformationTextures(deformation) {
  const state = deformation.getTextureState();
  return {
    recentOffset: createFloatTexture(
      state.recent.offsets,
      state.recent.resolution,
      'KakiDuneRecentOffset',
    ),
    recentCompaction: createByteTexture(
      state.recent.compaction,
      state.recent.resolution,
      'KakiDuneRecentCompaction',
    ),
    coarseOffset: createFloatTexture(
      state.coarse.offsets,
      state.coarse.resolution,
      'KakiDuneCoarseOffset',
    ),
    coarseCompaction: createByteTexture(
      state.coarse.compaction,
      state.coarse.resolution,
      'KakiDuneCoarseCompaction',
    ),
    version: state.version,
    coarseVersion: state.version,
    originX: state.recent.originX,
    originZ: state.recent.originZ,
  };
}

function sampleScalar(texture, sampleUv) {
  return textureNode(texture, sampleUv).r;
}

/**
 * TSL terrain material used without backend-specific shader injection.
 * Position, reconstructed normal, packed-sand coloration and deformation all
 * sample the same DataTextures on WebGL and WebGPU.
 */
export function createDuneMaterial({
  heightTexture,
  deformationTextures,
  heightfield,
  deformation,
  palette,
  detailTexture = null,
  cellSize = 0.4,
  outerRadius = 24,
  innerRadius = 0,
  lastLevel = false,
} = {}) {
  if (!heightTexture?.isTexture || !deformationTextures?.recentOffset?.isTexture) {
    throw new TypeError('Dune material requires height and deformation textures');
  }
  if (detailTexture?.isTexture) {
    detailTexture.wrapS = RepeatWrapping;
    detailTexture.wrapT = RepeatWrapping;
  }
  const uCenter = uniform(new Vector2());
  const uWorldMin = uniform(new Vector2(heightfield.minX, heightfield.minZ));
  const uWorldSize = uniform(heightfield.worldSize);
  const uRecentOrigin = uniform(new Vector2(deformation.originX, deformation.originZ));
  const uRecentWorldSize = uniform(deformation.recentWorldSize);
  // All LODs reconstruct lighting at the same physical baseline. Sampling
  // normals at each geometry level's spacing creates visible square bands even
  // when the displaced positions themselves agree.
  const normalStep = Math.max(0.36, Math.min(0.75, heightfield.cellX * 0.5));
  const uBaseTexel = uniform(new Vector2(
    normalStep / heightfield.worldSize,
    normalStep / heightfield.worldSize,
  ));
  const uRecentTexel = uniform(normalStep / deformation.recentWorldSize);
  const uNormalStep = uniform(normalStep);
  const uCellSize = uniform(cellSize);
  const uOuterRadius = uniform(outerRadius);
  const uInnerCenter = uniform(new Vector2());
  const uInnerRadius = uniform(Math.max(0, innerRadius));
  const uTime = uniform(0);
  const uWind = uniform(new Vector2(
    Math.cos(0.48),
    Math.sin(0.48),
  ));

  const localX = positionLocal.x;
  const localZ = positionLocal.z;
  const edgeDistance = max(abs(localX), abs(localZ));
  const morphAmount = lastLevel
    ? float(0)
    : smoothstep(uOuterRadius.mul(0.73), uOuterRadius.mul(0.94), edgeDistance);
  const nextCell = uCellSize.mul(2);
  const morphX = floor(localX.div(nextCell).add(0.5)).mul(nextCell);
  const morphZ = floor(localZ.div(nextCell).add(0.5)).mul(nextCell);
  const resolvedLocalX = mix(localX, morphX, morphAmount);
  const resolvedLocalZ = mix(localZ, morphZ, morphAmount);
  const worldX = resolvedLocalX.add(uCenter.x);
  const worldZ = resolvedLocalZ.add(uCenter.y);

  const baseUv = vec2(
    worldX.sub(uWorldMin.x).div(uWorldSize),
    worldZ.sub(uWorldMin.y).div(uWorldSize),
  );
  const recentUvRaw = vec2(
    worldX.sub(uRecentOrigin.x).div(uRecentWorldSize),
    worldZ.sub(uRecentOrigin.y).div(uRecentWorldSize),
  );
  const recentUv = vec2(
    recentUvRaw.x.clamp(0, 1),
    recentUvRaw.y.clamp(0, 1),
  );
  const recentEdge = max(abs(recentUvRaw.x.sub(0.5)), abs(recentUvRaw.y.sub(0.5)));
  const recentMask = float(1).sub(smoothstep(0.465, 0.5, recentEdge));

  const sampleCombinedHeight = (heightUv, localRecentUv) => {
    const baseHeight = sampleScalar(heightTexture, heightUv);
    const coarseOffset = sampleScalar(deformationTextures.coarseOffset, heightUv);
    const nearOffset = sampleScalar(deformationTextures.recentOffset, localRecentUv);
    return baseHeight.add(mix(coarseOffset, nearOffset, recentMask));
  };
  const resolvedHeight = sampleCombinedHeight(baseUv, recentUv);
  const skirtDepth = attribute('skirtDepth', 'float');
  const displacedPosition = vec3(
    resolvedLocalX,
    resolvedHeight.sub(skirtDepth),
    resolvedLocalZ,
  );

  const baseLeftUv = vec2(baseUv.x.sub(uBaseTexel.x), baseUv.y);
  const baseRightUv = vec2(baseUv.x.add(uBaseTexel.x), baseUv.y);
  const baseBackUv = vec2(baseUv.x, baseUv.y.sub(uBaseTexel.y));
  const baseFrontUv = vec2(baseUv.x, baseUv.y.add(uBaseTexel.y));
  const recentLeftUv = vec2(recentUv.x.sub(uRecentTexel), recentUv.y);
  const recentRightUv = vec2(recentUv.x.add(uRecentTexel), recentUv.y);
  const recentBackUv = vec2(recentUv.x, recentUv.y.sub(uRecentTexel));
  const recentFrontUv = vec2(recentUv.x, recentUv.y.add(uRecentTexel));
  const leftHeight = sampleCombinedHeight(baseLeftUv, recentLeftUv);
  const rightHeight = sampleCombinedHeight(baseRightUv, recentRightUv);
  const backHeight = sampleCombinedHeight(baseBackUv, recentBackUv);
  const frontHeight = sampleCombinedHeight(baseFrontUv, recentFrontUv);
  const normalLocal = vec3(
    leftHeight.sub(rightHeight),
    uNormalStep.mul(2),
    backHeight.sub(frontHeight),
  ).normalize();

  const lightColor = uniform(new Color(palette?.sandLight ?? 0xdfa663));
  const darkColor = uniform(new Color(palette?.sandDark ?? 0x855139));
  const packedColor = uniform(new Color(palette?.packed ?? 0x9c6947));
  const accentColor = uniform(new Color(palette?.accent ?? 0x6ee7e2));
  const coarsePack = sampleScalar(deformationTextures.coarseCompaction, baseUv);
  const recentPack = sampleScalar(deformationTextures.recentCompaction, recentUv);
  const compaction = mix(coarsePack, recentPack, recentMask).clamp(0, 1);
  const macro = sin(worldX.mul(0.017).add(sin(worldZ.mul(0.013)).mul(1.7)))
    .mul(0.5)
    .add(0.5);
  const ripple = sin(
    worldX.mul(uWind.x).add(worldZ.mul(uWind.y)).mul(2.7)
      .add(sin(worldX.mul(0.11).sub(worldZ.mul(0.08))).mul(0.9)),
  ).mul(0.5).add(0.5);
  const heightTone = smoothstep(
    float(heightfield.minimum).add(2),
    float(heightfield.maximum).sub(2),
    resolvedHeight,
  );
  let sandColor = mix(darkColor, lightColor, macro.mul(0.54).add(heightTone.mul(0.32)).add(0.12));
  sandColor = mix(sandColor, packedColor, compaction.mul(0.72));
  sandColor = sandColor.mul(float(0.93).add(ripple.mul(0.1)));
  if (detailTexture?.isTexture) {
    const detailUv = vec2(worldX, worldZ).mul(0.075);
    const detail = textureNode(detailTexture, detailUv).rgb;
    sandColor = sandColor.mul(mix(vec3(0.78), detail.mul(1.12), 0.44));
  }
  const crestGlow = smoothstep(0.78, 0.96, normalLocal.y)
    .mul(smoothstep(0.68, 1, ripple))
    .mul(0.035);
  sandColor = mix(sandColor, accentColor, crestGlow);

  const material = new MeshStandardNodeMaterial({
    color: new Color(0xffffff),
    roughness: 0.88,
    metalness: 0,
    fog: true,
  });
  material.name = 'KakiDuneAuthoritativeTerrainNodeMaterial';
  material.positionNode = displacedPosition;
  material.normalNode = transformNormalToView(normalLocal);
  material.colorNode = sandColor;
  if (innerRadius > 0) {
    // Shader-trim the complete static underlay around the finer level's actual
    // snapped center. This is the moving trim that a centered ring topology
    // lacks whenever adjacent clipmap origins differ by half a coarse cell.
    const innerDistance = max(
      abs(worldX.sub(uInnerCenter.x)),
      abs(worldZ.sub(uInnerCenter.y)),
    );
    material.opacityNode = smoothstep(
      uInnerRadius.sub(uCellSize.mul(1.5)),
      uInnerRadius.sub(uCellSize.mul(0.35)),
      innerDistance,
    );
    material.alphaTest = 0.5;
  }
  material.roughnessNode = float(0.82).add(float(1).sub(compaction).mul(0.13)).clamp(0.74, 0.98);
  material.metalnessNode = float(0);
  material.userData.tslMaterialFamily = 'kaki-dune-authoritative-terrain';
  material.userData.heightAuthority = heightTexture.name;
  material.userData.deformationAuthority = deformationTextures.recentOffset.name;
  material.userData.lodMorph = !lastLevel;

  Object.defineProperty(material, 'duneUniforms', {
    configurable: true,
    enumerable: false,
    value: Object.freeze({
      uCenter,
      uWorldMin,
      uWorldSize,
      uRecentOrigin,
      uRecentWorldSize,
      uBaseTexel,
      uRecentTexel,
      uNormalStep,
      uCellSize,
      uOuterRadius,
      uInnerCenter,
      uInnerRadius,
      uTime,
      uWind,
    }),
  });
  Object.defineProperty(material, 'updateDuneMaterial', {
    configurable: true,
    enumerable: false,
    value({
      centerX = 0,
      centerZ = 0,
      recentOriginX = deformation.originX,
      recentOriginZ = deformation.originZ,
      time = 0,
      windAngle = 0.48,
      innerCenterX = centerX,
      innerCenterZ = centerZ,
    } = {}) {
      uCenter.value.set(centerX, centerZ);
      uInnerCenter.value.set(innerCenterX, innerCenterZ);
      uRecentOrigin.value.set(recentOriginX, recentOriginZ);
      uTime.value = Number(time) || 0;
      uWind.value.set(Math.cos(windAngle), Math.sin(windAngle));
    },
  });
  return material;
}

export function updateDuneDeformationTextures(textures, deformation) {
  if (!textures || !deformation?.dirty) return false;
  const state = deformation.getTextureState();
  textures.recentOffset.image.data = state.recent.offsets;
  textures.recentCompaction.image.data = state.recent.compaction;
  textures.coarseOffset.image.data = state.coarse.offsets;
  textures.coarseCompaction.image.data = state.coarse.compaction;
  textures.recentOffset.needsUpdate = true;
  textures.recentCompaction.needsUpdate = true;
  // The world state changes with every brush too, but upload it at a much
  // lower cadence; callers toggle these flags when `coarseUploadDue` is true.
  if (state.version - (textures.coarseVersion || 0) >= 18 || state.recent.originX !== textures.originX
    || state.recent.originZ !== textures.originZ) {
    textures.coarseOffset.needsUpdate = true;
    textures.coarseCompaction.needsUpdate = true;
    textures.coarseVersion = state.version;
  }
  textures.version = state.version;
  textures.originX = state.recent.originX;
  textures.originZ = state.recent.originZ;
  deformation.markUploaded();
  return true;
}

export function disposeDuneDataTextures(textures) {
  for (const texture of Object.values(textures || {})) {
    if (texture?.isTexture) texture.dispose();
  }
}
