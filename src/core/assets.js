import * as THREE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { AVATARS, HERO } from '../config.js';

export const BASE = 'assets/breakroom/';
export const GLTF_CACHE = {};

const _entries = new Map();
const _draco = new DRACOLoader();
const _loader = new GLTFLoader();
_loader.setDRACOLoader(_draco);
_loader.setMeshoptDecoder(MeshoptDecoder);

function cacheEntry(key, path) {
  const existing = _entries.get(key);
  if (existing) {
    if (existing.path !== path) throw new Error(`Asset key ${key} was requested with two paths`);
    return existing;
  }
  const entry = {
    key,
    path,
    refs: 0,
    status: 'loading',
    error: '',
    gltf: null,
    promise: null,
  };
  entry.promise = new Promise((resolve) => {
    _loader.load(
      path,
      (gltf) => {
        entry.status = 'ready';
        entry.gltf = gltf;
        GLTF_CACHE[key] = gltf;
        resolve(true);
      },
      undefined,
      (error) => {
        entry.status = 'error';
        entry.error = error?.message || String(error || 'load failed');
        GLTF_CACHE[key] = null;
        console.error(`[Kaki Rally assets] ${path} failed: ${entry.error}`);
        resolve(false);
      },
    );
  });
  _entries.set(key, entry);
  return entry;
}

export function lazyLoadGLTF(key, path) {
  if (!key || !path) return Promise.reject(new TypeError('lazyLoadGLTF requires a key and path'));
  return cacheEntry(key, path).promise;
}

export function cloneCached(key) {
  const gltf = GLTF_CACHE[key];
  if (!gltf?.scene) return null;
  return SkeletonUtils.clone(gltf.scene);
}

function avatarFor(id) {
  return AVATARS.find((avatar) => avatar.id === id) || AVATARS[0];
}

function avatarAsset(avatar) {
  return avatar.glb
    ? { key: `hero_${avatar.id}`, path: `${BASE}${avatar.glb}` }
    : { key: 'hero', path: `${BASE}${HERO.glb}` };
}

export function createDriverAssetLease(ids = ['kitty']) {
  const roster = [...new Set(['kitty', ...ids])].map(avatarFor);
  const assets = new Map();
  for (const avatar of roster) {
    const spec = avatarAsset(avatar);
    assets.set(spec.key, spec);
  }
  const entries = [...assets.values()].map(({ key, path }) => {
    const entry = cacheEntry(key, path);
    entry.refs += 1;
    return entry;
  });
  let released = false;
  return {
    ids: roster.map((avatar) => avatar.id),
    ready: Promise.all(entries.map((entry) => entry.promise)).then((results) => {
      if (!results.every(Boolean)) {
        const failures = entries.filter((entry) => entry.status === 'error').map((entry) => entry.path);
        throw new Error(`Driver assets failed to load: ${failures.join(', ')}`);
      }
      return true;
    }),
    release() {
      if (released) return false;
      released = true;
      for (const entry of entries) entry.refs = Math.max(0, entry.refs - 1);
      return true;
    },
  };
}

export function prepareRallyClone(root, { tint = 0xffffff } = {}) {
  if (!root?.traverse) throw new TypeError('prepareRallyClone requires an Object3D root');
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    const source = Array.isArray(object.material) ? object.material : [object.material];
    const owned = source.map((material) => {
      if (!material?.clone) return material;
      const clone = material.clone();
      if (tint !== 0xffffff && clone.color) clone.color.multiply(new THREE.Color(tint));
      clone.needsUpdate = true;
      return clone;
    });
    object.material = Array.isArray(object.material) ? owned : owned[0];
  });
  return root;
}

export async function createDriverMesh(id = 'kitty') {
  const avatar = avatarFor(id);
  const spec = avatarAsset(avatar);
  const ready = await lazyLoadGLTF(spec.key, spec.path);
  if (!ready) throw new Error(`Driver ${avatar.name} is unavailable`);
  const source = cloneCached(spec.key);
  if (!source) throw new Error(`Driver ${avatar.name} did not produce a scene`);
  prepareRallyClone(source, { tint: avatar.tint });

  const wrapper = new THREE.Group();
  wrapper.name = `kaki-rally-driver-${avatar.id}`;
  wrapper.userData.avatarId = avatar.id;
  const initialBounds = new THREE.Box3().setFromObject(source);
  const height = Math.max(0.01, initialBounds.getSize(new THREE.Vector3()).y);
  source.scale.multiplyScalar((HERO.targetHeight / height) * HERO.scale * (avatar.scaleMul || 1));
  const fittedBounds = new THREE.Box3().setFromObject(source);
  const center = fittedBounds.getCenter(new THREE.Vector3());
  source.position.x -= center.x;
  source.position.z -= center.z;
  source.position.y -= fittedBounds.min.y;
  wrapper.add(source);
  return wrapper;
}

export function disposeDriverMesh(root) {
  if (!root?.traverse) return false;
  const materials = new Set();
  root.traverse((object) => {
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list) if (material) materials.add(material);
  });
  for (const material of materials) {
    try { material.dispose(); } catch (_) {}
  }
  root.parent?.remove(root);
  return true;
}

export function disposeCachedGLTF(key) {
  const entry = _entries.get(key);
  if (!entry || entry.refs > 0) return false;
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  entry.gltf?.scene?.traverse?.((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const geometry of geometries) try { geometry.dispose(); } catch (_) {}
  for (const material of materials) try { material.dispose(); } catch (_) {}
  for (const texture of textures) try { texture.dispose(); } catch (_) {}
  delete GLTF_CACHE[key];
  _entries.delete(key);
  return true;
}

export function getAssetDiagnostics() {
  return [..._entries.values()].map(({ key, path, refs, status, error, gltf }) => ({
    key,
    path,
    refs,
    status,
    error,
    roots: gltf?.scene?.children?.length || 0,
  }));
}

export function disposeAssetService() {
  for (const entry of _entries.values()) entry.refs = 0;
  for (const key of [..._entries.keys()]) disposeCachedGLTF(key);
  try { _draco.dispose(); } catch (_) {}
}
