import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDynamicPlaylistOrderByClause,
  buildDynamicPlaylistWhereClause,
} from './dynamicPlaylistSql.ts';
import type { DynamicPlaylistRulesV1 } from '../shared/playlists/dynamicPlaylist.ts';

const NOW = 1_800_000_000_000;

function rules(overrides: Partial<DynamicPlaylistRulesV1>): DynamicPlaylistRulesV1 {
  return {
    version: 1,
    conditions: [],
    sort: { field: 'title', direction: 'asc' },
    limit: null,
    ...overrides,
  };
}

test('builds text, favorite, source, numeric, and date filters', () => {
  const where = buildDynamicPlaylistWhereClause(
    rules({
      conditions: [
        { kind: 'text', field: 'artist', operator: 'contains', value: 'Jane' },
        { kind: 'exact', field: 'favorite', operator: 'is', value: true },
        { kind: 'exact', field: 'source_type', operator: 'is_not', value: 'jellyfin' },
        { kind: 'numeric', field: 'play_count', operator: 'gte', value: 2 },
        { kind: 'date', field: 'added_at', operator: 'within_days', value: 7 },
      ],
    }),
    NOW
  );

  assert.equal(where.joins, 'LEFT JOIN favorites f ON f.track_path = t.path');
  assert.match(where.where, /LOWER\(COALESCE\(t.artist, ''\)\) LIKE \?/);
  assert.match(where.where, /f.track_path IS NOT NULL/);
  assert.match(where.where, /t.source_type <> \?/);
  assert.match(where.where, /COALESCE\(t.play_count, 0\) >= \?/);
  assert.match(where.where, /t.added_at >= \?/);
  assert.deepEqual(where.params, ['%jane%', 'jellyfin', 2, NOW - 7 * 24 * 60 * 60 * 1000]);
});

test('builds last-played never and not-within filters', () => {
  const never = buildDynamicPlaylistWhereClause(
    rules({
      conditions: [{ kind: 'date', field: 'last_played_at', operator: 'never' }],
    }),
    NOW
  );
  assert.equal(never.where, 't.last_played_at IS NULL');
  assert.deepEqual(never.params, []);

  const stale = buildDynamicPlaylistWhereClause(
    rules({
      conditions: [{ kind: 'date', field: 'last_played_at', operator: 'not_within_days', value: 30 }],
    }),
    NOW
  );
  assert.equal(stale.where, '(t.last_played_at IS NULL OR t.last_played_at < ?)');
  assert.deepEqual(stale.params, [NOW - 30 * 24 * 60 * 60 * 1000]);
});

test('builds stable sort clauses with null handling', () => {
  assert.equal(
    buildDynamicPlaylistOrderByClause(
      rules({ sort: { field: 'play_count', direction: 'desc' } })
    ),
    'COALESCE(t.play_count, 0) DESC, t.path COLLATE NOCASE ASC'
  );
  assert.equal(
    buildDynamicPlaylistOrderByClause(
      rules({ sort: { field: 'last_played_at', direction: 'asc' } })
    ),
    'CASE WHEN t.last_played_at IS NULL THEN 1 ELSE 0 END ASC, t.last_played_at ASC, t.path COLLATE NOCASE ASC'
  );
});
