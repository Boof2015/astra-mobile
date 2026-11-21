import { useEffect, useState } from 'react';
import { AstraLibraryData } from '../../../modules/astra-library-scanner';
import { albumArtworkSource } from '@/library/artwork';
import { useLibraryStore } from '@/stores/libraryStore';
import { useRemoteSourcesStore } from '@/stores/remoteSourcesStore';
import { useSettingsStore } from '@/stores/settingsStore';

export interface LibraryPayoff {
  /** Recently added albums with artwork, newest first, at most five. */
  covers: { key: string; uri: string }[];
  trackCount: number;
  albumCount: number | null;
  artistCount: number | null;
  /** A folder scan or a server sync is still running. Nothing new is playable until it publishes. */
  busy: boolean;
}

const COVER_COUNT = 5;

/**
 * What the Done page shows. Covers come from the same recently-added page Home
 * uses, which refreshes itself when a scan publishes, so if the user is still
 * on Done when a scan finishes, the covers arrive in place.
 */
export function useLibraryPayoff(): LibraryPayoff {
  const homeAlbums = useLibraryStore((s) => s.homeAlbums);
  const trackCount = useLibraryStore((s) => s.totalTrackCount);
  const isScanning = useLibraryStore((s) => s.isScanning);
  const syncing = useRemoteSourcesStore((s) => Object.values(s.progressById).some((progress) => progress != null));
  const [counts, setCounts] = useState<{ albums: number; artists: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const settings = useSettingsStore.getState();
    const includeCollaborations = useLibraryStore.getState().includeCollabArtists;
    void Promise.all([
      AstraLibraryData.getAlbumPage('name', 'asc', settings.includeSingles, null, 1),
      AstraLibraryData.getArtistPage('name', 'asc', settings.artistGroupingMode, includeCollaborations, null, 1),
    ])
      .then(([albums, artists]) => {
        if (!cancelled) setCounts({ albums: albums.totalCount, artists: artists.totalCount });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // homeAlbums is replaced on every catalog refresh, so it doubles as the "library changed" signal.
  }, [homeAlbums]);

  const covers: { key: string; uri: string }[] = [];
  for (const album of homeAlbums) {
    const uri = albumArtworkSource(album);
    if (uri) covers.push({ key: album.identity_key, uri });
    if (covers.length === COVER_COUNT) break;
  }

  return {
    covers,
    trackCount,
    albumCount: counts?.albums ?? null,
    artistCount: counts?.artists ?? null,
    busy: isScanning || syncing,
  };
}
