#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  lstat,
  readdir,
  readFile,
  rmdir,
  stat,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR_ROOT = path.join(ROOT, 'vendor', 'three');
const APPLY = process.argv.includes('--apply');

// This is the complete Three.js r185 runtime/license closure used by the
// import map, GLTF loader, post-processing pipeline, DRACO, and Meshopt.
const KEEP = new Set([
  'LICENSE',
  'package.json',
  'build/three.core.js',
  'build/three.tsl.js',
  'build/three.webgpu.js',
  'examples/jsm/libs/draco/README.md',
  'examples/jsm/libs/draco/draco_decoder.js',
  'examples/jsm/libs/draco/draco_decoder.wasm',
  'examples/jsm/libs/draco/draco_wasm_wrapper.js',
  'examples/jsm/libs/meshopt_decoder.module.js',
  'examples/jsm/loaders/DRACOLoader.js',
  'examples/jsm/loaders/GLTFLoader.js',
  'examples/jsm/tsl/display/BloomNode.js',
  'examples/jsm/utils/BufferGeometryUtils.js',
  'examples/jsm/utils/SkeletonUtils.js',
]);

function posix(value) {
  return value.split(path.sep).join('/');
}

async function walk(directory = VENDOR_ROOT) {
  const files = [];
  const directories = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await walk(absolute);
      files.push(...nested.files);
      directories.push(...nested.directories, absolute);
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return { files, directories };
}

async function validateKeepClosure() {
  const importMapTargets = [
    'build/three.webgpu.js',
    'build/three.tsl.js',
  ];
  for (const relative of KEEP) {
    const absolute = path.join(VENDOR_ROOT, relative);
    const info = await stat(absolute).catch(() => null);
    assert(info?.isFile(), `Required Three.js vendor file is missing: ${relative}`);
    const normalized = path.normalize(absolute);
    assert(normalized.startsWith(`${VENDOR_ROOT}${path.sep}`), `Vendor path escaped root: ${relative}`);
  }
  for (const relative of importMapTargets) {
    assert(KEEP.has(relative), `Import-map target is not retained: ${relative}`);
  }

  const moduleSpecifiers = /(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g;
  const queue = [...KEEP].filter((relative) => /\.(?:m?js)$/.test(relative));
  const seen = new Set(queue);
  while (queue.length) {
    const relative = queue.shift();
    const source = await readFile(path.join(VENDOR_ROOT, relative), 'utf8');
    for (const match of source.matchAll(moduleSpecifiers)) {
      const specifier = match[1];
      let dependency = '';
      if (specifier.startsWith('.')) {
        dependency = posix(path.normalize(path.join(path.dirname(relative), specifier)));
      } else if (specifier === 'three' || specifier === 'three/webgpu') {
        dependency = 'build/three.webgpu.js';
      } else if (specifier === 'three/tsl') {
        dependency = 'build/three.tsl.js';
      } else if (specifier.startsWith('three/addons/')) {
        dependency = `examples/jsm/${specifier.slice('three/addons/'.length)}`;
      }
      if (!dependency) continue;
      assert(KEEP.has(dependency), `${relative} imports unretained vendor module ${dependency}`);
      if (!seen.has(dependency) && /\.(?:m?js)$/.test(dependency)) {
        seen.add(dependency);
        queue.push(dependency);
      }
    }
  }
}

await validateKeepClosure();
const { files, directories } = await walk();
const extras = files
  .map((absolute) => ({
    absolute,
    relative: posix(path.relative(VENDOR_ROOT, absolute)),
  }))
  .filter(({ relative }) => !KEEP.has(relative))
  .sort((a, b) => a.relative.localeCompare(b.relative));
let bytes = 0;
for (const { absolute } of extras) bytes += (await lstat(absolute)).size;

if (!APPLY) {
  assert.equal(
    extras.length,
    0,
    `Three.js vendor tree has ${extras.length} unneeded files (${(bytes / 1024 / 1024).toFixed(2)} MiB); run npm run vendor:prune`,
  );
  console.log(`Three.js vendor closure verified: ${KEEP.size} files`);
  process.exit(0);
}

for (const { absolute } of extras) await unlink(absolute);
for (const directory of directories.sort((a, b) => b.length - a.length)) {
  await rmdir(directory).catch((error) => {
    if (error.code !== 'ENOTEMPTY') throw error;
  });
}

console.log(
  `Pruned ${extras.length} unused Three.js files (${(bytes / 1024 / 1024).toFixed(2)} MiB); `
  + `retained ${KEEP.size} runtime/license files`,
);
