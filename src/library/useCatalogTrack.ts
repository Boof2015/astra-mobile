import { useEffect, useState } from 'react';
import { AstraLibraryData } from '../../modules/astra-library-scanner';
import type { DbTrack } from '../types/library';

/** Refresh one playing track after a reindex, including tracks outside loaded pages. */
export function useCatalogTrack(path: string | undefined): DbTrack | null {
  const [track, setTrack] = useState<DbTrack | null>(null);
  useEffect(() => {
    let active = true;
    let request = 0;
    const refresh = async () => {
      const version = ++request;
      const next = path ? await AstraLibraryData.getTrack<DbTrack>(path).catch(() => null) : null;
      if (active && version === request) setTrack(next);
    };
    void refresh();
    const subscription = AstraLibraryData.addListener('onCatalogChanged', () => void refresh());
    return () => { active = false; subscription.remove(); };
  }, [path]);
  return track?.path === path ? track : null;
}
