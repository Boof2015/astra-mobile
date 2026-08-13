import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { getReleaseIdentity } from './android-release.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (relativePath) =>
  JSON.parse(readFileSync(path.join(ROOT, relativePath), 'utf8'));

// Read the identity from the same tracked sources the implementation uses rather
// than freezing a literal. A hardcoded version turns every release bump into a
// spurious failure — and because run-release-tests.mjs exits on the first
// failure, this suite running first meant one stale string hid every later suite.
const { version: versionName } = readJson('package.json');
const { androidVersionCode: versionCode } = readJson('release.json');

test('builds stable artifact names from the tracked release identity', () => {
  assert.deepEqual(getReleaseIdentity('github'), {
    artifactFileName: `Astra-${versionName}-${versionCode}-GitHub-arm-universal.apk`,
    distribution: 'github',
    distributionLabel: 'GitHub',
    packageId: 'io.github.boof2015.astra',
    versionCode,
    versionName,
  });
  assert.equal(
    getReleaseIdentity('google-play').artifactFileName,
    `Astra-${versionName}-${versionCode}-GooglePlay.aab`
  );
});

test('artifact names carry the real version and code, not a placeholder', () => {
  // Guards the composition itself: deriving both sides above would still pass if
  // the template dropped a field, so assert the values actually appear.
  const { artifactFileName } = getReleaseIdentity('github');
  assert.match(artifactFileName, /^Astra-\d+\.\d+\.\d+/u);
  assert.ok(
    artifactFileName.includes(`-${versionName}-${versionCode}-`),
    `expected ${artifactFileName} to carry version ${versionName} and code ${versionCode}`
  );
});

test('distribution channels differ in package format', () => {
  assert.ok(getReleaseIdentity('github').artifactFileName.endsWith('.apk'));
  assert.ok(getReleaseIdentity('google-play').artifactFileName.endsWith('.aab'));
  assert.equal(getReleaseIdentity('google-play').distributionLabel, 'Google Play');
});

test('rejects unknown distribution channels', () => {
  assert.throws(() => getReleaseIdentity('nightly'), /Unsupported distribution/);
});
