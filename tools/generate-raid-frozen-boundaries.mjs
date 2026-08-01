#!/usr/bin/env node

// Records and verifies the frozen-mode boundary for the Kaki Rally Raid work.
//
// The Raid discipline is additive: every production mode that shipped before it
// must keep byte-identical source. This tool hashes those files once, stores the
// digest in docs/raid/FROZEN_BOUNDARIES.json, and re-verifies it on demand so a
// boundary violation fails a wave instead of being discovered in review.
//
// Files listed under `seams` are the narrow, documented registration points the
// Raid mode is allowed to touch. They are tracked by path and reason but not by
// digest, because they legitimately change.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'docs', 'raid', 'FROZEN_BOUNDARIES.json');
const CHECK = process.argv.includes('--check');
// Regenerating is how the boundary gets recorded the first time — and it is also
// how a violation could be laundered. The natural reaction to a failing --check
// is to re-run without it, which would quietly bless whatever changed. So a
// plain run refuses to overwrite a recorded digest; changing one requires
// saying so out loud.
const REBASELINE = process.argv.includes('--rebaseline');

// Directories whose every tracked file is frozen for the duration of Raid work.
const FROZEN_DIRECTORIES = Object.freeze([
  'src/app',
  'src/core',
  'src/racing/cameras',
  'src/racing/crash',
  'src/racing/drift',
  'src/racing/dunes',
  'src/rendering',
]);

// Individual frozen files that live beside Raid-adjacent code.
const FROZEN_FILES = Object.freeze([
  'index.html',
  'src/assets.js',
  'src/audio.js',
  'src/config.js',
  'src/gamepad.js',
  'src/input.js',
  'src/main.js',
  'src/navigation.js',
  'src/state.js',
  'src/racing/courseFeatureCatalog.js',
  'src/racing/courseFeaturePlacement.js',
  'src/racing/courseFeatureRuntime.js',
  'src/racing/courseFeatureSurfaces.js',
  'src/racing/courseFeatureValidation.js',
  'src/racing/courseSpatialIndex.js',
  'src/racing/courseSurfaceQuery.js',
  'src/racing/drawTrackCrossings.js',
  'src/racing/drawTrackElevation.js',
  'src/racing/drawTrackGeneration.js',
  'src/racing/drawTrackGeometry.js',
  'src/racing/drawTrackMode.js',
  'src/racing/drawTrackStorage.js',
  'src/racing/drawTrackThemes.js',
  'src/racing/drawTrackUI.js',
  'src/racing/handlingProfiles.js',
  'src/racing/monsterArena.js',
  'src/racing/monsterArenaDefinition.js',
  'src/racing/monsterDestruction.js',
  'src/racing/monsterDestructionRules.js',
  'src/racing/monsterRecords.js',
  'src/racing/monsterRounds.js',
  'src/racing/monsterScoring.js',
  'src/racing/monsterSmash.js',
  'src/racing/monsterSpotlights.js',
  'src/racing/monsterVehiclePhysics.js',
  'src/racing/physics.js',
  'src/racing/racingAssets.js',
  'src/racing/racingEnvironment.js',
  'src/racing/racingSteering.js',
  'src/racing/racingVehicles.js',
  'src/racing/racingVfx.js',
  'src/racing/rallyGrass.js',
  'src/racing/rallyGrassLayout.js',
  'src/racing/tracks.js',
  'src/racing/trialsEnvironment.js',
  'src/racing/trialsMode.js',
  'src/racing/trialsPhysics.js',
  'src/racing/trialsTracks.js',
  'src/racing/trialsWorkshopGeometry.js',
  'src/racing/trialsWorkshopStorage.js',
  'src/racing/trialsWorkshopUI.js',
]);

// The complete, closed set of shared files the Raid mode may modify, each with
// the reason an adapter cannot avoid the edit.
const SEAMS = Object.freeze([
  {
    path: 'src/racing/index.js',
    reason:
      'Mirrors the existing registerDevelopmentRacingMode/_crashModeApi seam so the shell '
      + 'can dispatch enter/tick/camera/resize/snapshot/restart/exit to a lazily imported '
      + 'Raid module. A mode cannot receive the shell frame callbacks without it.',
  },
  {
    path: 'src/racing/racingModeAvailability.js',
    reason:
      'getRacingModeAvailability() returns AVAILABLE for every unknown mode id, so "raid" '
      + 'would otherwise be publicly launchable. The additive branch keeps it development-gated.',
  },
  {
    path: 'src/racing/racingManifest.js',
    reason:
      'Raid-owned assets must be declared in the shared manifest to reuse the existing asset '
      + 'lease/validation pipeline. Entries are namespaced and referenced only by Raid.',
  },
  {
    path: 'src/app/rallyRouter.js',
    reason:
      'The ?mode=raid&play=1&dev=1 deep link needs a route alias and a raidDevelopment flag '
      + 'that cannot clobber the existing catastropheDevelopment flag.',
  },
  {
    path: 'src/app/rallyApp.js',
    reason:
      'The shell owns the dynamic import, loader copy, availability gate, and F3 diagnostics. '
      + 'Lazy loading is impossible without a shell-side import() site.',
  },
  {
    path: 'src/app/rallyMenu.js',
    reason:
      'One additive mode card so the discipline is reachable from the site rather than only '
      + 'from a deep link. No existing card is removed, renamed, or reordered. The card is '
      + 'labelled PREVIEW and says plainly what is missing.',
  },
  {
    path: 'src/app/rallySave.js',
    reason:
      'Raid storage keys must join the namespaced export/reset allow-list without altering '
      + 'the existing LEGACY_SAVE_KEYS ordering or contents.',
  },
  {
    path: 'tools/smoke-standalone-boundaries.mjs',
    reason:
      'Its lazy-production-import allow-list was a closed one-entry set matched by exact '
      + 'string equality, so the shell could not lazily import a second development-gated '
      + 'mode. Widened to two exact entries; the matching stays exact.',
  },
  {
    path: 'src/app/rallyVersion.js',
    reason:
      'The release version shown on the menu. Shipping a new discipline is a minor release, '
      + 'so the number moves with it; nothing about the value is Raid-specific.',
  },
  {
    path: 'package.json',
    reason: 'New test:raid / qa:raid scripts. No existing script is weakened or removed.',
  },
]);

const SEAM_PATHS = new Set(SEAMS.map((seam) => seam.path));

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}

function trackedFiles() {
  return git('ls-files', '-z').split('\0').filter(Boolean).sort();
}

function frozenPaths() {
  const tracked = trackedFiles();
  const selected = new Set();
  for (const file of tracked) {
    const inDirectory = FROZEN_DIRECTORIES.some((directory) => file.startsWith(`${directory}/`));
    if (inDirectory || FROZEN_FILES.includes(file)) selected.add(file);
  }
  for (const seam of SEAM_PATHS) selected.delete(seam);
  const missing = FROZEN_FILES.filter((file) => !tracked.includes(file));
  assert.equal(missing.length, 0, `Frozen file list references missing paths:\n${missing.join('\n')}`);
  return [...selected].sort();
}

async function digest(relativePath) {
  const contents = await readFile(path.join(ROOT, relativePath));
  return createHash('sha256').update(contents).digest('hex');
}

async function buildManifest() {
  const files = frozenPaths();
  const entries = [];
  for (const file of files) entries.push({ path: file, sha256: await digest(file) });
  return {
    schema: 1,
    product: 'Kaki Rally',
    scope: 'Kaki Rally Raid (Desert Expedition) additive-mode boundary',
    baselineCommit: git('rev-parse', 'HEAD').trim(),
    policy: {
      frozen:
        'Every file under `files` must stay byte-identical. A digest mismatch fails the wave '
        + 'unless the final report documents the file, the reason, proof that an adapter could '
        + 'not solve it, regression tests, and before/after evidence.',
      seams:
        'Only the paths under `seams` may change, and only additively, default-off outside Raid, '
        + 'and covered by a non-regression test.',
    },
    frozenDirectories: [...FROZEN_DIRECTORIES],
    seams: SEAMS.map((seam) => ({ ...seam })),
    summary: { frozenFiles: entries.length, seamFiles: SEAMS.length },
    files: entries,
  };
}

const manifest = await buildManifest();
const serialized = `${JSON.stringify(manifest, null, 2)}\n`;

if (CHECK) {
  const existing = await readFile(OUTPUT, 'utf8').catch(() => '');
  assert(existing, 'docs/raid/FROZEN_BOUNDARIES.json is missing; run npm run raid:boundaries');
  const recorded = JSON.parse(existing);
  const recordedByPath = new Map(recorded.files.map((file) => [file.path, file.sha256]));
  const violations = [];
  for (const file of manifest.files) {
    const expected = recordedByPath.get(file.path);
    if (expected === undefined) violations.push(`ADDED to frozen zone: ${file.path}`);
    else if (expected !== file.sha256) violations.push(`MODIFIED frozen file: ${file.path}`);
    recordedByPath.delete(file.path);
  }
  for (const missing of recordedByPath.keys()) violations.push(`REMOVED frozen file: ${missing}`);
  assert.equal(
    violations.length,
    0,
    `Kaki Rally Raid frozen-boundary violations:\n${violations.join('\n')}`,
  );
  console.log(
    `Raid frozen boundary verified: ${manifest.files.length} frozen files unchanged since `
    + `${recorded.baselineCommit.slice(0, 7)}, ${SEAMS.length} documented seams`,
  );
} else {
  const existing = await readFile(OUTPUT, 'utf8').catch(() => '');
  if (existing && !REBASELINE) {
    const recorded = JSON.parse(existing);
    const recordedByPath = new Map(recorded.files.map((file) => [file.path, file.sha256]));
    const changed = manifest.files.filter((file) => {
      const expected = recordedByPath.get(file.path);
      return expected !== undefined && expected !== file.sha256;
    });
    const removed = [...recordedByPath.keys()].filter(
      (recordedPath) => !manifest.files.some((file) => file.path === recordedPath),
    );
    assert.equal(
      changed.length + removed.length,
      0,
      'Refusing to overwrite the frozen boundary: this would launder a violation.\n'
      + [...changed.map((f) => `  MODIFIED ${f.path}`), ...removed.map((f) => `  REMOVED  ${f}`)].join('\n')
      + '\n\nRevert the frozen files, or pass --rebaseline to deliberately record the new state.',
    );
  }
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, serialized);
  console.log(
    `${REBASELINE && existing ? 'Rebaselined' : 'Wrote'} ${path.relative(ROOT, OUTPUT)}: `
    + `${manifest.files.length} frozen files, ${SEAMS.length} documented seams`,
  );
}
