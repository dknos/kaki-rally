#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inventory = JSON.parse(await readFile(path.join(ROOT, 'docs', 'ASSET_INVENTORY.json'), 'utf8'));
const baseArgument = process.argv.find((value) => /^https?:\/\//.test(value));
const base = new URL(
  baseArgument || process.env.KAKI_RALLY_PRODUCTION_URL || 'https://dknos.github.io/kaki-rally/',
);
const concurrency = Math.max(1, Math.min(12, Number(process.env.KAKI_RALLY_ASSET_CONCURRENCY) || 8));
const productionFiles = inventory.files.filter((entry) => (
  entry.path.startsWith('assets/')
  || entry.path.startsWith('images/')
  || entry.path.startsWith('vendor/')
  || entry.path === 'src/racing/crash/vendor/rapier.mjs'
));

const failures = [];
let cursor = 0;
async function worker() {
  while (cursor < productionFiles.length) {
    const entry = productionFiles[cursor++];
    const url = new URL(entry.path, base);
    try {
      let response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
      if (response.status === 405 || response.status === 501) {
        response = await fetch(url, {
          method: 'GET',
          headers: { Range: 'bytes=0-0' },
          redirect: 'follow',
        });
      }
      if (!response.ok) failures.push(`${response.status} ${entry.path}`);
    } catch (error) {
      failures.push(`${entry.path}: ${error.message}`);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
assert.equal(
  failures.length,
  0,
  `Production asset validation failed at ${base.href}:\n${failures.join('\n')}`,
);
console.log(`Production asset validation passed: ${productionFiles.length} URLs at ${base.href}`);
