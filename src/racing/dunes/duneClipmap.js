import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
} from 'three/webgpu';
import {
  createDuneDeformationTextures,
  createDuneHeightTexture,
  createDuneMaterial,
  disposeDuneDataTextures,
  updateDuneDeformationTextures,
} from './duneMaterial.js';

export const DUNE_CLIPMAP_QUALITY = Object.freeze({
  low: Object.freeze({ levels: 6, cells: 48, baseSpacing: 0.52 }),
  medium: Object.freeze({ levels: 7, cells: 64, baseSpacing: 0.4 }),
  high: Object.freeze({ levels: 7, cells: 80, baseSpacing: 0.31 }),
  ultra: Object.freeze({ levels: 8, cells: 96, baseSpacing: 0.24 }),
});

function addQuad(positions, skirts, indices, ax, az, bx, bz, cx, cz, dx, dz, skirtDepth = 0) {
  const base = positions.length / 3;
  positions.push(
    ax, 0, az,
    bx, 0, bz,
    cx, 0, cz,
    dx, 0, dz,
  );
  skirts.push(skirtDepth, skirtDepth, skirtDepth, skirtDepth);
  indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
}

function buildRingGeometry({
  cells,
  spacing,
  level,
  lastLevel,
}) {
  const halfCells = Math.floor(cells * 0.5);
  // Keep a complete underlay at every coarser level. A moving classic ring
  // needs trim variants whenever adjacent snapped centers differ; without
  // those trims its centered hole exposes the sky. The static overlapping
  // patches cost modest overdraw but make the finer level authoritative and
  // crack-free on both renderer backends.
  const innerHalf = -1;
  const positions = [];
  const skirts = [];
  const indices = [];
  for (let row = -halfCells; row < halfCells; row += 1) {
    for (let column = -halfCells; column < halfCells; column += 1) {
      const insideHole = level > 0
        && column >= -innerHalf
        && column < innerHalf
        && row >= -innerHalf
        && row < innerHalf;
      if (insideHole) continue;
      const x0 = column * spacing;
      const x1 = (column + 1) * spacing;
      const z0 = row * spacing;
      const z1 = (row + 1) * spacing;
      addQuad(positions, skirts, indices, x0, z0, x1, z0, x1, z1, x0, z1);
    }
  }
  // Only the outermost ring needs a curtain. Skirts on overlapping internal
  // rings remain visible as dark trenches and defeat the overlap/morph seam.
  const edge = halfCells * spacing;
  if (lastLevel) {
    const skirt = Math.max(2.5, spacing * 7);
    const segments = cells;
    for (let index = 0; index < segments; index += 1) {
      const a = -edge + index * spacing;
      const b = a + spacing;
      addQuad(positions, skirts, indices, a, -edge, b, -edge, b, -edge, a, -edge, 0);
      const northStart = positions.length / 3 - 4;
      skirts[northStart + 2] = skirt;
      skirts[northStart + 3] = skirt;
      addQuad(positions, skirts, indices, b, edge, a, edge, a, edge, b, edge, 0);
      const southStart = positions.length / 3 - 4;
      skirts[southStart + 2] = skirt;
      skirts[southStart + 3] = skirt;
      addQuad(positions, skirts, indices, -edge, b, -edge, a, -edge, a, -edge, b, 0);
      const westStart = positions.length / 3 - 4;
      skirts[westStart + 2] = skirt;
      skirts[westStart + 3] = skirt;
      addQuad(positions, skirts, indices, edge, a, edge, b, edge, b, edge, a, 0);
      const eastStart = positions.length / 3 - 4;
      skirts[eastStart + 2] = skirt;
      skirts[eastStart + 3] = skirt;
    }
  }
  const geometry = new BufferGeometry();
  geometry.name = `KakiDuneClipmapRing-L${level}`;
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('skirtDepth', new Float32BufferAttribute(skirts, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.staticTopology = true;
  geometry.userData.level = level;
  geometry.userData.cellSpacing = spacing;
  geometry.userData.innerHalf = innerHalf * spacing;
  geometry.userData.outerHalf = edge;
  return geometry;
}

function snap(value, spacing) {
  return Math.floor(value / spacing) * spacing;
}

export function buildDuneClipmap({
  heightfield,
  deformation,
  palette,
  quality = 'medium',
  detailTexture = null,
} = {}) {
  if (!heightfield || !deformation) {
    throw new TypeError('Dune clipmap requires height and deformation authorities');
  }
  const tier = DUNE_CLIPMAP_QUALITY[quality] || DUNE_CLIPMAP_QUALITY.medium;
  const root = new Group();
  root.name = 'KakiDuneNestedRingClipmap';
  const heightTexture = createDuneHeightTexture(heightfield);
  const deformationTextures = createDuneDeformationTextures(deformation);
  const levels = [];
  let triangleCount = 0;
  for (let level = 0; level < tier.levels; level += 1) {
    const spacing = tier.baseSpacing * (2 ** level);
    const lastLevel = level === tier.levels - 1;
    const geometry = buildRingGeometry({
      cells: tier.cells,
      spacing,
      level,
      lastLevel,
    });
    const outerRadius = tier.cells * 0.5 * spacing;
    const material = createDuneMaterial({
      heightTexture,
      deformationTextures,
      heightfield,
      deformation,
      palette,
      detailTexture,
      cellSize: spacing,
      outerRadius,
      innerRadius: level > 0 ? levels[level - 1].outerRadius : 0,
      lastLevel,
    });
    const mesh = new Mesh(geometry, material);
    mesh.name = `KakiDuneClipmapLevel-${level}`;
    mesh.receiveShadow = true;
    mesh.castShadow = level <= 2;
    mesh.frustumCulled = false;
    mesh.renderOrder = level;
    material.polygonOffset = true;
    material.polygonOffsetFactor = -(tier.levels - level);
    material.polygonOffsetUnits = -(tier.levels - level);
    mesh.userData.level = level;
    mesh.userData.overlapUnderlay = level > 0;
    mesh.userData.spacing = spacing;
    mesh.userData.outerRadius = outerRadius;
    root.add(mesh);
    triangleCount += geometry.index.count / 3;
    levels.push({
      level,
      spacing,
      outerRadius,
      mesh,
      geometry,
      material,
      centerX: NaN,
      centerZ: NaN,
    });
  }
  const clipmap = {
    root,
    quality: DUNE_CLIPMAP_QUALITY[quality] ? quality : 'medium',
    tier,
    heightfield,
    deformation,
    heightTexture,
    deformationTextures,
    detailTexture,
    levels,
    triangleCount,
    disposed: false,
    update(focusX, focusZ, time = 0, windAngle = 0.48) {
      if (clipmap.disposed) return;
      updateDuneDeformationTextures(deformationTextures, deformation);
      for (let index = 0; index < levels.length; index += 1) {
        const entry = levels[index];
        // A level morphs onto the next level's lattice, so its world origin
        // must also be snapped to that lattice. Independent per-level snaps
        // create half-cell offsets and visible cracks while the truck moves.
        const centerSpacing = entry.level < levels.length - 1
          ? entry.spacing * 2
          : entry.spacing;
        const centerX = snap(focusX, centerSpacing);
        const centerZ = snap(focusZ, centerSpacing);
        if (centerX !== entry.centerX || centerZ !== entry.centerZ) {
          entry.centerX = centerX;
          entry.centerZ = centerZ;
          entry.mesh.position.x = centerX;
          entry.mesh.position.z = centerZ;
        }
        entry.material.updateDuneMaterial({
          centerX,
          centerZ,
          recentOriginX: deformation.originX,
          recentOriginZ: deformation.originZ,
          time,
          windAngle,
          innerCenterX: index > 0 ? levels[index - 1].centerX : centerX,
          innerCenterZ: index > 0 ? levels[index - 1].centerZ : centerZ,
        });
      }
    },
    snapshot() {
      return {
        quality: clipmap.quality,
        levels: levels.length,
        cells: tier.cells,
        baseSpacing: tier.baseSpacing,
        triangles: triangleCount,
        staticTopology: levels.every((entry) => entry.geometry.userData.staticTopology),
        shaderTrimmedUnderlays: levels.slice(1).every((entry) => entry.material.alphaTest > 0),
        signedTrackContrast: levels.every((entry) => entry.material.userData.signedTrackContrast === true),
        trackColor: levels[0]?.material.userData.trackColor || '',
        snappedOrigins: levels.map((entry) => [
          entry.centerX,
          entry.centerZ,
          entry.spacing,
        ]),
        heightTexture: [heightTexture.image.width, heightTexture.image.height],
        recentDeformation: [
          deformationTextures.recentOffset.image.width,
          deformationTextures.recentOffset.image.height,
        ],
        coarseDeformation: [
          deformationTextures.coarseOffset.image.width,
          deformationTextures.coarseOffset.image.height,
        ],
      };
    },
    dispose() {
      if (clipmap.disposed) return;
      clipmap.disposed = true;
      root.parent?.remove(root);
      for (const entry of levels) {
        entry.geometry.dispose();
        entry.material.dispose();
      }
      heightTexture.dispose();
      disposeDuneDataTextures(deformationTextures);
    },
  };
  clipmap.update(0, 0, 0);
  return clipmap;
}

export function duneClipmapRenderedHeightAt(clipmap, x, z) {
  // The renderer uses these same arrays. Keeping the diagnostic on the source
  // authority makes parity testable without a GPU readback stall.
  return clipmap.heightfield.heightAt(x, z) + clipmap.deformation.heightOffsetAt(x, z);
}
