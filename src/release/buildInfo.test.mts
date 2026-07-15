import assert from 'node:assert/strict';
import test from 'node:test';

import { createBuildInfo, normalizeDistributionChannel } from './buildInfo.ts';

test('formats channel-specific release labels', () => {
  assert.equal(
    createBuildInfo({ version: '0.1.0', extra: { distribution: 'google-play' } }).versionLabel,
    'v0.1.0 (Google Play)'
  );
  assert.equal(
    createBuildInfo({ version: '0.1.0', extra: { distribution: 'github' } }).versionLabel,
    'v0.1.0 (GitHub)'
  );
});

test('only the Google Play build hides external support links', () => {
  assert.equal(
    createBuildInfo({ version: '0.1.0', extra: { distribution: 'google-play' } }).showExternalSupportLink,
    false
  );
  assert.equal(
    createBuildInfo({ version: '0.1.0', extra: { distribution: 'github' } }).showExternalSupportLink,
    true
  );
});

test('unknown or absent distributions safely fall back to development', () => {
  assert.equal(normalizeDistributionChannel('nightly'), 'development');
  assert.equal(createBuildInfo({ version: '0.1.0' }).versionLabel, 'v0.1.0 (Development)');
  assert.equal(createBuildInfo(null).versionLabel, 'Unavailable (Development)');
});
