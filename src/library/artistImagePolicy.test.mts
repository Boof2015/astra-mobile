import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAutomaticallyDownloadArtistImages,
  artistImageRetryBackoff,
  groupArtistImageTargetsByName,
} from './artistImagePolicy.ts';

const network = (
  type: 'WIFI' | 'ETHERNET' | 'CELLULAR' | 'NONE',
  isConnected = true,
  isInternetReachable: boolean | null = true
) => ({ type, isConnected, isInternetReachable }) as never;

test('automatic policy stays blocked before disclosure and while off', () => {
  assert.equal(canAutomaticallyDownloadArtistImages('wifi', false, network('WIFI')), false);
  assert.equal(canAutomaticallyDownloadArtistImages('off', true, network('WIFI')), false);
});

test('Wi-Fi policy permits Wi-Fi and Ethernet but not cellular', () => {
  assert.equal(canAutomaticallyDownloadArtistImages('wifi', true, network('WIFI')), true);
  assert.equal(canAutomaticallyDownloadArtistImages('wifi', true, network('ETHERNET')), true);
  assert.equal(canAutomaticallyDownloadArtistImages('wifi', true, network('CELLULAR')), false);
});

test('any-network policy still pauses offline or without reachable internet', () => {
  assert.equal(canAutomaticallyDownloadArtistImages('any', true, network('CELLULAR')), true);
  assert.equal(canAutomaticallyDownloadArtistImages('any', true, network('NONE', false)), false);
  assert.equal(
    canAutomaticallyDownloadArtistImages('any', true, network('WIFI', true, false)),
    false
  );
});

test('same normalized artist is deduplicated across grouping modes', () => {
  const groups = groupArtistImageTargetsByName([
    { groupingMode: 'astra', artistKey: 'björk', artistName: 'Björk' },
    { groupingMode: 'fileTags', artistKey: 'bjork', artistName: 'BJORK' },
    { groupingMode: 'astra', artistKey: 'radiohead', artistName: 'Radiohead' },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].length, 2);
  assert.equal(groups[1].length, 1);
});

test('transient retries back off exponentially and cap at one day', () => {
  const halfHour = 30 * 60 * 1000;
  assert.equal(artistImageRetryBackoff(halfHour, [0]), halfHour);
  assert.equal(artistImageRetryBackoff(halfHour, [1]), halfHour * 2);
  assert.equal(artistImageRetryBackoff(halfHour, [3, 2]), halfHour * 8);
  assert.equal(artistImageRetryBackoff(6 * 60 * 60 * 1000, [4]), 24 * 60 * 60 * 1000);
});
