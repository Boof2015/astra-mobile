import { Image, type ImageRef } from 'expo-image';
import { AstraLibraryData } from '../../modules/astra-library-scanner';
import { usePlayerStore } from '@/stores/playerStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { albumArtworkSource } from './artwork';
import type { AmbientMoment } from './ambientModel';

export type PreparedAmbientMoment = AmbientMoment & { uri: string | null; image: ImageRef | null };

export async function loadAmbientMoment(seen: string[]): Promise<PreparedAmbientMoment | null> {
  const track = usePlayerStore.getState().currentTrack;
  if (!track) return null;
  const grouping = useSettingsStore.getState().artistGroupingMode;
  const artist = grouping === 'astra' ? track.resolvedArtistNames?.[0] ?? track.artistNames?.[0] ?? track.artist : track.artist;
  const moment = await AstraLibraryData.getTvAmbientMoment<AmbientMoment>(track.path, artist, grouping, seen);
  if (!moment) return null;
  const uri = albumArtworkSource(moment.album);
  let image: ImageRef | null = null;
  if (uri) {
    // Do not keep a foreground screen waiting indefinitely for a remote cover.
    // Late decodes are released and missing art uses the normal music fallback.
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    image = await Promise.race([
      Image.loadAsync(uri, { maxWidth: 600, maxHeight: 600 }).then(value => {
        if (expired) { value.release(); return null; }
        return value;
      }).catch(() => null),
      new Promise<null>(resolve => { timer = setTimeout(() => { expired = true; resolve(null); }, 8000); }),
    ]);
    if (timer) clearTimeout(timer);
  }
  return { ...moment, uri, image };
}

