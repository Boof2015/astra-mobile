// Album identity orchestration around the shared desktop-parity grouping
// algorithm (src/shared/library/albumGrouping.ts).
//
// The identity key is a *derived, stored* column: Android Auto (astra-car)
// groups albums in Kotlin SQL, so the truth has to live in the tracks table.
// Upserts write a provisional per-track key (tier 1/3 — correct for anything
// with an ALBUMARTIST or a single-artist album); the whole-library recompute
// pass afterwards applies the cross-track compilation heuristic (tier 2) and
// settles the group display artist.
//
// Runtime imports are relative (not '@/') so this module runs under plain
// `node --test` like the shared modules it wraps.

import {
  buildAlbumIdentityKeyFromTrack,
  getPrimaryArtistFromTrackArtist,
  groupTracksByAlbumIdentity,
  normalizeDisplay,
} from '../shared/library/albumGrouping.ts';
import type { LibraryDatabase, SqlParams } from '../db/database';

export interface ProvisionalAlbumIdentity {
  key: string;
  displayArtist: string;
}

/**
 * Per-track identity for upsert time, before the whole-library pass runs.
 * Matches the group the recompute would assign for tier-1 (explicit album
 * artist) and tier-3 (single-artist bucket) tracks; tier-2 compilations are
 * only discoverable across tracks and get corrected by the recompute.
 */
export function buildProvisionalAlbumIdentity(
  albumArtist: string | null,
  artist: string,
  album: string
): ProvisionalAlbumIdentity {
  const key = buildAlbumIdentityKeyFromTrack({ album, artist, album_artist: albumArtist });
  const normalizedAlbumArtist = normalizeDisplay(albumArtist ?? '');
  const displayArtist = normalizedAlbumArtist || getPrimaryArtistFromTrackArtist(artist);
  return { key, displayArtist };
}

/** Minimal row shape the recompute reads from the tracks table. */
export interface AlbumIdentityRow {
  id: number;
  album: string;
  artist: string;
  album_artist: string | null;
  artwork_hash: string | null;
  source_type: string;
  artwork_source_id: string | null;
  album_identity_key: string;
  album_display_artist: string | null;
}

export interface AlbumIdentityUpdate {
  identityKey: string;
  displayArtist: string;
  ids: number[];
}

/**
 * Pure diff: run the shared grouping over all rows and return only the groups
 * whose stored key or display artist changed. Remote rows have no cached
 * artwork_hash; their server cover-art id is album-scoped on both Subsonic and
 * Jellyfin, so it serves as the same shared-artwork signal for tier 2.
 */
export function computeAlbumIdentityUpdates(
  rows: readonly AlbumIdentityRow[]
): AlbumIdentityUpdate[] {
  const adapted = rows.map((row) => ({
    row,
    album: row.album,
    artist: row.artist,
    album_artist: row.album_artist,
    base_artwork_hash:
      row.artwork_hash ?? (row.source_type !== 'local' ? row.artwork_source_id : null),
  }));

  const groups = groupTracksByAlbumIdentity(adapted, (track) => String(track.row.id));

  const updates: AlbumIdentityUpdate[] = [];
  for (const group of groups.values()) {
    const ids: number[] = [];
    for (const track of group.tracks) {
      if (
        track.row.album_identity_key !== group.identityKey ||
        track.row.album_display_artist !== group.displayArtist
      ) {
        ids.push(track.row.id);
      }
    }
    if (ids.length > 0) {
      updates.push({ identityKey: group.identityKey, displayArtist: group.displayArtist, ids });
    }
  }
  return updates;
}

/**
 * Whole-library recompute: settle every track's album_identity_key and
 * album_display_artist. Runs after scans, folder/source removals, remote
 * syncs, and once at startup when the grouping algorithm version changes.
 * Returns the number of updated rows.
 */
export async function recomputeAlbumIdentity(db: LibraryDatabase): Promise<number> {
  const rows = await db.all<AlbumIdentityRow>(
    `SELECT id, album, artist, album_artist, artwork_hash, source_type,
            artwork_source_id, album_identity_key, album_display_artist
     FROM tracks`
  );
  const updates = computeAlbumIdentityUpdates(rows);
  if (updates.length === 0) return 0;

  let changed = 0;
  await db.transaction(async (tx) => {
    for (const update of updates) {
      for (let i = 0; i < update.ids.length; i += 500) {
        const chunk = update.ids.slice(i, i + 500);
        const placeholders = chunk.map(() => '?').join(', ');
        await tx.run(
          `UPDATE tracks SET album_identity_key = ?, album_display_artist = ?
           WHERE id IN (${placeholders})`,
          [update.identityKey, update.displayArtist, ...chunk] as SqlParams
        );
        changed += chunk.length;
      }
    }
  });
  return changed;
}

/**
 * Desktop track order within an album (library.ts compareTracksByDiscTrackTitle):
 * disc (null=0) → track (null=0) → title (base sensitivity) → path. Store-level
 * track lists are artist-ordered, so album screens must sort their filtered
 * slice with this — a compilation's tracks would otherwise come out grouped by
 * artist instead of running disc/track order.
 */
export function compareTracksByDiscTrackTitle(
  a: Pick<AlbumTrackOrderLike, 'disc_number' | 'track_number' | 'title' | 'path'>,
  b: Pick<AlbumTrackOrderLike, 'disc_number' | 'track_number' | 'title' | 'path'>
): number {
  const discA = a.disc_number ?? 0;
  const discB = b.disc_number ?? 0;
  if (discA !== discB) return discA - discB;

  const trackA = a.track_number ?? 0;
  const trackB = b.track_number ?? 0;
  if (trackA !== trackB) return trackA - trackB;

  const titleCompare = normalizeDisplay(a.title).localeCompare(normalizeDisplay(b.title), undefined, {
    sensitivity: 'base',
  });
  if (titleCompare !== 0) return titleCompare;

  return a.path.localeCompare(b.path);
}

export interface AlbumTrackOrderLike {
  disc_number: number | null;
  track_number: number | null;
  title: string;
  path: string;
}
