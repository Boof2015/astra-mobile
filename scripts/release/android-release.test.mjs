import assert from 'node:assert/strict';
import test from 'node:test';

import { getReleaseIdentity } from './android-release.mjs';

test('builds stable artifact names from the tracked release identity', () => {
  assert.deepEqual(getReleaseIdentity('github'), {
    artifactFileName: 'Astra-0.1.0-1-GitHub-arm-universal.apk',
    distribution: 'github',
    distributionLabel: 'GitHub',
    packageId: 'io.github.boof2015.astra',
    versionCode: 1,
    versionName: '0.1.0',
  });
  assert.equal(getReleaseIdentity('google-play').artifactFileName, 'Astra-0.1.0-1-GooglePlay.aab');
});

test('rejects unknown distribution channels', () => {
  assert.throws(() => getReleaseIdentity('nightly'), /Unsupported distribution/);
});
