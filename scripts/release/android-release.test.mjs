import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createSourceBundle, getReleaseIdentity } from './android-release.mjs';

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

function sourceFixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'astra-source-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'repo');
  const output = path.join(directory, 'output');
  mkdirSync(root);
  mkdirSync(output);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init');
  writeFileSync(path.join(root, '.gitignore'), '.local/\n');
  writeFileSync(path.join(root, 'source.txt'), 'candidate source');
  git('add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Fixture');
  return { root, output, git };
}

test('source archive matches the commit and excludes ignored SDK downloads', (t) => {
  const { root, output, git } = sourceFixture(t);
  mkdirSync(path.join(root, '.local'));
  writeFileSync(path.join(root, '.local', 'discord_partner_sdk.aar'), 'private binary');
  const result = createSourceBundle(output, { root, expectedCommit: git('rev-parse', 'HEAD') });
  const entries = execFileSync('tar', ['-tzf', path.join(output, result.fileName)], { encoding: 'utf8' });
  assert.match(entries, /Astra-source\/source.txt/u);
  assert.doesNotMatch(entries, /\.local|\.aar/u);
  assert.match(result.sha256, /^[a-f0-9]{64}$/u);
  assert.ok(result.sizeBytes > 0);
});

test('candidate refuses a different or dirty source revision', (t) => {
  const { root, output } = sourceFixture(t);
  assert.throws(() => createSourceBundle(output, { root, expectedCommit: '0'.repeat(40) }), /differs from the candidate/u);
  writeFileSync(path.join(root, 'source.txt'), 'uncommitted change');
  assert.throws(() => createSourceBundle(output, { root, expectedCommit: null }), /committed and clean/u);
});

test('candidate refuses new source omitted from its commit', (t) => {
  const { root, output } = sourceFixture(t);
  writeFileSync(path.join(root, 'new-source.txt'), 'untracked source');
  assert.throws(() => createSourceBundle(output, { root, expectedCommit: null }), /committed and clean/u);
});
