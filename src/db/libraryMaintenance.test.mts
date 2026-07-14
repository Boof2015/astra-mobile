import assert from 'node:assert/strict';
import test from 'node:test';
import { REBUILD_LOCAL_LIBRARY_INDEX_SQL, markLocalTracksStaleForRebuild } from './libraryMaintenance.ts';

test('library rebuild marks only local tracks stale', async () => {
  assert.match(REBUILD_LOCAL_LIBRARY_INDEX_SQL, /source_type\s*=\s*'local'/i);
  assert.doesNotMatch(REBUILD_LOCAL_LIBRARY_INDEX_SQL, /DELETE|DROP/i);
  let executed = '';
  const changes = await markLocalTracksStaleForRebuild({
    run: async (sql: string) => {
      executed = sql;
      return { changes: 12, lastInsertRowid: 0 };
    },
  } as never);
  assert.equal(executed, REBUILD_LOCAL_LIBRARY_INDEX_SQL);
  assert.equal(changes, 12);
});
