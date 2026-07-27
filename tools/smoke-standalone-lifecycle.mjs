import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(ROOT, 'src', 'app', 'rallyApp.js'), 'utf8');
const navigation = fs.readFileSync(path.join(ROOT, 'src', 'core', 'navigation.js'), 'utf8');
const input = fs.readFileSync(path.join(ROOT, 'src', 'core', 'input.js'), 'utf8');
const audio = fs.readFileSync(path.join(ROOT, 'src', 'core', 'audio.js'), 'utf8');

assert.equal((app.match(/setAnimationLoop\(/g) || []).length, 1, 'the app must install exactly one render loop');
assert.match(app, /enterRacing\(this\.scene/);
assert.match(app, /tickRacing\(logicDt, elapsedDt\)/);
assert.match(app, /restartRacing\(this\.scene\)/);
assert.match(app, /exitRacing\(this\.scene/);
assert.match(app, /closeDrawTrackMode\(\)/);
assert.match(app, /state\.racing !== session/);
assert.match(app, /sessionRootCount/);
assert.match(app, /stopRacingAudio\(\{ immediate: true \}\)/);
assert.match(app, /this\.touchControls\?\.hide\(\)/);
assert.match(app, /state\.diagnostics\.modeTransitions \+= 1/);
assert.match(app, /rendererService\?\.dispose/);
assert.match(app, /disposeInput\(\)/);
assert.match(app, /disposeAudio\(\)/);
assert.match(app, /disposeAssetService\(\)/);

for (const method of ['menu', 'startRacing', 'openDrawEditor']) {
  assert.match(navigation, new RegExp(`${method}: missing\\('${method}'\\)`));
}
assert.doesNotMatch(navigation, /window\./);
assert.match(input, /window\.removeEventListener\('keydown'/);
assert.match(input, /clearTouchDriveState\(\)/);
assert.match(audio, /stopRacingAudio\(\{ immediate: true \}\)/);
assert.match(audio, /context\.close\(\)/);

console.log('Kaki Rally standalone lifecycle ownership contracts passed');
