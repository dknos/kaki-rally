/**
 * Backend-neutral Three r185 grass material.
 *
 * The Terra-STL research shader used onBeforeCompile in WebGL. Kaki Rally must
 * preserve both renderer backends, so this version expresses the same
 * stiff-base/floppy-tip wind and warm tip transmission with TSL node material.
 */
import {
  Color,
  DoubleSide,
  MeshStandardNodeMaterial,
} from 'three/webgpu';
import {
  attribute,
  color,
  float,
  positionLocal,
  sin,
  uniform,
  vec3,
} from 'three/tsl';

export function createRallyGrassMaterial({
  translucent = [0.5, 0.5, 0.16],
  windStrength = 1,
  reduceMotion = false,
} = {}) {
  const uTime = uniform(0);
  const uWindStrength = uniform(reduceMotion ? 0 : Number(windStrength) || 1);
  const tip = attribute('tip', 'float').clamp(0, 1);
  const tipWeight = tip.mul(tip);
  // positionLocal already includes the instance transform at this stage in
  // Three r185, which gives every tuft a stable world-relative phase.
  const phase = positionLocal.x.mul(0.171).add(positionLocal.z.mul(0.131));
  const gust = sin(uTime.mul(1.15).add(phase)).mul(0.11)
    .add(sin(uTime.mul(0.37).add(phase.mul(0.7))).mul(0.05))
    .mul(uWindStrength);
  const flutter = sin(uTime.mul(6.5).add(phase.mul(3.1)))
    .mul(0.018)
    .mul(tipWeight)
    .mul(tipWeight)
    .mul(uWindStrength);
  const xOffset = tipWeight.mul(gust).add(flutter);
  const zOffset = tipWeight.mul(gust).mul(0.55).add(flutter.mul(0.4));

  const material = new MeshStandardNodeMaterial({
    color: new Color(0xffffff),
    vertexColors: true,
    roughness: 0.94,
    metalness: 0,
    side: DoubleSide,
    depthWrite: true,
    depthTest: true,
    fog: true,
  });
  material.name = 'KakiRallyTerraGrassNodeMaterial';
  material.positionNode = positionLocal.add(vec3(xOffset, float(0), zOffset));
  material.emissiveNode = color(new Color(...translucent))
    .mul(tipWeight)
    .mul(0.085);
  material.userData.tslMaterialFamily = 'rally-terra-grass';
  material.userData.windModel = 'stiff-base-floppy-tip';

  Object.defineProperty(material, 'uniforms', {
    configurable: true,
    enumerable: false,
    value: Object.freeze({ uTime, uWindStrength }),
  });
  Object.defineProperty(material, 'updateGrassWind', {
    configurable: true,
    enumerable: false,
    value(timeSeconds, strength = 1) {
      uTime.value = Number.isFinite(Number(timeSeconds)) ? Number(timeSeconds) : 0;
      uWindStrength.value = reduceMotion ? 0 : Math.max(0, Number(strength) || 0);
    },
  });
  return material;
}
