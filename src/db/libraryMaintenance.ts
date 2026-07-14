import type { LibraryDatabase } from './database';

export const REBUILD_LOCAL_LIBRARY_INDEX_SQL =
  "UPDATE tracks SET mtime = -1 WHERE source_type = 'local'";

/** Marks only device-local rows stale so the normal scanner re-extracts them. */
export async function markLocalTracksStaleForRebuild(db: LibraryDatabase): Promise<number> {
  const result = await db.run(REBUILD_LOCAL_LIBRARY_INDEX_SQL);
  return result.changes;
}
