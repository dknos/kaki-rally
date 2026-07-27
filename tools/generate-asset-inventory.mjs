#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AVATARS, HERO } from '../src/config.js';
import { RALLY_ASSET_MANIFEST } from '../src/racing/racingManifest.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'docs', 'ASSET_INVENTORY.json');
const CHECK = process.argv.includes('--check');
const SOURCE_SHA = '3711e8fc0c2c86b27911171c5394723ceb9e45aa';

const TEXT_ROOTS = ['src', 'index.html'];
const SHIPPED_ASSET_ROOTS = ['assets', 'images'];
const RUNTIME_SUPPORT = [
  'src/racing/crash/vendor/rapier.mjs',
  'vendor/three/LICENSE',
  'vendor/three/package.json',
  'vendor/three/build/three.core.js',
  'vendor/three/build/three.tsl.js',
  'vendor/three/build/three.webgpu.js',
  'vendor/three/examples/jsm/libs/draco/README.md',
  'vendor/three/examples/jsm/libs/draco/draco_decoder.js',
  'vendor/three/examples/jsm/libs/draco/draco_decoder.wasm',
  'vendor/three/examples/jsm/libs/draco/draco_wasm_wrapper.js',
  'vendor/three/examples/jsm/libs/meshopt_decoder.module.js',
  'vendor/three/examples/jsm/loaders/DRACOLoader.js',
  'vendor/three/examples/jsm/loaders/GLTFLoader.js',
  'vendor/three/examples/jsm/tsl/display/BloomNode.js',
  'vendor/three/examples/jsm/utils/BufferGeometryUtils.js',
  'vendor/three/examples/jsm/utils/SkeletonUtils.js',
];

const EXTENSION_KIND = new Map([
  ['.glb', 'model'],
  ['.gltf', 'model'],
  ['.png', 'image'],
  ['.jpg', 'image'],
  ['.jpeg', 'image'],
  ['.webp', 'image'],
  ['.mp3', 'audio'],
  ['.ogg', 'audio'],
  ['.wav', 'audio'],
  ['.wasm', 'runtime'],
  ['.js', 'runtime'],
  ['.mjs', 'runtime'],
]);

function posix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function normalizeCandidate(value) {
  let candidate = String(value || '').trim();
  if (!candidate || /^(?:data:|blob:|https?:|#)/i.test(candidate)) return '';
  candidate = candidate
    .replace(/[?#].*$/, '')
    .replace(/\\/g, '/')
    .replace(/^['"`(]+|['"`),;}\]]+$/g, '');
  const assetIndex = candidate.lastIndexOf('assets/');
  const imageIndex = candidate.lastIndexOf('images/');
  const index = Math.max(assetIndex, imageIndex);
  if (index >= 0) candidate = candidate.slice(index);
  candidate = candidate.replace(/^\.?\//, '');
  if (!/^(?:assets|images)\//.test(candidate)) return '';
  return path.posix.normalize(candidate);
}

async function walkFiles(relativeRoot) {
  const absoluteRoot = path.join(ROOT, relativeRoot);
  const rootStat = await stat(absoluteRoot);
  if (rootStat.isFile()) return [posix(relativeRoot)];
  const files = [];
  async function visit(absolute, relative) {
    const entries = await readdir(absolute, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const nextAbsolute = path.join(absolute, entry.name);
      const nextRelative = posix(path.join(relative, entry.name));
      if (entry.isDirectory()) await visit(nextAbsolute, nextRelative);
      else if (entry.isFile()) files.push(nextRelative);
    }
  }
  await visit(absoluteRoot, relativeRoot);
  return files;
}

async function assertExactCase(relativePath) {
  assert(!path.posix.isAbsolute(relativePath), `Inventory path is absolute: ${relativePath}`);
  assert(!relativePath.split('/').includes('..'), `Inventory path escapes the repository: ${relativePath}`);
  let current = ROOT;
  for (const segment of relativePath.split('/')) {
    const entries = await readdir(current);
    assert(entries.includes(segment), `Incorrect capitalization or missing path: ${relativePath}`);
    current = path.join(current, segment);
  }
  const destination = await realpath(current);
  const rootReal = await realpath(ROOT);
  assert(
    destination === rootReal || destination.startsWith(`${rootReal}${path.sep}`),
    `Inventory path resolves outside the repository: ${relativePath}`,
  );
  const info = await lstat(current);
  assert(info.isFile(), `Inventory entry is not a file: ${relativePath}`);
}

async function collectReferences() {
  const references = new Map();
  const add = (assetPath, reference) => {
    const normalized = normalizeCandidate(assetPath);
    if (!normalized) return;
    const refs = references.get(normalized) || new Set();
    refs.add(reference);
    references.set(normalized, refs);
  };

  for (const [id, entry] of Object.entries(RALLY_ASSET_MANIFEST)) {
    add(entry.url, `manifest:${id}`);
  }
  for (const avatar of [HERO, ...AVATARS]) {
    if (!avatar.glb) continue;
    add(`assets/breakroom/${avatar.glb}`, `avatar:${avatar.id || 'hero'}`);
  }

  const textFiles = [];
  for (const root of TEXT_ROOTS) {
    const absolute = path.join(ROOT, root);
    const info = await stat(absolute);
    if (info.isFile()) textFiles.push(root);
    else {
      const files = await walkFiles(root);
      textFiles.push(...files.filter((file) => /\.(?:css|html|js|json|mjs)$/i.test(file)));
    }
  }
  const assetPattern = /(?:\.\.\/)*(?:assets|images)\/[A-Za-z0-9_@./+%() -]+\.(?:glb|gltf|png|jpe?g|webp|mp3|ogg|wav)/gi;
  for (const file of textFiles.sort()) {
    const text = await readFile(path.join(ROOT, file), 'utf8');
    for (const match of text.matchAll(assetPattern)) add(match[0], `source:${file}`);
  }
  return references;
}

async function validateImportMap() {
  const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
  const match = html.match(/<script\s+type=["']importmap["']>([\s\S]*?)<\/script>/i);
  assert(match, 'index.html has no import map');
  const importMap = JSON.parse(match[1]);
  const entries = [];
  for (const [specifier, target] of Object.entries(importMap.imports || {})) {
    assert(!/^(?:https?:|\/)/.test(target), `Import map target must remain repository-relative: ${target}`);
    const relative = path.posix.normalize(target.replace(/^\.\//, ''));
    assert(!relative.split('/').includes('..'), `Import map target escapes the repository: ${target}`);
    const absolute = path.join(ROOT, relative);
    const info = await stat(absolute).catch(() => null);
    assert(info, `Import map target is missing: ${target}`);
    if (target.endsWith('/')) assert(info.isDirectory(), `Import prefix target is not a directory: ${target}`);
    else {
      assert(info.isFile(), `Import map target is not a file: ${target}`);
      await assertExactCase(relative);
    }
    entries.push({ specifier, target });
  }
  return entries.sort((a, b) => a.specifier.localeCompare(b.specifier));
}

async function hashFile(relativePath) {
  const contents = await readFile(path.join(ROOT, relativePath));
  return {
    bytes: contents.byteLength,
    sha256: createHash('sha256').update(contents).digest('hex'),
  };
}

async function buildInventory() {
  const references = await collectReferences();
  const shipped = new Set();
  for (const root of SHIPPED_ASSET_ROOTS) {
    for (const file of await walkFiles(root)) shipped.add(file);
  }
  for (const file of RUNTIME_SUPPORT) shipped.add(file);

  const missingReferences = [...references.keys()].filter((file) => !shipped.has(file));
  assert.equal(
    missingReferences.length,
    0,
    `Referenced assets are missing from the shipped inventory:\n${missingReferences.join('\n')}`,
  );

  const files = [];
  for (const relativePath of [...shipped].sort()) {
    await assertExactCase(relativePath);
    const { bytes, sha256 } = await hashFile(relativePath);
    const refs = [...(references.get(relativePath) || [])].sort();
    files.push({
      path: relativePath,
      bytes,
      sha256,
      kind: relativePath.startsWith('assets/source/') ? 'source-artifact' : (EXTENSION_KIND.get(path.extname(relativePath).toLowerCase()) || 'support'),
      references: refs,
    });
  }

  const summary = files.reduce((result, file) => {
    result.bytes += file.bytes;
    result.byKind[file.kind] = (result.byKind[file.kind] || 0) + 1;
    if (file.references.length > 0) result.referencedFiles += 1;
    return result;
  }, { files: files.length, bytes: 0, referencedFiles: 0, byKind: {} });

  return {
    schema: 1,
    product: 'Kaki Rally',
    source: {
      repository: 'https://github.com/dknos/Kaki-Survivors-2',
      commit: SOURCE_SHA,
    },
    importMap: await validateImportMap(),
    summary,
    files,
  };
}

const inventory = await buildInventory();
const serialized = `${JSON.stringify(inventory, null, 2)}\n`;

if (CHECK) {
  const existing = await readFile(OUTPUT, 'utf8').catch(() => '');
  assert(existing, 'docs/ASSET_INVENTORY.json is missing; run npm run assets:inventory');
  assert.equal(existing, serialized, 'Asset inventory is stale; run npm run assets:inventory');
  console.log(`Asset inventory verified: ${inventory.summary.files} files, ${(inventory.summary.bytes / 1024 / 1024).toFixed(2)} MiB`);
} else {
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, serialized);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT)}: ${inventory.summary.files} files, ${(inventory.summary.bytes / 1024 / 1024).toFixed(2)} MiB`);
}
