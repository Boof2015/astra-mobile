import { Image } from 'expo-image';
import { rntpToTrack } from '@/audio/sampleTracks';
import { playerBackdropArtworkSource } from '@/library/artwork';
import { useQueueStore } from '@/stores/queueStore';
import { getNowPlayingTrackTransitionKey } from '@/components/player/nowPlayingTrackTransition';
import type { NowPlayingArtCover } from '@/components/player/NowPlayingArtCarousel';

/**
 * The cover one step away in the queue mirror, for the phone target. Used to
 * slide the next cover in the moment a swipe commits instead of waiting for
 * the skip to land, and to warm the image cache. Null at the edge of the
 * mirror's window; the carousel then slides when the real track arrives.
 */
export function predictNeighborArtCover(direction: 'next' | 'previous'): NowPlayingArtCover | null {
  const { tracks, activeIndex } = useQueueStore.getState();
  if (activeIndex < 0) return null;
  const raw = tracks[activeIndex + (direction === 'next' ? 1 : -1)];
  if (!raw) return null;
  const neighbor = rntpToTrack(raw);
  return {
    key: getNowPlayingTrackTransitionKey('phone', neighbor.path),
    uri: neighbor.artworkData ?? null,
    thumb: playerBackdropArtworkSource(neighbor),
  };
}

/** Decode both neighbors' covers into memory so a skip either way shows them at once. */
export function prefetchNeighborArtwork(): void {
  const uris: string[] = [];
  for (const direction of ['next', 'previous'] as const) {
    const cover = predictNeighborArtCover(direction);
    if (cover?.thumb) uris.push(cover.thumb);
    if (cover?.uri) uris.push(cover.uri);
  }
  if (uris.length > 0) void Image.prefetch(uris, 'memory-disk').catch(() => {});
}
