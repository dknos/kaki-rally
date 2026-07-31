import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const WHEEL_STEER_AXIS = new THREE.Vector3(0, 1, 0);
const WHEEL_SPIN_AXIS = new THREE.Vector3(1, 0, 0);
const WHEEL_STEER_QUATERNION = new THREE.Quaternion();
const WHEEL_SPIN_QUATERNION = new THREE.Quaternion();
const TAU = Math.PI * 2;

function _registry(options = {}) {
  const owned = options.owned || {};
  return {
    geometries: options.ownedGeometries || owned.geometries || null,
    materials: options.ownedMaterials || owned.materials || null,
    textures: options.ownedTextures || owned.textures || null,
  };
}

function _ownGeometry(registry, geometry) {
  registry.geometries?.add?.(geometry);
  geometry.userData.raceOwned = true;
  return geometry;
}

function _ownMaterial(registry, material) {
  registry.materials?.add?.(material);
  material.userData.raceOwned = true;
  return material;
}

function _standard(registry, parameters) {
  return _ownMaterial(registry, new THREE.MeshStandardMaterial(parameters));
}

function _physical(registry, parameters) {
  return _ownMaterial(registry, new THREE.MeshPhysicalMaterial(parameters));
}

function _basic(registry, parameters) {
  return _ownMaterial(registry, new THREE.MeshBasicMaterial(parameters));
}

function _mesh(registry, geometry, material, name, { cast = true, receive = false } = {}) {
  const mesh = new THREE.Mesh(_ownGeometry(registry, geometry), material);
  mesh.name = name;
  mesh.userData.raceOwned = true;
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

function _cloneColor(color) {
  return color?.isColor ? color.clone() : new THREE.Color(color ?? 0xff668f);
}

function _mix(color, other, amount) {
  return _cloneColor(color).lerp(new THREE.Color(other), amount);
}

/**
 * Creates an extruded, bevelled deck in the vehicle's X/Z plane. The geometry is
 * centered at the origin and its long axis points along local +Z (vehicle forward).
 */
function _roundedDeckGeometry(width, length, height, radius = 0.25, bevel = 0.08) {
  const halfWidth = width * 0.5;
  const halfLength = length * 0.5;
  const r = Math.min(radius, halfWidth - 0.01, halfLength - 0.01);
  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth + r, -halfLength);
  shape.lineTo(halfWidth - r, -halfLength);
  shape.quadraticCurveTo(halfWidth, -halfLength, halfWidth, -halfLength + r);
  shape.lineTo(halfWidth, halfLength - r);
  shape.quadraticCurveTo(halfWidth, halfLength, halfWidth - r, halfLength);
  shape.lineTo(-halfWidth + r, halfLength);
  shape.quadraticCurveTo(-halfWidth, halfLength, -halfWidth, halfLength - r);
  shape.lineTo(-halfWidth, -halfLength + r);
  shape.quadraticCurveTo(-halfWidth, -halfLength, -halfWidth + r, -halfLength);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    curveSegments: 5,
    bevelEnabled: bevel > 0,
    bevelSegments: 2,
    bevelSize: bevel,
    bevelThickness: bevel,
    steps: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -height * 0.5, 0);
  geometry.computeVertexNormals();
  return geometry;
}

function _capsuleGeometry(radius, length, capSegments = 6, radialSegments = 12) {
  return new THREE.CapsuleGeometry(radius, Math.max(0.01, length - radius * 2), capSegments, radialSegments);
}

function _barBetween(registry, material, start, end, radius, name) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  const bar = _mesh(registry, _capsuleGeometry(radius, length), material, name);
  bar.position.copy(start).add(end).multiplyScalar(0.5);
  if (length > 0.0001) bar.quaternion.setFromUnitVectors(UP, direction.normalize());
  return bar;
}

function _damageReady(mesh) {
  const position = mesh.geometry.getAttribute('position');
  mesh.userData.baseDamagePositions = position.array.slice();
  mesh.userData.damageGeometryIsUnique = true;
  return mesh;
}

function _makeShadow(registry, radius, opacity = 0.28) {
  const material = _basic(registry, {
    color: 0x09080d,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const shadow = _mesh(
    registry,
    new THREE.CircleGeometry(radius, 32),
    material,
    'vehicle-ground-shadow',
    { cast: false },
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.035;
  shadow.renderOrder = -1;
  shadow.userData.role = 'ground-shadow';
  return shadow;
}

function _makeFlame(registry, material, position, size, index) {
  const anchor = new THREE.Group();
  anchor.name = `boost-flame-${index}`;
  anchor.position.copy(position);
  anchor.rotation.x = -Math.PI / 2;
  anchor.visible = false;
  anchor.userData.role = 'boost-flame';

  const outer = _mesh(
    registry,
    new THREE.ConeGeometry(size * 0.34, size, 10, 1, true),
    material,
    `boost-flame-outer-${index}`,
    { cast: false },
  );
  outer.position.y = -size * 0.34;
  const innerMaterial = _basic(registry, {
    color: 0xfff4b8,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    toneMapped: false,
  });
  const inner = _mesh(
    registry,
    new THREE.ConeGeometry(size * 0.16, size * 0.64, 8, 1, true),
    innerMaterial,
    `boost-flame-inner-${index}`,
    { cast: false },
  );
  inner.position.y = -size * 0.18;
  anchor.add(outer, inner);
  return anchor;
}

function _wheelKit(registry, radius, width, palette, style = 'rally', detail = 'showcase') {
  const isPack = detail === 'pack';
  const segments = style === 'monster' ? 28 : isPack ? 16 : 24;
  const tireGeometry = _ownGeometry(
    registry,
    new THREE.TorusGeometry(radius * 0.76, radius * 0.245, style === 'monster' ? 10 : isPack ? 6 : 8, segments),
  );
  const sidewallGeometry = _ownGeometry(
    registry,
    new THREE.CylinderGeometry(radius * 0.68, radius * 0.68, width * 0.88, segments, 1, true),
  );
  const rimGeometry = _ownGeometry(
    registry,
    new THREE.CylinderGeometry(radius * 0.42, radius * 0.42, width * 0.94, 16, 1, false),
  );
  const hubGeometry = _ownGeometry(registry, new THREE.CylinderGeometry(radius * 0.14, radius * 0.14, width, 12));
  const beadGeometry = _ownGeometry(
    registry,
    new THREE.TorusGeometry(radius * 0.46, radius * 0.055, 6, 20),
  );
  return {
    tireGeometry,
    sidewallGeometry,
    rimGeometry,
    hubGeometry,
    beadGeometry,
    tireMaterial: palette.tire,
    rimMaterial: palette.rim,
    beadMaterial: palette.accent,
    radius,
    width,
    style,
    detail,
  };
}

function _makeWheel(kit, side, axle, registry, name) {
  const wheel = new THREE.Group();
  wheel.name = name;
  wheel.userData.raceOwned = true;
  wheel.userData.role = 'wheel';
  wheel.userData.side = side < 0 ? 'left' : 'right';
  wheel.userData.axle = axle < 0 ? 'rear' : 'front';
  wheel.userData.radius = kit.radius;
  wheel.userData.forwardAxis = '+Z';

  const tire = new THREE.Mesh(kit.tireGeometry, kit.tireMaterial);
  tire.name = `${name}-tire`;
  tire.userData.raceOwned = true;
  tire.rotation.y = Math.PI / 2;
  tire.castShadow = true;
  const sidewall = new THREE.Mesh(kit.sidewallGeometry, kit.tireMaterial);
  sidewall.name = `${name}-sidewall`;
  sidewall.userData.raceOwned = true;
  sidewall.rotation.z = Math.PI / 2;
  sidewall.castShadow = true;
  const rim = new THREE.Mesh(kit.rimGeometry, kit.rimMaterial);
  rim.name = `${name}-rim`;
  rim.userData.raceOwned = true;
  rim.rotation.z = Math.PI / 2;
  rim.castShadow = true;
  const hub = new THREE.Mesh(kit.hubGeometry, kit.beadMaterial);
  hub.name = `${name}-hub`;
  hub.userData.raceOwned = true;
  hub.rotation.z = Math.PI / 2;
  const beadOutside = new THREE.Mesh(kit.beadGeometry, kit.beadMaterial);
  beadOutside.name = `${name}-beadlock`;
  beadOutside.userData.raceOwned = true;
  beadOutside.rotation.y = Math.PI / 2;
  beadOutside.position.x = side * kit.width * 0.48;
  if (kit.detail === 'pack') wheel.add(tire, rim);
  else wheel.add(tire, sidewall, rim, hub, beadOutside);
  return wheel;
}

function _makeWheelSet({ registry, bodyPivot, radius, width, track, rearZ, frontZ, palette, style, detail = 'showcase' }) {
  const kit = _wheelKit(registry, radius, width, palette, style, detail);
  // Order is a runtime contract: left-rear, left-front, right-rear, right-front.
  const descriptors = [
    { side: -1, axle: -1, x: -track, z: rearZ },
    { side: -1, axle: 1, x: -track, z: frontZ },
    { side: 1, axle: -1, x: track, z: rearZ },
    { side: 1, axle: 1, x: track, z: frontZ },
  ];
  return descriptors.map((descriptor) => {
    const name = `${descriptor.side < 0 ? 'left' : 'right'}-${descriptor.axle < 0 ? 'rear' : 'front'}-wheel`;
    const wheel = _makeWheel(kit, descriptor.side, descriptor.axle, registry, name);
    wheel.position.set(descriptor.x, radius, descriptor.z);
    wheel.userData.basePosition = wheel.position.clone();
    wheel.userData.steerable = descriptor.axle > 0;
    bodyPivot.add(wheel);
    return wheel;
  });
}

function _makeSpring(registry, material, radius, height, turns, name) {
  const points = [];
  const segments = Math.max(24, turns * 10);
  for (let index = 0; index <= segments; index++) {
    const t = index / segments;
    const angle = t * Math.PI * 2 * turns;
    points.push(new THREE.Vector3(
      Math.cos(angle) * radius,
      (t - 0.5) * height,
      Math.sin(angle) * radius,
    ));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const spring = _mesh(
    registry,
    new THREE.TubeGeometry(curve, segments, Math.max(0.025, radius * 0.16), 5, false),
    material,
    name,
  );
  spring.userData.role = 'suspension-spring';
  return spring;
}

function _decalMaterial(registry, decalTexture) {
  if (!decalTexture) return null;
  return _basic(registry, {
    map: decalTexture,
    color: 0xffffff,
    transparent: true,
    alphaTest: 0.03,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

function _atlasPlaneGeometry(width, height, tile) {
  const geometry = new THREE.PlaneGeometry(width, height);
  if (!Number.isFinite(tile)) return geometry;
  const column = ((Math.floor(tile) % 4) + 4) % 4;
  const row = 3 - (Math.floor(tile / 4) % 4);
  const u0 = column / 4;
  const v0 = row / 4;
  const u1 = (column + 1) / 4;
  const v1 = (row + 1) / 4;
  const uv = geometry.getAttribute('uv');
  uv.setXY(0, u0, v1);
  uv.setXY(1, u1, v1);
  uv.setXY(2, u0, v0);
  uv.setXY(3, u1, v0);
  uv.needsUpdate = true;
  return geometry;
}

function _addDecals({ registry, bodyPivot, decalTexture, decalTile, scale = 1, sideX, sideY, sideZ, hoodY, hoodZ }) {
  const material = _decalMaterial(registry, decalTexture);
  const panels = [];
  if (!material) return panels;
  for (const side of [-1, 1]) {
    const panel = _mesh(
      registry,
      _atlasPlaneGeometry(1.1 * scale, 0.72 * scale, decalTile),
      material,
      `${side < 0 ? 'left' : 'right'}-rally-decal`,
      { cast: false },
    );
    panel.position.set(side * sideX, sideY, sideZ);
    panel.rotation.y = side * Math.PI / 2;
    panel.renderOrder = 2;
    panel.userData.role = 'decal-panel';
    bodyPivot.add(panel);
    panels.push(panel);
  }
  const hood = _mesh(
    registry,
    _atlasPlaneGeometry(1.0 * scale, 0.72 * scale, Number.isFinite(decalTile) ? decalTile : undefined),
    material,
    'hood-rally-decal',
    { cast: false },
  );
  hood.position.set(0, hoodY, hoodZ);
  hood.rotation.x = -Math.PI / 2;
  hood.renderOrder = 2;
  hood.userData.role = 'decal-panel';
  bodyPivot.add(hood);
  panels.push(hood);
  return panels;
}

function _seatDriver(driver, bodyPivot, { position, scale }) {
  if (!driver) return null;
  driver.name ||= 'kaki-driver';
  driver.position.copy(position);
  driver.rotation.set(0, 0, 0);
  driver.scale.multiplyScalar(scale);
  driver.visible = true;
  driver.userData.role = 'driver';
  bodyPivot.add(driver);
  return driver;
}

function _detailedDriverShadowProxy(registry, driver, bodyPivot, monster = false) {
  if (!driver) return null;
  let triangles = 0;
  driver.traverse((object) => {
    if (!object.isMesh || !object.geometry) return;
    const geometry = object.geometry;
    triangles += (geometry.index?.count || geometry.attributes?.position?.count || 0) / 3;
  });
  // Procedural pack drivers are already cheap. Only replace the expensive GLB
  // shadow submission that otherwise re-rasterizes ~400k triangles per light.
  if (triangles < 80000) return null;
  driver.traverse((object) => {
    if (object.isMesh) object.castShadow = false;
  });
  const radius = monster ? 0.52 : 0.43;
  const bodyLength = monster ? 1.2 : 1.05;
  const material = _basic(registry, {
    color: 0x000000,
    colorWrite: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const proxy = _mesh(
    registry,
    new THREE.CapsuleGeometry(radius, bodyLength, 3, 7),
    material,
    'detailed-driver-shadow-proxy',
    { cast: true },
  );
  proxy.position.copy(driver.position);
  proxy.userData.driverOffsetY = (bodyLength + radius * 2) * 0.5;
  proxy.position.y += proxy.userData.driverOffsetY;
  proxy.userData.role = 'driver-shadow-proxy';
  proxy.userData.cameraIgnore = true;
  proxy.userData.sourceTriangles = Math.round(triangles);
  bodyPivot.add(proxy);
  return proxy;
}

function _syncDetailedDriverShadowProxy(visual, scale = 1) {
  const proxy = visual?.driverShadowProxy;
  const driver = visual?.driver;
  if (!proxy || !driver) return;
  const safeScale = Math.max(0.1, Number(scale) || 1);
  proxy.position.copy(driver.position);
  proxy.position.y += (proxy.userData.driverOffsetY || 0) * safeScale;
  proxy.scale.setScalar(safeScale);
}

function _addHeadlights(registry, bodyPivot, material, width, y, z, radius) {
  const lights = [];
  for (const side of [-1, 1]) {
    const light = _mesh(
      registry,
      new THREE.SphereGeometry(radius, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.62),
      material,
      `${side < 0 ? 'left' : 'right'}-headlight`,
      { cast: false },
    );
    light.scale.z = 0.38;
    light.position.set(side * width, y, z);
    light.rotation.x = Math.PI / 2;
    light.userData.role = 'headlight';
    bodyPivot.add(light);
    lights.push(light);
  }
  return lights;
}

function _addCatEars(registry, bodyPivot, material, x, y, z, size) {
  const ears = [];
  for (const side of [-1, 1]) {
    const ear = _mesh(
      registry,
      new THREE.ConeGeometry(size * 0.48, size, 5),
      material,
      `${side < 0 ? 'left' : 'right'}-kaki-ear`,
    );
    ear.position.set(side * x, y, z);
    ear.rotation.z = side * -0.18;
    ear.userData.role = 'kaki-ear';
    bodyPivot.add(ear);
    ears.push(ear);
  }
  return ears;
}

/**
 * Premium neo-chibi rally car. Local +Z is forward and the vehicle rests on y=0.
 */
export function buildRallyCar(options = {}) {
  const registry = _registry(options);
  const color = _cloneColor(options.color ?? 0xff668f);
  const mode = String(options.mode || 'circuit').toLowerCase();
  const variant = Math.abs(Math.floor(options.variant || 0));
  const isDrift = mode === 'drift';
  const isStock = mode === 'stock';
  const driftCarId = isDrift && ['needle', 'comet', 'monarch'].includes(options.driftCarId)
    ? options.driftCarId
    : 'comet';
  const driftSpec = isDrift
    ? ({
        needle: { width: 2.34, length: 3.22, noseWidth: 2.04, stanceY: 0.6, wheelRadius: 0.45, wheelTrack: 1.16, rearZ: -0.98, frontZ: 0.98, bumperRearZ: -1.66, bumperFrontZ: 1.76, wingWidth: 2.08, shadow: 1.66 },
        comet: { width: 2.62, length: 3.68, noseWidth: 2.28, stanceY: 0.63, wheelRadius: 0.49, wheelTrack: 1.33, rearZ: -1.12, frontZ: 1.12, bumperRearZ: -1.87, bumperFrontZ: 1.96, wingWidth: 2.3, shadow: 1.82 },
        monarch: { width: 2.86, length: 4.16, noseWidth: 2.5, stanceY: 0.7, wheelRadius: 0.55, wheelTrack: 1.46, rearZ: -1.34, frontZ: 1.34, bumperRearZ: -2.12, bumperFrontZ: 2.22, wingWidth: 2.58, shadow: 2.04 },
      }[driftCarId])
    : null;
  const isPlayer = Boolean(options.isPlayer);
  const detailTier = options.detailTier === 'pack' ? 'pack' : 'showcase';
  const isPack = detailTier === 'pack';
  const root = new THREE.Group();
  root.name = 'kaki-rally-car';
  root.userData.vehicleType = 'rally-car';
  root.userData.detailTier = detailTier;
  root.userData.forwardAxis = '+Z';
  const bodyPivot = new THREE.Group();
  bodyPivot.name = 'rally-car-body-pivot';
  bodyPivot.userData.role = 'suspension-body';
  root.add(bodyPivot);

  const warmWhite = variant % 3 === 1 ? 0xf4e4bf : 0xfff0d2;
  const accentColor = variant % 4 === 0
    ? _mix(color, 0x6df2ff, 0.34)
    : variant % 4 === 1
      ? _mix(color, 0xffca55, 0.4)
      : variant % 4 === 2
        ? _mix(color, 0xb98aff, 0.34)
        : _mix(color, 0x7de186, 0.34);
  const bodyMaterial = _physical(registry, {
    color,
    roughness: isStock ? 0.5 : 0.34,
    metalness: 0.2,
    clearcoat: 0.62,
    clearcoatRoughness: 0.2,
  });
  const creamMaterial = _physical(registry, {
    color: warmWhite,
    roughness: 0.48,
    metalness: 0.08,
    clearcoat: 0.32,
  });
  const darkMaterial = _standard(registry, { color: 0x17141d, roughness: 0.84, metalness: 0.1 });
  const tireMaterial = _standard(registry, { color: 0x121116, roughness: 0.94, metalness: 0.02 });
  const rimMaterial = _standard(registry, { color: warmWhite, roughness: 0.34, metalness: 0.62 });
  const accentMaterial = _physical(registry, {
    color: accentColor,
    emissive: _mix(accentColor, 0x2aa4c4, 0.55),
    emissiveIntensity: isPlayer ? 1.15 : 0.54,
    roughness: 0.28,
    metalness: 0.24,
    clearcoat: 0.4,
  });
  const glassMaterial = _physical(registry, {
    color: 0x28435b,
    emissive: 0x14283f,
    emissiveIntensity: 0.25,
    roughness: 0.12,
    metalness: 0.18,
    transparent: true,
    opacity: 0.9,
    transmission: 0.05,
    clearcoat: 1,
  });
  const lampMaterial = _physical(registry, {
    color: 0xfff7c2,
    emissive: 0xffd670,
    emissiveIntensity: isPlayer ? 2.3 : 1.35,
    roughness: 0.22,
    toneMapped: false,
  });

  const stanceY = isDrift ? driftSpec.stanceY : isStock ? 0.8 : 0.72;
  const chassis = _damageReady(_mesh(
    registry,
    _roundedDeckGeometry(isDrift ? driftSpec.width : 2.46, isDrift ? driftSpec.length : isStock ? 3.48 : 3.68, isStock ? 0.58 : 0.54, 0.4, 0.09),
    bodyMaterial,
    'rally-chassis',
    { receive: true },
  ));
  chassis.position.y = stanceY;
  chassis.userData.role = 'damage-shell';
  bodyPivot.add(chassis);

  const nose = _damageReady(_mesh(
    registry,
    _roundedDeckGeometry(isDrift ? driftSpec.noseWidth : 2.14, isDrift ? 1.24 : 1.18, 0.38, 0.32, 0.065),
    creamMaterial,
    'rally-nose',
  ));
  nose.position.set(0, stanceY + 0.29, isDrift ? driftSpec.frontZ + 0.14 : 1.25);
  nose.rotation.x = -0.045;
  nose.userData.role = 'damage-shell';
  bodyPivot.add(nose);

  const lowerNose = _damageReady(_mesh(
    registry,
    _roundedDeckGeometry(isDrift ? driftSpec.noseWidth + 0.02 : 2.25, 0.44, 0.26, 0.18, 0.045),
    darkMaterial,
    'front-splitter',
  ));
  lowerNose.position.set(0, stanceY - 0.05, isDrift ? driftSpec.bumperFrontZ : 1.78);
  lowerNose.userData.role = 'damage-shell';
  bodyPivot.add(lowerNose);

  if (isDrift && driftCarId === 'monarch') {
    const scoop = _mesh(
      registry,
      _roundedDeckGeometry(0.82, 0.72, 0.16, 0.12, 0.03),
      darkMaterial,
      'monarch-hood-scoop',
    );
    scoop.position.set(0, stanceY + 0.49, 0.82);
    scoop.rotation.x = -0.08;
    bodyPivot.add(scoop);
    for (const side of [-1, 1]) {
      const skirt = _mesh(
        registry,
        _roundedDeckGeometry(0.12, 2.44, 0.16, 0.04, 0.02),
        accentMaterial,
        `${side < 0 ? 'left' : 'right'}-monarch-side-skirt`,
      );
      skirt.position.set(side * (driftSpec.width * 0.47), stanceY - 0.06, -0.02);
      bodyPivot.add(skirt);
    }
  } else if (isDrift && driftCarId === 'needle') {
    const canard = _mesh(
      registry,
      _roundedDeckGeometry(2.18, 0.18, 0.1, 0.04, 0.015),
      accentMaterial,
      'needle-front-canard',
    );
    canard.position.set(0, stanceY + 0.06, driftSpec.bumperFrontZ + 0.04);
    bodyPivot.add(canard);
  }

  const cockpit = _mesh(
    registry,
    new THREE.SphereGeometry(0.82, isPack ? 12 : 20, isPack ? 8 : 12, 0, Math.PI * 2, 0, Math.PI * 0.67),
    glassMaterial,
    'bubble-cockpit',
  );
  cockpit.scale.set(
    isStock ? 0.98 : isDrift && driftCarId === 'needle' ? 0.92 : isDrift && driftCarId === 'monarch' ? 1.14 : 1.08,
    isStock ? 0.8 : isDrift && driftCarId === 'monarch' ? 0.78 : 0.72,
    isStock ? 1.05 : isDrift && driftCarId === 'needle' ? 1.05 : 1.17,
  );
  cockpit.position.set(0, stanceY + 0.45, isDrift ? (driftCarId === 'monarch' ? -0.28 : -0.2) : -0.23);
  cockpit.rotation.x = -0.06;
  cockpit.userData.role = 'cockpit-canopy';
  bodyPivot.add(cockpit);

  if (!isPack) {
    const cockpitRim = _mesh(
      registry,
      new THREE.TorusGeometry(0.72, 0.075, 7, 24, Math.PI),
      creamMaterial,
      'cockpit-rim',
    );
    cockpitRim.scale.z = 1.25;
    cockpitRim.rotation.x = Math.PI / 2;
    cockpitRim.position.set(0, stanceY + 0.45, isDrift ? (driftCarId === 'monarch' ? -0.42 : -0.33) : -0.36);
    cockpitRim.userData.role = 'cockpit-canopy';
    bodyPivot.add(cockpitRim);
  }

  if (!isPack) {
    const rearDeck = _mesh(
      registry,
      _roundedDeckGeometry(1.95, 0.7, 0.28, 0.2, 0.05),
      creamMaterial,
      'rear-engine-cowl',
    );
      rearDeck.position.set(0, stanceY + 0.33, isDrift ? driftSpec.rearZ - 0.22 : -1.38);
    bodyPivot.add(rearDeck);
  }

  const wheelRadius = isDrift ? driftSpec.wheelRadius : isStock ? 0.54 : 0.49;
  const wheelTrack = isDrift ? driftSpec.wheelTrack : isStock ? 1.27 : 1.25;
  const wheels = _makeWheelSet({
    registry,
    bodyPivot,
    radius: wheelRadius,
    width: isStock ? 0.47 : isDrift && driftCarId === 'monarch' ? 0.5 : isDrift ? 0.43 : 0.4,
    track: wheelTrack,
    rearZ: isDrift ? driftSpec.rearZ : -1.12,
    frontZ: isDrift ? driftSpec.frontZ : 1.12,
    palette: { tire: tireMaterial, rim: rimMaterial, accent: accentMaterial },
    style: isStock ? 'stock' : 'rally',
    detail: detailTier,
  });

  if (!isPack) {
    const fenderGeometry = _ownGeometry(registry, new THREE.TorusGeometry(wheelRadius * 0.83, 0.1, 7, 18, Math.PI));
    for (const wheel of wheels) {
      const fender = new THREE.Mesh(fenderGeometry, bodyMaterial);
      fender.name = `${wheel.userData.side}-${wheel.userData.axle}-fender`;
      fender.userData.raceOwned = true;
      fender.rotation.y = Math.PI / 2;
      fender.position.copy(wheel.position);
      fender.position.x -= (wheel.userData.side === 'left' ? -1 : 1) * 0.05;
      fender.position.y += wheelRadius * 0.05;
      fender.castShadow = true;
      bodyPivot.add(fender);
    }
  }

  const rearBumperY = stanceY - 0.02;
  const bumper = _damageReady(_mesh(
    registry,
    _capsuleGeometry(0.13, isDrift ? driftSpec.width + 0.16 : isStock ? 2.88 : 2.66, 5, 10),
    isStock ? rimMaterial : darkMaterial,
    'rear-bumper',
  ));
  bumper.rotation.z = Math.PI / 2;
  bumper.position.set(0, rearBumperY, isDrift ? driftSpec.bumperRearZ : -1.87);
  bumper.userData.role = 'damage-bumper';
  bodyPivot.add(bumper);

  if (!isPack) {
    const frontGuard = _mesh(
      registry,
      _capsuleGeometry(0.105, isDrift ? driftSpec.width - 0.16 : 2.38, 5, 10),
      isStock ? rimMaterial : darkMaterial,
      'front-bumper',
    );
    frontGuard.rotation.z = Math.PI / 2;
    frontGuard.position.set(0, stanceY - 0.02, isDrift ? driftSpec.bumperFrontZ : 1.96);
    bodyPivot.add(frontGuard);
  }

  if (isDrift) {
    const wing = _mesh(
      registry,
      _roundedDeckGeometry(driftSpec.wingWidth, 0.34, 0.12, 0.1, 0.025),
      accentMaterial,
      'drift-ducktail-wing',
    );
    wing.position.set(0, stanceY + (driftCarId === 'monarch' ? 0.86 : 0.77), driftSpec.rearZ - 0.48);
    wing.rotation.x = 0.1;
    bodyPivot.add(wing);
    for (const side of [-1, 1]) {
      const mount = _barBetween(
        registry,
        darkMaterial,
        new THREE.Vector3(side * (driftSpec.wingWidth * 0.287), stanceY + 0.38, driftSpec.rearZ - 0.34),
        new THREE.Vector3(side * (driftSpec.wingWidth * 0.287), stanceY + (driftCarId === 'monarch' ? 0.8 : 0.72), driftSpec.rearZ - 0.45),
        0.045,
        `${side < 0 ? 'left' : 'right'}-wing-mount`,
      );
      bodyPivot.add(mount);
    }
  } else if (isStock && !isPack) {
    const cagePoints = [
      [new THREE.Vector3(-0.78, stanceY + 0.43, -0.86), new THREE.Vector3(-0.65, stanceY + 1.26, -0.3)],
      [new THREE.Vector3(0.78, stanceY + 0.43, -0.86), new THREE.Vector3(0.65, stanceY + 1.26, -0.3)],
      [new THREE.Vector3(-0.65, stanceY + 1.26, -0.3), new THREE.Vector3(0.65, stanceY + 1.26, -0.3)],
    ];
    cagePoints.forEach(([start, end], index) => bodyPivot.add(_barBetween(
      registry,
      rimMaterial,
      start,
      end,
      0.065,
      `stock-roll-cage-${index}`,
    )));
  } else {
    for (const side of [-1, 1]) {
      const fin = _mesh(
        registry,
        _roundedDeckGeometry(0.12, 0.7, 0.28, 0.05, 0.02),
        accentMaterial,
        `${side < 0 ? 'left' : 'right'}-aero-fin`,
      );
      fin.position.set(side * (isDrift ? driftSpec.width * 0.34 : 0.86), stanceY + 0.42, isDrift ? driftSpec.rearZ - 0.18 : -1.43);
      bodyPivot.add(fin);
    }
  }

  _addCatEars(registry, bodyPivot, bodyMaterial, isDrift && driftCarId === 'monarch' ? 0.6 : 0.52, stanceY + 1.24, isDrift ? -0.25 : -0.23, isDrift && driftCarId === 'needle' ? 0.46 : 0.54);
  const headlights = isPack
    ? []
    : _addHeadlights(registry, bodyPivot, lampMaterial, isDrift ? driftSpec.noseWidth * 0.29 : 0.67, stanceY + 0.29, isDrift ? driftSpec.bumperFrontZ - 0.1 : 1.79, 0.17);

  if (!isPack) {
    const grille = _mesh(
      registry,
      new THREE.TorusGeometry(0.31, 0.045, 6, 18, Math.PI),
      darkMaterial,
      'kaki-smile-grille',
      { cast: false },
    );
    grille.rotation.x = Math.PI / 2;
    grille.rotation.z = Math.PI;
    grille.scale.x = 1.45;
    grille.position.set(0, stanceY + 0.04, isDrift ? driftSpec.bumperFrontZ + 0.02 : 1.94);
    bodyPivot.add(grille);
  }

  const flames = isPack
    ? []
    : [-0.55, 0.55].map((x, index) => {
        const flame = _makeFlame(registry, accentMaterial, new THREE.Vector3(x, stanceY - 0.05, isDrift ? driftSpec.bumperRearZ - 0.18 : -2.05), 1.1, index);
        bodyPivot.add(flame);
        return flame;
      });

  const decalPanels = _addDecals({
    registry,
    bodyPivot,
    decalTexture: options.decalTexture,
    decalTile: options.decalTile,
    scale: 0.76,
    sideX: isDrift ? driftSpec.wheelTrack + 0.01 : isStock ? 1.246 : 1.205,
    sideY: stanceY + 0.15,
    sideZ: 0.05,
    hoodY: stanceY + 0.505,
    hoodZ: 1.24,
  });

  const seatedDriver = _seatDriver(options.driver, bodyPivot, {
    position: new THREE.Vector3(0, stanceY + 0.2, -0.2),
    scale: isPlayer ? 0.52 : 0.48,
  });
  const driverShadowProxy = options.optimizeDriverShadow === false
    ? null
    : _detailedDriverShadowProxy(registry, seatedDriver, bodyPivot, false);
  const shadow = _makeShadow(registry, isDrift ? driftSpec.shadow : 1.72, isPlayer ? 0.3 : 0.26);
  shadow.scale.set(isDrift ? 1.08 : 1, 1.32, 1);
  root.add(shadow);
  if (isPack) {
    // The pack already owns a soft contact-shadow card. Re-rasterizing every
    // tiny rival wheel, badge, and decal into the sun map roughly doubles the
    // field's submissions while adding no legible shadow detail at race range.
    bodyPivot.traverse((object) => {
      if (object.isMesh) object.castShadow = false;
    });
  }

  const damageMeshes = [chassis, nose, lowerNose, bumper];
  const animationAnchors = { bodyPivot, wheels, flames, headlights, decalPanels };
  return {
    root,
    bodyPivot,
    wheels,
    flames,
    driver: seatedDriver,
    driverShadowProxy,
    shadow,
    chassis,
    nose,
    bumper,
    damageMeshes,
    damageStamp: '',
    bumperBaseY: rearBumperY,
    wheelRadius,
    driftCarId: isDrift ? driftCarId : null,
    monster: false,
    headlights,
    decalPanels,
    animationAnchors,
  };
}

/**
 * Original Kaki Rally Raid fleet. These are separate silhouettes rather than
 * monster-truck reskins: the Skimmer is an open cage, Atlas is a compact
 * enclosed prototype, and Colossus is a long-wheelbase cab-over truck.
 */
export function buildRallyRaidVehicle(options = {}) {
  const registry = _registry(options);
  const id = ['buggy', 'prototype', 'truck'].includes(options.rallyRaidVehicleId)
    ? options.rallyRaidVehicleId
    : 'prototype';
  const spec = {
    buggy: {
      width: 1.92, length: 3.28, chassisHeight: 0.34, stanceY: 0.58,
      wheelRadius: 0.49, wheelWidth: 0.36, wheelTrack: 0.86, rearZ: -1.1, frontZ: 1.1,
      shadow: 1.46, windshield: 0.72, roof: 1.52,
    },
    prototype: {
      width: 2.28, length: 3.82, chassisHeight: 0.46, stanceY: 0.68,
      wheelRadius: 0.58, wheelWidth: 0.43, wheelTrack: 0.95, rearZ: -1.29, frontZ: 1.29,
      shadow: 1.72, windshield: 0.88, roof: 1.94,
    },
    truck: {
      width: 2.92, length: 5.42, chassisHeight: 0.7, stanceY: 1.02,
      wheelRadius: 0.82, wheelWidth: 0.56, wheelTrack: 1.04, rearZ: -2.08, frontZ: 2.08,
      shadow: 2.36, windshield: 1.12, roof: 2.72,
    },
  }[id];
  const color = _cloneColor(options.color ?? (id === 'buggy' ? 0xff7b5f : id === 'truck' ? 0x9b586a : 0x4b9f9c));
  const accentColor = _cloneColor(options.accent ?? (id === 'buggy' ? 0xffd45c : id === 'truck' ? 0x75e3d3 : 0xffcf5b));
  const isPlayer = Boolean(options.isPlayer);
  const root = new THREE.Group();
  root.name = `kaki-rally-raid-${id}`;
  root.userData.vehicleType = 'rally-raid';
  root.userData.rallyRaidVehicleId = id;
  root.userData.forwardAxis = '+Z';
  const bodyPivot = new THREE.Group();
  bodyPivot.name = 'rally-raid-body-pivot';
  bodyPivot.userData.role = 'suspension-body';
  root.add(bodyPivot);

  const bodyMaterial = _physical(registry, {
    color,
    roughness: id === 'truck' ? 0.45 : 0.32,
    metalness: id === 'buggy' ? 0.16 : 0.26,
    clearcoat: 0.58,
    clearcoatRoughness: 0.23,
  });
  const warmMaterial = _physical(registry, {
    color: id === 'truck' ? 0xd7c39d : 0xffe1a3,
    roughness: 0.48,
    metalness: 0.1,
    clearcoat: 0.3,
  });
  const darkMaterial = _standard(registry, { color: 0x14141b, roughness: 0.88, metalness: 0.1 });
  const metalMaterial = _standard(registry, { color: 0xb8c7cb, roughness: 0.29, metalness: 0.8 });
  const tireMaterial = _standard(registry, { color: 0x101015, roughness: 0.97, metalness: 0.02 });
  const rimMaterial = _standard(registry, { color: 0x3f5660, roughness: 0.3, metalness: 0.72 });
  const accentMaterial = _physical(registry, {
    color: accentColor,
    emissive: _mix(accentColor, 0x2c9f9d, 0.48),
    emissiveIntensity: isPlayer ? 1.18 : 0.58,
    roughness: 0.25,
    metalness: 0.28,
    clearcoat: 0.44,
  });
  const glassMaterial = _physical(registry, {
    color: id === 'truck' ? 0x203744 : 0x213f50,
    emissive: 0x12283a,
    emissiveIntensity: 0.24,
    roughness: 0.1,
    metalness: 0.18,
    transparent: true,
    opacity: 0.91,
    transmission: 0.05,
    clearcoat: 1,
  });
  const lampMaterial = _physical(registry, {
    color: 0xfff3bd,
    emissive: 0xffc85e,
    emissiveIntensity: isPlayer ? 2.4 : 1.4,
    roughness: 0.2,
    toneMapped: false,
  });

  const chassis = _damageReady(_mesh(
    registry,
    _roundedDeckGeometry(spec.width, spec.length, spec.chassisHeight, id === 'truck' ? 0.48 : 0.34, 0.075),
    bodyMaterial,
    'raid-chassis',
    { receive: true },
  ));
  chassis.position.y = spec.stanceY;
  chassis.userData.role = 'damage-shell';
  bodyPivot.add(chassis);

  const nose = _damageReady(_mesh(
    registry,
    _roundedDeckGeometry(id === 'truck' ? 2.62 : spec.width * 0.84, id === 'truck' ? 1.46 : 1.08, id === 'truck' ? 0.58 : 0.34, 0.28, 0.06),
    warmMaterial,
    'raid-nose',
  ));
  nose.position.set(0, spec.stanceY + (id === 'truck' ? 0.36 : 0.28), id === 'truck' ? 1.56 : 1.18);
  nose.rotation.x = -0.055;
  nose.userData.role = 'damage-shell';
  bodyPivot.add(nose);

  const cockpit = _mesh(
    registry,
    new THREE.SphereGeometry(id === 'truck' ? 1.08 : 0.78, 18, 11, 0, Math.PI * 2, 0, Math.PI * 0.68),
    glassMaterial,
    'raid-cockpit',
  );
  cockpit.scale.set(id === 'truck' ? 1.18 : 1.04, id === 'truck' ? 0.86 : 0.72, id === 'truck' ? 1.04 : 1.22);
  cockpit.position.set(0, spec.stanceY + (id === 'truck' ? 0.78 : 0.47), id === 'truck' ? -0.42 : -0.28);
  cockpit.rotation.x = -0.06;
  cockpit.userData.role = 'cockpit-canopy';
  bodyPivot.add(cockpit);

  const wheels = _makeWheelSet({
    registry,
    bodyPivot,
    radius: spec.wheelRadius,
    width: spec.wheelWidth,
    track: spec.wheelTrack,
    rearZ: spec.rearZ,
    frontZ: spec.frontZ,
    palette: { tire: tireMaterial, rim: rimMaterial, accent: accentMaterial },
    style: id === 'truck' ? 'monster' : 'rally',
    detail: 'showcase',
  });

  const suspension = [];
  for (const wheel of wheels) {
    const spring = _makeSpring(
      registry,
      accentMaterial,
      id === 'truck' ? 0.16 : 0.11,
      id === 'truck' ? 1.1 : 0.76,
      id === 'truck' ? 5 : 4,
      `${wheel.userData.side}-${wheel.userData.axle}-raid-spring`,
    );
    spring.position.set(wheel.position.x * 0.72, spec.stanceY - 0.12, wheel.position.z * 0.9);
    spring.rotation.z = wheel.userData.side === 'left' ? -0.18 : 0.18;
    spring.userData.side = wheel.userData.side;
    spring.userData.axle = wheel.userData.axle;
    spring.userData.basePosition = spring.position.clone();
    spring.userData.baseScale = spring.scale.clone();
    bodyPivot.add(spring);
    suspension.push(spring);
    const lower = new THREE.Vector3(wheel.position.x * 0.9, spec.stanceY - 0.3, wheel.position.z);
    const upper = new THREE.Vector3(wheel.position.x * 0.62, spec.stanceY + 0.32, wheel.position.z * 0.86);
    bodyPivot.add(_barBetween(registry, metalMaterial, lower, upper, id === 'truck' ? 0.085 : 0.055, `${wheel.name}-raid-control-arm`));
  }

  const cage = [];
  if (id === 'buggy') {
    const cagePoints = [
      [new THREE.Vector3(-0.74, spec.stanceY + 0.18, -0.78), new THREE.Vector3(-0.56, spec.stanceY + 1.28, -0.25)],
      [new THREE.Vector3(0.74, spec.stanceY + 0.18, -0.78), new THREE.Vector3(0.56, spec.stanceY + 1.28, -0.25)],
      [new THREE.Vector3(-0.56, spec.stanceY + 1.28, -0.25), new THREE.Vector3(0.56, spec.stanceY + 1.28, -0.25)],
      [new THREE.Vector3(-0.56, spec.stanceY + 1.28, -0.25), new THREE.Vector3(-0.62, spec.stanceY + 0.72, 0.8)],
      [new THREE.Vector3(0.56, spec.stanceY + 1.28, -0.25), new THREE.Vector3(0.62, spec.stanceY + 0.72, 0.8)],
    ];
    cagePoints.forEach(([start, end], index) => {
      const bar = _barBetween(registry, accentMaterial, start, end, 0.052, `skimmer-cage-${index}`);
      cage.push(bar);
      bodyPivot.add(bar);
    });
  } else if (id === 'prototype') {
    const roofRail = _mesh(registry, _roundedDeckGeometry(1.64, 0.24, 0.11, 0.04, 0.018), accentMaterial, 'atlas-roof-rail');
    roofRail.position.set(0, spec.stanceY + 1.23, -0.34);
    bodyPivot.add(roofRail);
    for (const side of [-1, 1]) {
      const post = _barBetween(
        registry,
        accentMaterial,
        new THREE.Vector3(side * 0.68, spec.stanceY + 0.38, -0.58),
        new THREE.Vector3(side * 0.72, spec.stanceY + 1.22, -0.36),
        0.05,
        `${side < 0 ? 'left' : 'right'}-atlas-a-post`,
      );
      bodyPivot.add(post);
    }
  } else {
    const roof = _mesh(registry, _roundedDeckGeometry(2.34, 1.28, 0.18, 0.16, 0.035), accentMaterial, 'colossus-service-roof');
    roof.position.set(0, spec.stanceY + 1.55, -0.45);
    bodyPivot.add(roof);
    const spareKit = _wheelKit(registry, spec.wheelRadius * 0.78, spec.wheelWidth * 0.86, { tire: tireMaterial, rim: rimMaterial, accent: accentMaterial }, 'monster', 'showcase');
    const spare = _makeWheel(spareKit, 1, -1, registry, 'colossus-spare-wheel');
    spare.position.set(0, spec.stanceY + 0.78, -2.48);
    spare.rotation.y = Math.PI / 2;
    bodyPivot.add(spare);
    const stack = _mesh(registry, new THREE.CylinderGeometry(0.13, 0.18, 1.0, 10, 1, true), metalMaterial, 'colossus-exhaust-stack');
    stack.position.set(1.12, spec.stanceY + 1.42, -1.5);
    stack.rotation.z = -0.08;
    bodyPivot.add(stack);
  }

  const headlights = _addHeadlights(
    registry,
    bodyPivot,
    lampMaterial,
    id === 'truck' ? 0.86 : 0.58,
    spec.stanceY + (id === 'truck' ? 0.45 : 0.28),
    id === 'truck' ? 2.34 : 1.72,
    id === 'truck' ? 0.21 : 0.15,
  );
  const roofLights = [];
  if (id !== 'buggy') {
    for (const x of (id === 'truck' ? [-0.72, 0, 0.72] : [-0.42, 0.42])) {
      const light = _mesh(registry, new THREE.SphereGeometry(0.11, 10, 7), lampMaterial, 'raid-roof-lamp', { cast: false });
      light.position.set(x, spec.stanceY + (id === 'truck' ? 1.7 : 1.35), -0.42);
      bodyPivot.add(light);
      roofLights.push(light);
    }
  }
  const flames = id === 'truck' ? [] : [-0.38, 0.38].map((x, index) => {
    const flame = _makeFlame(registry, accentMaterial, new THREE.Vector3(x, spec.stanceY - 0.1, id === 'buggy' ? -1.7 : -2.0), id === 'buggy' ? 0.66 : 0.84, index);
    bodyPivot.add(flame);
    return flame;
  });
  const decalPanels = _addDecals({
    registry,
    bodyPivot,
    decalTexture: options.decalTexture,
    decalTile: options.decalTile,
    scale: id === 'truck' ? 1.0 : 0.76,
    sideX: id === 'truck' ? 1.48 : id === 'prototype' ? 1.12 : 0.96,
    sideY: spec.stanceY + (id === 'truck' ? 0.4 : 0.14),
    sideZ: id === 'truck' ? -0.22 : 0.04,
    hoodY: spec.stanceY + (id === 'truck' ? 0.7 : 0.46),
    hoodZ: id === 'truck' ? 1.55 : 1.22,
  });
  const seatedDriver = _seatDriver(options.driver, bodyPivot, {
    position: new THREE.Vector3(0, spec.stanceY + (id === 'truck' ? 0.75 : 0.25), -0.28),
    scale: id === 'truck' ? 0.62 : 0.5,
  });
  const driverShadowProxy = options.optimizeDriverShadow === false
    ? null
    : _detailedDriverShadowProxy(registry, seatedDriver, bodyPivot, id === 'truck');
  bodyPivot.traverse((object) => {
    if (object.isMesh) object.castShadow = false;
  });
  const shadow = _makeShadow(registry, spec.shadow, isPlayer ? 0.31 : 0.26);
  shadow.scale.set(1.05, 1.34, 1);
  root.add(shadow);

  return {
    root,
    bodyPivot,
    wheels,
    flames,
    driver: seatedDriver,
    driverShadowProxy,
    shadow,
    chassis,
    nose,
    bumper: null,
    damageMeshes: [chassis, nose],
    damageStamp: '',
    bumperBaseY: spec.stanceY - 0.2,
    wheelRadius: spec.wheelRadius,
    monster: false,
    raidVehicleId: id,
    suspension,
    cage,
    headlights: [...headlights, ...roofLights],
    decalPanels,
    animationAnchors: { bodyPivot, wheels, flames, headlights: [...headlights, ...roofLights], decalPanels },
  };
}

/**
 * Procedural monster truck used by Monster Smash and the Trials monster class.
 */
export function buildMonsterTruckVisual(options = {}) {
  const registry = _registry(options);
  const color = _cloneColor(options.color ?? 0xff5d8f);
  const root = new THREE.Group();
  root.name = 'kaki-monster-truck';
  root.userData.vehicleType = 'monster-truck';
  root.userData.forwardAxis = '+Z';
  const bodyPivot = new THREE.Group();
  bodyPivot.name = 'monster-truck-body-pivot';
  bodyPivot.userData.role = 'suspension-body';
  root.add(bodyPivot);

  const bodyMaterial = _physical(registry, {
    color,
    roughness: 0.34,
    metalness: 0.28,
    clearcoat: 0.65,
    clearcoatRoughness: 0.22,
  });
  const creamMaterial = _physical(registry, {
    color: 0xffdc77,
    roughness: 0.46,
    metalness: 0.12,
    clearcoat: 0.38,
  });
  const darkMaterial = _standard(registry, { color: 0x121117, roughness: 0.9, metalness: 0.08 });
  const metalMaterial = _standard(registry, { color: 0xbec9d0, roughness: 0.28, metalness: 0.82 });
  const springMaterial = _physical(registry, {
    color: 0xff5bad,
    emissive: 0x8f244f,
    emissiveIntensity: 0.32,
    roughness: 0.36,
    metalness: 0.58,
    clearcoat: 0.32,
  });
  const tireMaterial = _standard(registry, { color: 0x0e0d12, roughness: 0.98 });
  const rimMaterial = _standard(registry, { color: 0x45404f, roughness: 0.32, metalness: 0.72 });
  const glowMaterial = _physical(registry, {
    color: 0x72f3ff,
    emissive: 0x2ed7ff,
    emissiveIntensity: 2.15,
    roughness: 0.22,
    toneMapped: false,
  });
  const glassMaterial = _physical(registry, {
    color: 0x263849,
    emissive: 0x102239,
    emissiveIntensity: 0.22,
    roughness: 0.1,
    metalness: 0.2,
    clearcoat: 1,
    transparent: true,
    opacity: 0.92,
  });

  const chassis = _damageReady(_mesh(
    registry,
    _roundedDeckGeometry(3.35, 4.72, 0.76, 0.52, 0.12),
    bodyMaterial,
    'monster-chassis',
    { receive: true },
  ));
  chassis.position.y = 1.58;
  chassis.userData.role = 'damage-shell';
  bodyPivot.add(chassis);

  const nose = _damageReady(_mesh(
    registry,
    _roundedDeckGeometry(3.02, 1.48, 0.61, 0.42, 0.095),
    creamMaterial,
    'monster-hood',
  ));
  nose.position.set(0, 1.96, 1.72);
  nose.rotation.x = -0.055;
  nose.userData.role = 'damage-shell';
  bodyPivot.add(nose);

  const cab = _mesh(
    registry,
    new THREE.SphereGeometry(1.08, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.68),
    glassMaterial,
    'monster-bubble-cab',
  );
  cab.scale.set(1.12, 0.9, 1.18);
  cab.position.set(0, 1.94, -0.22);
  cab.rotation.x = -0.04;
  cab.userData.role = 'cockpit-canopy';
  bodyPivot.add(cab);

  const bed = _mesh(
    registry,
    _roundedDeckGeometry(2.72, 1.2, 0.45, 0.32, 0.07),
    darkMaterial,
    'monster-rear-bed',
  );
  bed.position.set(0, 1.9, -1.76);
  bodyPivot.add(bed);

  const wheelRadius = 1.05;
  const wheels = _makeWheelSet({
    registry,
    bodyPivot,
    radius: wheelRadius,
    width: 0.7,
    track: 1.78,
    rearZ: -1.62,
    frontZ: 1.62,
    palette: { tire: tireMaterial, rim: rimMaterial, accent: springMaterial },
    style: 'monster',
    detail: 'pack',
  });

  const suspension = [];
  for (const wheel of wheels) {
    const spring = _makeSpring(
      registry,
      springMaterial,
      0.14,
      0.95,
      5,
      `${wheel.userData.side}-${wheel.userData.axle}-spring`,
    );
    spring.position.set(
      wheel.position.x * 0.77,
      1.13,
      wheel.position.z * 0.9,
    );
    spring.rotation.z = wheel.userData.side === 'left' ? -0.2 : 0.2;
    spring.userData.side = wheel.userData.side;
    spring.userData.axle = wheel.userData.axle;
    spring.userData.basePosition = spring.position.clone();
    spring.userData.baseScale = spring.scale.clone();
    bodyPivot.add(spring);
    suspension.push(spring);

    const lower = new THREE.Vector3(wheel.position.x * 0.9, 0.88, wheel.position.z);
    const upper = new THREE.Vector3(wheel.position.x * 0.63, 1.54, wheel.position.z * 0.85);
    const arm = _barBetween(registry, metalMaterial, lower, upper, 0.075, `${wheel.name}-control-arm`);
    arm.userData.role = 'suspension-arm';
    bodyPivot.add(arm);
  }

  const bumperBaseY = 1.14;
  const bumper = _damageReady(_mesh(
    registry,
    _capsuleGeometry(0.17, 3.8, 6, 12),
    metalMaterial,
    'monster-rear-bumper',
  ));
  bumper.rotation.z = Math.PI / 2;
  bumper.position.set(0, bumperBaseY, -2.5);
  bumper.userData.role = 'damage-bumper';
  bodyPivot.add(bumper);

  const frontGuard = _barBetween(
    registry,
    metalMaterial,
    new THREE.Vector3(-1.74, 1.14, 2.48),
    new THREE.Vector3(1.74, 1.14, 2.48),
    0.17,
    'monster-front-bumper',
  );
  bodyPivot.add(frontGuard);
  for (const side of [-1, 1]) {
    bodyPivot.add(_barBetween(
      registry,
      metalMaterial,
      new THREE.Vector3(side * 1.42, 1.18, 2.35),
      new THREE.Vector3(side * 1.06, 1.88, 1.65),
      0.09,
      `${side < 0 ? 'left' : 'right'}-brush-guard`,
    ));
  }

  _addCatEars(registry, bodyPivot, bodyMaterial, 0.69, 3.15, -0.3, 0.78);
  const headlights = _addHeadlights(registry, bodyPivot, glowMaterial, 0.88, 1.93, 2.41, 0.24);
  for (const x of [-0.86, -0.29, 0.29, 0.86]) {
    const tooth = _mesh(registry, new THREE.ConeGeometry(0.13, 0.45, 5), creamMaterial, 'monster-grille-tooth');
    tooth.rotation.x = Math.PI / 2;
    tooth.position.set(x, 1.43, 2.48);
    bodyPivot.add(tooth);
  }

  const exhausts = [];
  for (const side of [-1, 1]) {
    const stack = _mesh(
      registry,
      new THREE.CylinderGeometry(0.12, 0.17, 1.28, 10, 1, true),
      metalMaterial,
      `${side < 0 ? 'left' : 'right'}-exhaust-stack`,
    );
    stack.position.set(side * 1.28, 2.54, -1.32);
    stack.rotation.z = side * -0.08;
    stack.userData.role = 'exhaust';
    bodyPivot.add(stack);
    exhausts.push(stack);
  }

  const flames = [-0.84, 0.84].map((x, index) => {
    const flame = _makeFlame(registry, glowMaterial, new THREE.Vector3(x, 1.22, -2.93), 1.55, index);
    bodyPivot.add(flame);
    return flame;
  });
  const decalPanels = _addDecals({
    registry,
    bodyPivot,
    decalTexture: options.decalTexture,
    decalTile: options.decalTile,
    scale: 1.25,
    sideX: 1.692,
    sideY: 1.78,
    sideZ: 0.18,
    hoodY: 2.285,
    hoodZ: 1.72,
  });
  const seatedDriver = _seatDriver(options.driver, bodyPivot, {
    position: new THREE.Vector3(0, 1.72, -0.18),
    scale: 0.62,
  });
  const driverShadowProxy = _detailedDriverShadowProxy(registry, seatedDriver, bodyPivot, true);
  // Monster already owns a cheap contact-shadow oval. Keeping every wheel,
  // spring, tooth, driver part, and exhaust as an additional directional-light
  // caster nearly doubles exterior draw calls; authored body meshes opt back
  // into casting when their small GLB attaches.
  bodyPivot.traverse((object) => {
    if (object.isMesh) object.castShadow = false;
  });
  const shadow = _makeShadow(registry, 2.65, 0.32);
  shadow.scale.set(1.06, 1.42, 1);
  root.add(shadow);

  const damageMeshes = [chassis, nose, bumper];
  const animationAnchors = {
    bodyPivot, wheels, flames, suspension, exhausts, headlights, decalPanels,
  };
  return {
    root,
    bodyPivot,
    wheels,
    flames,
    driver: seatedDriver,
    driverShadowProxy,
    shadow,
    chassis,
    nose,
    bumper,
    damageMeshes,
    damageStamp: '',
    bumperBaseY,
    wheelRadius,
    monster: true,
    suspension,
    exhausts,
    headlights,
    decalPanels,
    animationAnchors,
  };
}

function _styleAuthoredMonsterMaterial(material, vehicleId) {
  if (!material?.color) return;
  const name = material.name || '';
  if (vehicleId === 'cyber') {
    if (name === 'BODY') {
      material.color.setHex(0x526b7d);
      material.metalness = 0.72;
      material.roughness = 0.3;
    } else if (name === 'GLASS') {
      material.color.setHex(0x123848);
      material.metalness = 0.12;
      material.roughness = 0.14;
    } else if (name === 'BAMPERS' || name === 'Kaki_Underbody') {
      material.color.setHex(0x111827);
      material.metalness = 0.58;
      material.roughness = 0.42;
    } else if (name === 'Kaki_Stainless') {
      material.color.setHex(0x71899a);
      material.metalness = 0.8;
      material.roughness = 0.26;
    } else if (name === 'LIGHT' || name === 'Kaki_Cyan_Light') {
      material.color.setHex(0x59e9ff);
      material.emissive?.setHex(0x0e8096);
      material.emissiveIntensity = 1.15;
    } else if (name === 'BACK LIGHT' || name === 'Kaki_Pink_Light') {
      material.color.setHex(0xff3979);
      material.emissive?.setHex(0x8f103e);
      material.emissiveIntensity = 1.1;
    }
  } else {
    if (name === 'Meowster Candy Magenta') {
      material.color.setHex(0xc02c82);
      material.metalness = 0.24;
      material.roughness = 0.37;
    } else if (name === 'Meowster Warm Cream') {
      material.color.setHex(0xf1b979);
      material.metalness = 0.06;
      material.roughness = 0.5;
    } else if (name === 'Meowster Deep Violet') {
      material.color.setHex(0x401762);
      material.metalness = 0.18;
      material.roughness = 0.42;
    } else if (name === 'Meowster Chassis') {
      material.color.setHex(0x171423);
      material.metalness = 0.66;
      material.roughness = 0.38;
    } else if (name === 'Meowster Cyan Glass') {
      material.color.setHex(0x123f52);
      material.metalness = 0.08;
      material.roughness = 0.16;
    } else if (name === 'Meowster Cyan Light') {
      material.emissive?.setHex(0x087f94);
      material.emissiveIntensity = 1.1;
    } else if (name === 'Meowster Rose Light') {
      material.emissive?.setHex(0x8f103f);
      material.emissiveIntensity = 1.05;
    }
  }
  material.needsUpdate = true;
}

/**
 * Mighty Meowster keeps the proven running gear and swaps only its authored
 * body. This preserves tire/suspension truth while removing the last hero
 * vehicle that read as a collection of runtime primitives.
 */
export function buildMightyMeowsterVisual(options = {}) {
  const visual = buildMonsterTruckVisual({ ...options, color: options.color ?? 0xc76dff });
  visual.root.name = 'mighty-meowster-monster-truck';
  visual.root.userData.vehicleType = 'mighty-meowster-monster-truck';
  visual.root.userData.vehicleId = 'meowster';
  visual.vehicleId = 'meowster';

  if (visual.driver) {
    visual.driver.scale.multiplyScalar(1.12);
    visual.driver.position.y += 0.42;
    visual.driver.position.z -= 0.1;
    visual.driver.userData.heroPresentation = 'roof-popout';
  }
  _syncDetailedDriverShadowProxy(visual, 1.12);

  const retained = new Set([
    ...visual.wheels,
    ...visual.flames,
    ...visual.suspension,
    ...visual.exhausts,
    ...visual.decalPanels,
    visual.driver,
    visual.driverShadowProxy,
  ].filter(Boolean));
  for (const child of visual.bodyPivot.children) {
    if (child.userData?.role === 'suspension-arm') retained.add(child);
  }
  visual.fallbackBodyNodes = visual.bodyPivot.children.filter((child) => !retained.has(child));
  visual.meowsterModelMount = new THREE.Group();
  visual.meowsterModelMount.name = 'mighty-meowster-authored-body-mount';
  visual.meowsterModelMount.userData.role = 'authored-body-mount';
  visual.bodyPivot.add(visual.meowsterModelMount);
  visual.modelAttached = false;
  return visual;
}

/** Attach the repository-authored Mighty Meowster GLB with mutable damage shells. */
export function attachMightyMeowsterModel(visual, gltf, owned = {}) {
  if (!visual?.meowsterModelMount || !gltf?.scene || visual.modelAttached) return false;
  const scene = gltf.scene.clone(true);
  scene.name = 'mighty-meowster-authored-body';
  const damageMeshes = [];
  let rearBumper = null;
  let primaryShell = null;

  scene.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry = object.geometry.clone();
    object.geometry.userData.raceOwned = true;
    owned.geometries?.add?.(object.geometry);
    if (Array.isArray(object.material)) {
      object.material = object.material.map((material) => {
        const copy = material.clone();
        _styleAuthoredMonsterMaterial(copy, 'meowster');
        copy.userData.raceOwned = true;
        owned.materials?.add?.(copy);
        return copy;
      });
    } else if (object.material) {
      object.material = object.material.clone();
      _styleAuthoredMonsterMaterial(object.material, 'meowster');
      object.material.userData.raceOwned = true;
      owned.materials?.add?.(object.material);
    }
    object.castShadow = true;
    object.receiveShadow = true;
    const deformable = object.name === 'MeowsterBody_DamageShell'
      || object.name === 'HoodDamageShell'
      || object.name.startsWith('DamagePanel_')
      || object.name === 'RearBashBar';
    if (deformable) {
      _damageReady(object);
      object.userData.role = object.name === 'RearBashBar' ? 'damage-bumper' : 'damage-shell';
      damageMeshes.push(object);
    }
    if (object.name === 'MeowsterBody_DamageShell') primaryShell = object;
    if (object.name === 'RearBashBar') rearBumper = object;
  });

  visual.meowsterModelMount.add(scene);
  for (const node of visual.fallbackBodyNodes || []) node.visible = false;
  visual.damageMeshes = damageMeshes.length ? damageMeshes : visual.damageMeshes;
  visual.chassis = primaryShell || visual.chassis;
  if (rearBumper) {
    visual.bumper = rearBumper;
    visual.bumperBaseY = rearBumper.position.y;
  }
  visual.animationAnchors.meowsterBody = scene;
  visual.modelAttached = true;
  visual.damageStamp = '';
  return true;
}

/**
 * Cyber Kaki uses the proven monster-truck running gear as a resilient
 * fallback, then swaps its body shell for the authored GLB when the rally
 * asset lease finishes loading.  Keeping the wheels/suspension procedural
 * makes both the loading state and a failed model request fully playable.
 */
export function buildCyberTruckVisual(options = {}) {
  const visual = buildMonsterTruckVisual({ ...options, color: options.color ?? 0x87929a });
  visual.root.name = 'cyber-kaki-monster-truck';
  visual.root.userData.vehicleType = 'cyber-monster-truck';
  visual.root.userData.vehicleId = 'cyber';
  visual.vehicleId = 'cyber';

  if (visual.driver) {
    visual.driver.scale.multiplyScalar(1.24);
    visual.driver.position.y += 0.38;
    visual.driver.position.z -= 0.08;
    visual.driver.userData.heroPresentation = 'roof-popout';
  }
  _syncDetailedDriverShadowProxy(visual, 1.24);

  const retained = new Set([
    ...visual.wheels,
    ...visual.flames,
    ...visual.suspension,
    ...visual.exhausts,
    ...visual.decalPanels,
    visual.driver,
    visual.driverShadowProxy,
  ].filter(Boolean));
  for (const child of visual.bodyPivot.children) {
    if (child.userData?.role === 'suspension-arm') retained.add(child);
  }
  visual.fallbackBodyNodes = visual.bodyPivot.children.filter((child) => !retained.has(child));
  visual.cyberModelMount = new THREE.Group();
  visual.cyberModelMount.name = 'cyber-kaki-authored-body-mount';
  visual.cyberModelMount.userData.role = 'authored-body-mount';
  visual.bodyPivot.add(visual.cyberModelMount);
  visual.modelAttached = false;
  return visual;
}

/** Attach an asset-leased Cyber Kaki GLB with unique, deformable mesh data. */
export function attachCyberTruckModel(visual, gltf, owned = {}) {
  if (!visual?.cyberModelMount || !gltf?.scene || visual.modelAttached) return false;
  const scene = gltf.scene.clone(true);
  scene.name = 'cyber-kaki-authored-body';
  const damageMeshes = [];
  let rearBumper = null;
  let primaryShell = null;

  scene.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry = object.geometry.clone();
    object.geometry.userData.raceOwned = true;
    owned.geometries?.add?.(object.geometry);
    if (Array.isArray(object.material)) {
      object.material = object.material.map((material) => {
        const copy = material.clone();
        _styleAuthoredMonsterMaterial(copy, 'cyber');
        copy.userData.raceOwned = true;
        owned.materials?.add?.(copy);
        return copy;
      });
    } else if (object.material) {
      object.material = object.material.clone();
      _styleAuthoredMonsterMaterial(object.material, 'cyber');
      object.material.userData.raceOwned = true;
      owned.materials?.add?.(object.material);
    }
    object.castShadow = true;
    object.receiveShadow = true;
    const deformable = object.name === 'CyberBody_DamageShell'
      || object.name.startsWith('DamagePanel_')
      || object.name === 'CyberRearBashBar';
    if (deformable) {
      _damageReady(object);
      object.userData.role = object.name === 'CyberRearBashBar' ? 'damage-bumper' : 'damage-shell';
      damageMeshes.push(object);
    }
    if (object.name === 'CyberBody_DamageShell') primaryShell = object;
    if (object.name === 'CyberRearBashBar') rearBumper = object;
  });

  visual.cyberModelMount.add(scene);
  for (const node of visual.fallbackBodyNodes || []) node.visible = false;
  visual.damageMeshes = damageMeshes.length ? damageMeshes : visual.damageMeshes;
  visual.chassis = primaryShell || visual.chassis;
  if (rearBumper) {
    visual.bumper = rearBumper;
    visual.bumperBaseY = rearBumper.position.y;
  }
  visual.animationAnchors.cyberBody = scene;
  visual.modelAttached = true;
  visual.damageStamp = '';
  return true;
}

/** Animated third Monster Smash truck with a complete imported running gear. */
export function buildTipsyTumblerVisual(options = {}) {
  const visual = buildMonsterTruckVisual({ ...options, color: options.color ?? 0xf19a4b });
  visual.root.name = 'tipsy-tumbler-monster-truck';
  visual.root.userData.vehicleType = 'tipsy-tumbler-monster-truck';
  visual.root.userData.vehicleId = 'tipsy';
  visual.vehicleId = 'tipsy';

  if (visual.driver) {
    visual.driver.scale.multiplyScalar(1.18);
    // Set Kaki into the roof opening instead of hovering above the hood. Game
    // forward is +Z, so the negative Z offset moves her back toward the cab.
    visual.driver.position.set(0, 2.48, -0.46);
    visual.driver.userData.heroPresentation = 'roof-popout';
  }
  _syncDetailedDriverShadowProxy(visual, 1.18);

  visual.fallbackBodyNodes = visual.bodyPivot.children.filter(
    (child) => child !== visual.driver && child !== visual.driverShadowProxy,
  );
  visual.tipsyModelMount = new THREE.Group();
  visual.tipsyModelMount.name = 'tipsy-tumbler-animated-model-mount';
  visual.tipsyModelMount.userData.role = 'animated-vehicle-mount';
  visual.bodyPivot.add(visual.tipsyModelMount);
  visual.modelAttached = false;
  visual.animationMixer = null;
  visual.animationActions = [];
  return visual;
}

/** Fit and play the optimized CC BY animated donor while retaining Kaki physics. */
export function attachTipsyTumblerModel(visual, gltf) {
  if (!visual?.tipsyModelMount || !gltf?.scene || visual.modelAttached) return false;
  const scene = gltf.scene.clone(true);
  scene.name = 'tipsy-tumbler-animated-model';
  scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(scene);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  if (!(size.y > 0.01) || !Number.isFinite(size.y)) return false;
  // Tipsy was a touch undersized beside the arena targets. This remains a
  // visual fit only; the tuned monster-truck contact rig stays authoritative.
  const scale = 4.48 / size.y;
  scene.scale.setScalar(scale);
  scene.position.set(-center.x * scale, -bounds.min.y * scale + 0.04, -center.z * scale);
  const materials = new Set();
  const texturedMaterials = new Set();
  scene.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    object.frustumCulled = true;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material) continue;
      materials.add(material);
      if (material.map) texturedMaterials.add(material);
    }
  });
  // The Sketchfab donor's nose points along +X. Rotate it onto the game's +Z
  // forward axis; the opposite quarter-turn made the truck drive backward.
  visual.tipsyModelMount.rotation.y = -Math.PI / 2;
  visual.tipsyModelMount.add(scene);
  for (const node of visual.fallbackBodyNodes || []) node.visible = false;

  visual.damageMeshes = [];
  visual.animationMixer = new THREE.AnimationMixer(scene);
  visual.animationClock = 0;
  visual.animationDriveSynced = true;
  visual.animationActions = (gltf.animations || []).map((sourceClip) => {
    // The donor clip begins at 6.7 seconds and was previously advanced on a
    // wall clock. That made its visible tires move while parked, pause before
    // their first keys, and ignore vehicle speed. Shift the authored wheel
    // tracks to zero, but discard baked world travel and body rotation: those
    // tracks make the shell slide beneath our separately seated Kaki driver.
    const clipStart = sourceClip.tracks.reduce((start, track) => (
      Math.min(start, Number(track.times?.[0]) || 0)
    ), Infinity);
    const tracks = sourceClip.tracks
      .filter((track) => /^Object_(6|11|17|22)\.quaternion$/.test(track.name))
      .map((track) => track.clone().shift(-clipStart));
    const clip = new THREE.AnimationClip(`${sourceClip.name}-road-synced`, -1, tracks);
    clip.resetDuration();
    const action = visual.animationMixer.clipAction(clip);
    action.play();
    return action;
  });
  const positionTrack = gltf.animations?.[0]?.tracks?.find((track) => track.name.endsWith('.position'));
  if (positionTrack && positionTrack.values.length >= 6) {
    const values = positionTrack.values;
    const last = values.length - 3;
    const donorDistance = Math.hypot(
      values[last] - values[0],
      values[last + 1] - values[1],
      values[last + 2] - values[2],
    ) * scale;
    visual.animationMetersPerSecond = Math.max(0.5, donorDistance / Math.max(0.1, visual.animationActions[0]?.getClip().duration || 1));
  } else {
    visual.animationMetersPerSecond = 3;
  }
  visual.animationMixer.update(0);
  visual.animationAnchors.tipsyBody = scene;
  visual.modelMaterialStats = { materials: materials.size, textured: texturedMaterials.size };
  visual.modelAttached = true;
  visual.damageStamp = '';
  return true;
}

/** Advance imported running gear by road speed; zero speed means zero motion. */
export function updateVehicleAnimation(visual, signedSpeed, dt) {
  if (!visual?.animationMixer) return;
  if (!visual.animationDriveSynced) {
    visual.animationMixer.update(dt * (0.72 + Math.min(0.45, Math.abs(signedSpeed) / 30)));
    return;
  }
  const duration = visual.animationActions?.[0]?.getClip?.().duration || 0;
  if (!(duration > 0)) return;
  const rate = 1 / Math.max(0.5, visual.animationMetersPerSecond || 3);
  visual.animationClock = ((visual.animationClock || 0) + signedSpeed * dt * rate) % duration;
  if (visual.animationClock < 0) visual.animationClock += duration;
  for (const action of visual.animationActions) action.time = visual.animationClock;
  visual.animationMixer.update(0);
}

/**
 * Compose steering yaw and rolling spin without mixing them through Euler
 * angles. The wheel's local axle therefore follows steering only; a complete
 * tire revolution cannot introduce camber/toe wobble.
 */
export function updateVehicleWheelPresentation(wheel, {
  spinDelta = 0,
  targetSteer = 0,
  dt = 0,
  steeringResponse = 16,
} = {}) {
  if (!wheel?.quaternion) return null;
  const data = wheel.userData || (wheel.userData = {});
  if (!data.presentationBaseQuaternion?.isQuaternion) {
    data.presentationBaseQuaternion = wheel.quaternion.clone();
    data.presentationSpin = 0;
    data.presentationSteer = 0;
  }
  data.presentationSpin = ((Number(data.presentationSpin) || 0) + (Number(spinDelta) || 0)) % TAU;
  const steerAlpha = 1 - Math.exp(
    -Math.max(0, Number(steeringResponse) || 0) * Math.max(0, Number(dt) || 0),
  );
  data.presentationSteer += (
    (Number(targetSteer) || 0) - (Number(data.presentationSteer) || 0)
  ) * steerAlpha;
  WHEEL_STEER_QUATERNION.setFromAxisAngle(WHEEL_STEER_AXIS, data.presentationSteer);
  WHEEL_SPIN_QUATERNION.setFromAxisAngle(WHEEL_SPIN_AXIS, data.presentationSpin);
  wheel.quaternion
    .copy(data.presentationBaseQuaternion)
    .multiply(WHEEL_STEER_QUATERNION)
    .multiply(WHEEL_SPIN_QUATERNION);
  return {
    spin: data.presentationSpin,
    steer: data.presentationSteer,
  };
}

/**
 * Lightweight open-cage buggy for the side-on Trials presentation.
 */
export function buildTrialsBuggy(options = {}) {
  const registry = _registry(options);
  const color = _cloneColor(options.color ?? 0x58d8ff);
  const root = new THREE.Group();
  root.name = 'kaki-trials-buggy';
  root.userData.vehicleType = 'trials-buggy';
  root.userData.forwardAxis = '+Z';
  const bodyPivot = new THREE.Group();
  bodyPivot.name = 'trials-buggy-body-pivot';
  bodyPivot.userData.role = 'suspension-body';
  root.add(bodyPivot);

  const bodyMaterial = _physical(registry, {
    color,
    roughness: 0.36,
    metalness: 0.2,
    clearcoat: 0.56,
    clearcoatRoughness: 0.23,
  });
  const creamMaterial = _standard(registry, { color: 0xffefd0, roughness: 0.54, metalness: 0.1 });
  const cageMaterial = _standard(registry, { color: 0x20202b, roughness: 0.43, metalness: 0.68 });
  const tireMaterial = _standard(registry, { color: 0x121117, roughness: 0.96 });
  const rimMaterial = _standard(registry, { color: 0xe8dbc3, roughness: 0.38, metalness: 0.62 });
  const glowMaterial = _physical(registry, {
    color: 0x75f5ff,
    emissive: 0x2ad8ff,
    emissiveIntensity: 2.1,
    roughness: 0.2,
    toneMapped: false,
  });

  const chassis = _mesh(
    registry,
    _roundedDeckGeometry(2.22, 3.32, 0.48, 0.36, 0.075),
    bodyMaterial,
    'buggy-belly-pan',
    { receive: true },
  );
  chassis.position.y = 0.74;
  bodyPivot.add(chassis);
  const hood = _mesh(
    registry,
    _roundedDeckGeometry(1.92, 1.17, 0.34, 0.3, 0.06),
    creamMaterial,
    'buggy-hood',
  );
  hood.position.set(0, 1.0, 1.16);
  hood.rotation.x = -0.06;
  bodyPivot.add(hood);
  const seat = _mesh(
    registry,
    _roundedDeckGeometry(1.38, 1.1, 0.48, 0.24, 0.05),
    cageMaterial,
    'buggy-bucket-seat',
  );
  seat.position.set(0, 1.08, -0.3);
  bodyPivot.add(seat);

  const cageBars = [
    [new THREE.Vector3(-0.69, 0.86, -0.82), new THREE.Vector3(-0.58, 1.74, -0.38)],
    [new THREE.Vector3(0.69, 0.86, -0.82), new THREE.Vector3(0.58, 1.74, -0.38)],
    [new THREE.Vector3(-0.58, 1.74, -0.38), new THREE.Vector3(0.58, 1.74, -0.38)],
    [new THREE.Vector3(-0.58, 1.74, -0.38), new THREE.Vector3(-0.68, 0.96, 0.52)],
    [new THREE.Vector3(0.58, 1.74, -0.38), new THREE.Vector3(0.68, 0.96, 0.52)],
  ];
  const cage = cageBars.map(([start, end], index) => {
    const bar = _barBetween(registry, cageMaterial, start, end, 0.055, `buggy-roll-cage-${index}`);
    bodyPivot.add(bar);
    return bar;
  });

  const wheelRadius = 0.56;
  const wheels = _makeWheelSet({
    registry,
    bodyPivot,
    radius: wheelRadius,
    width: 0.42,
    track: 1.18,
    rearZ: -1.08,
    frontZ: 1.08,
    palette: { tire: tireMaterial, rim: rimMaterial, accent: glowMaterial },
    style: 'buggy',
  });

  const bumper = _mesh(
    registry,
    _capsuleGeometry(0.11, 2.42, 5, 10),
    cageMaterial,
    'buggy-rear-bumper',
  );
  bumper.rotation.z = Math.PI / 2;
  bumper.position.set(0, 0.64, -1.82);
  bodyPivot.add(bumper);
  for (const side of [-1, 1]) {
    bodyPivot.add(_barBetween(
      registry,
      cageMaterial,
      new THREE.Vector3(side * 0.72, 0.74, 1.55),
      new THREE.Vector3(side * 1.02, 0.56, 1.82),
      0.065,
      `${side < 0 ? 'left' : 'right'}-front-nerf-bar`,
    ));
  }

  _addCatEars(registry, bodyPivot, bodyMaterial, 0.5, 1.48, 0.16, 0.56);
  const headlights = _addHeadlights(registry, bodyPivot, glowMaterial, 0.58, 1.02, 1.69, 0.14);
  const flames = [-0.53, 0.53].map((x, index) => {
    const flame = _makeFlame(registry, glowMaterial, new THREE.Vector3(x, 0.65, -2.02), 1.03, index);
    bodyPivot.add(flame);
    return flame;
  });
  const decalPanels = _addDecals({
    registry,
    bodyPivot,
    decalTexture: options.decalTexture,
    decalTile: options.decalTile,
    scale: 0.68,
    sideX: 1.09,
    sideY: 0.84,
    sideZ: 0.08,
    hoodY: 1.22,
    hoodZ: 1.16,
  });
  const seatedDriver = _seatDriver(options.driver, bodyPivot, {
    position: new THREE.Vector3(0, 0.96, -0.16),
    scale: options.isPlayer === false ? 0.47 : 0.5,
  });
  const driverShadowProxy = _detailedDriverShadowProxy(registry, seatedDriver, bodyPivot, false);
  const shadow = _makeShadow(registry, 1.82, 0.26);
  shadow.scale.set(1, 1.28, 1);
  root.add(shadow);

  const animationAnchors = { bodyPivot, wheels, flames, cage, headlights, decalPanels };
  return {
    root,
    bodyPivot,
    wheels,
    flames,
    driver: seatedDriver,
    driverShadowProxy,
    shadow,
    wheelRadius,
    monster: false,
    cage,
    headlights,
    decalPanels,
    animationAnchors,
  };
}

/**
 * Minimal translucent presentation shell for Trials personal-best playback.
 */
export function buildGhostVehicle(options = {}) {
  const registry = _registry(options);
  const root = new THREE.Group();
  root.name = 'kaki-trials-ghost';
  root.userData.vehicleType = 'ghost';
  root.userData.forwardAxis = '+Z';
  const bodyPivot = new THREE.Group();
  bodyPivot.name = 'ghost-shell';
  root.add(bodyPivot);
  const shellMaterial = _standard(registry, {
    color: options.color ?? 0xa8f7ff,
    emissive: 0x5edfff,
    emissiveIntensity: 0.82,
    transparent: true,
    opacity: options.opacity ?? 0.24,
    depthWrite: false,
    roughness: 0.24,
    metalness: 0.14,
  });
  const ghostDark = _standard(registry, {
    color: 0x4e8ca4,
    emissive: 0x2f6f8e,
    emissiveIntensity: 0.36,
    transparent: true,
    opacity: (options.opacity ?? 0.24) * 0.78,
    depthWrite: false,
    roughness: 0.7,
  });
  const chassis = _mesh(
    registry,
    _roundedDeckGeometry(2.18, 3.42, 0.58, 0.35, 0.075),
    shellMaterial,
    'ghost-chassis',
    { cast: false },
  );
  chassis.position.y = 0.82;
  chassis.renderOrder = 2;
  bodyPivot.add(chassis);
  const canopy = _mesh(
    registry,
    new THREE.SphereGeometry(0.72, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.68),
    shellMaterial,
    'ghost-canopy',
    { cast: false },
  );
  canopy.scale.set(1, 0.72, 1.15);
  canopy.position.set(0, 1.14, -0.22);
  canopy.renderOrder = 2;
  bodyPivot.add(canopy);
  const wheelRadius = 0.54;
  const wheels = _makeWheelSet({
    registry,
    bodyPivot,
    radius: wheelRadius,
    width: 0.38,
    track: 1.17,
    rearZ: -1.08,
    frontZ: 1.08,
    palette: { tire: ghostDark, rim: shellMaterial, accent: shellMaterial },
    style: 'ghost',
  });
  wheels.forEach((wheel) => {
    wheel.traverse((object) => {
      object.castShadow = false;
      if (object.isMesh) object.renderOrder = 2;
    });
  });
  const shadow = _makeShadow(registry, 1.72, 0.08);
  shadow.visible = false;
  root.add(shadow);
  root.renderOrder = 2;
  const animationAnchors = { bodyPivot, wheels };
  return {
    root,
    bodyPivot,
    shell: bodyPivot,
    wheels,
    flames: [],
    driver: null,
    shadow,
    wheelRadius,
    monster: false,
    animationAnchors,
  };
}
