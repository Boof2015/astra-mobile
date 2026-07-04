import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DYNAMIC_PLAYLIST_PRESETS,
  createDefaultDynamicPlaylistRules,
  normalizeDynamicPlaylistRules,
} from './dynamicPlaylist.ts';

test('normalizes dynamic playlist defaults', () => {
  assert.deepEqual(createDefaultDynamicPlaylistRules(), {
    version: 1,
    conditions: [],
    sort: { field: 'title', direction: 'asc' },
    limit: null,
  });
});

test('normalizes supported condition kinds and trims text values', () => {
  const rules = normalizeDynamicPlaylistRules({
    version: 1,
    conditions: [
      { kind: 'text', field: 'artist', operator: 'contains', value: '  Jane  ' },
      { kind: 'exact', field: 'favorite', operator: 'is', value: true },
      { kind: 'numeric', field: 'year', operator: 'gte', value: 2001.7 },
      { kind: 'date', field: 'last_played_at', operator: 'never' },
    ],
    sort: { field: 'play_count', direction: 'desc' },
    limit: '25',
  });

  assert.deepEqual(rules, {
    version: 1,
    conditions: [
      { kind: 'text', field: 'artist', operator: 'contains', value: 'Jane' },
      { kind: 'exact', field: 'favorite', operator: 'is', value: true },
      { kind: 'numeric', field: 'year', operator: 'gte', value: 2001 },
      { kind: 'date', field: 'last_played_at', operator: 'never' },
    ],
    sort: { field: 'play_count', direction: 'desc' },
    limit: 25,
  });
});

test('rejects incomplete and unsupported dynamic playlist rules', () => {
  assert.throws(
    () =>
      normalizeDynamicPlaylistRules({
        version: 1,
        conditions: [{ kind: 'text', field: 'title', operator: 'contains', value: '' }],
      }),
    /Text value is required/
  );
  assert.throws(
    () =>
      normalizeDynamicPlaylistRules({
        version: 2,
        conditions: [],
      }),
    /version is not supported/
  );
  assert.throws(
    () =>
      normalizeDynamicPlaylistRules({
        version: 1,
        conditions: [],
        limit: 5001,
      }),
    /5000 or less/
  );
});

test('ships validated starter presets', () => {
  const presetIds = DYNAMIC_PLAYLIST_PRESETS.map((preset) => preset.id);
  assert.deepEqual(presetIds, [
    'unplayed',
    'recently-added',
    'favorites',
    'most-played',
    'not-recently',
    'local-only',
  ]);

  for (const preset of DYNAMIC_PLAYLIST_PRESETS) {
    assert.equal(normalizeDynamicPlaylistRules(preset.rules).version, 1);
  }
});
