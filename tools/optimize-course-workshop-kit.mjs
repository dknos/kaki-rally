#!/usr/bin/env node
/**
 * Compress the Workshop kit without flattening or EXT_mesh_gpu_instancing.
 *
 * The old undocumented default `gltf-transform optimize` pass hoisted repeated
 * nodes out of their feature parents. Runtime looks features up by those parent
 * names, making 28% of visible geometry unreachable. This focused command keeps
 * the authored hierarchy while retaining meshopt compression.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INPUT = path.join(ROOT, 'assets/racing/workshop/kaki-course-workshop-kit-v1.glb');
const temporary = mkdtempSync(path.join(os.tmpdir(), 'kaki-workshop-optimize-'));
const output = path.join(temporary, 'kaki-course-workshop-kit-v1.glb');

try {
  const result = spawnSync('gltf-transform', [
    'optimize', INPUT, output,
    '--compress', 'meshopt',
    '--flatten', 'false',
    '--instance', 'false',
    '--join', 'false',
    '--palette', 'false',
    '--simplify', 'false',
    '--texture-compress', 'webp',
    '--texture-size', '1024',
  ], { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'gltf-transform failed');
  }
  const buffer = readFileSync(output);
  const json = JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString('utf8').trim());
  const rootNames = (json.scenes?.[json.scene || 0]?.nodes || []).map((index) => json.nodes[index]?.name || '');
  assert.equal(rootNames.length, 50, 'Workshop scene must retain 42 feature and 8 bridge roots');
  assert(rootNames.every(Boolean), 'Workshop optimizer created unnamed scene-root nodes');
  const guardrailIndex = json.nodes.findIndex((node) => node.name === 'bridge_guardrail_module');
  const guardrailChildren = (json.nodes[guardrailIndex]?.children || []).map((index) => json.nodes[index]?.name || '');
  assert.equal(guardrailChildren.filter((name) => name.includes('guardrail_post')).length, 12,
    'Workshop guardrail lost posts or caps');
  renameSync(output, INPUT);
  console.log(`Workshop hierarchy-safe meshopt pass complete: ${buffer.length} bytes, 50 named roots.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
