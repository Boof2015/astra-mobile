import type { Track as RntpTrack } from 'react-native-track-player';
import type { Track } from '@/types/audio';
import { streamUrlForTrack } from '@/services/remoteUrls';
import { artworkThumbFromSource, playerBackdropArtworkSource } from '@/library/artwork';

/**
 * M0 verification tracks. Streamed from a public royalty-free source so playback
 * works on a fresh emulator before on-device file scanning (M1) exists. These
 * also exercise the streaming/queue path we reuse for Subsonic/Jellyfin (M5).
 */
export const SAMPLE_TRACKS: Track[] = [
  {
    id: 'sample-1',
    path: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    title: 'SoundHelix Song 1',
    artist: 'T. Schürger',
    album: 'Astra Test Tones',
    duration: 372,
    format: 'MP3',
    sampleRate: 44100,
    bitrate: 320000,
    channels: 2,
    sourceType: 'local',
  },
  {
    id: 'sample-2',
    path: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
    title: 'SoundHelix Song 2',
    artist: 'T. Schürger',
    album: 'Astra Test Tones',
    duration: 426,
    format: 'MP3',
    sampleRate: 44100,
    bitrate: 320000,
    channels: 2,
    sourceType: 'local',
  },
];

/** Map an Astra Track to an RNTP track, carrying audiophile metadata as custom fields. */
export function toRntpTrack(track: Track): RntpTrack {
  // Remote tracks play from a resolved HTTP stream URL; the stable identity path
  // (subsonic://|jellyfin://) rides along as `astraPath` so history/favorites/now-
  // playing match the `tracks` row. Local tracks already play from their path.
  const isRemote = !!track.sourceType && track.sourceType !== 'local';
  const url = isRemote ? (streamUrlForTrack(track) ?? track.path) : track.path;
  // RNTP hands `artwork` to MediaSession/notification code, which eagerly
  // decodes local files as native Bitmaps. Supplying the full cover here can
  // retain tens of MiB even while Now Playing is closed. Keep that surface
  // bounded and carry Astra's display source separately for the sharp cover.
  const notificationArtwork = isRemote
    ? playerBackdropArtworkSource(track)
    : artworkThumbFromSource(track.artworkData);
  return {
    id: track.id,
    url,
    title: track.title,
    artist: track.artist,
    album: track.album,
    artwork: notificationArtwork ?? undefined,
    duration: track.duration,
    // Custom fields preserved by RNTP and read back in `rntpToTrack`.
    format: track.format,
    sampleRate: track.sampleRate,
    bitDepth: track.bitDepth,
    bitrate: track.bitrate,
    astraPath: track.path,
    sourceType: track.sourceType,
    sourceId: track.sourceId,
    sourceTrackId: track.sourceTrackId,
    artworkSourceId: track.artworkSourceId,
    astraArtworkData: track.artworkData,
  };
}

/** Reconstruct an Astra Track from the active RNTP track (for the player store). */
export function rntpToTrack(rt: RntpTrack): Track {
  const astraPath = typeof rt.astraPath === 'string' ? rt.astraPath : null;
  return {
    id: String(rt.id ?? rt.url),
    path: astraPath ?? String(rt.url),
    title: rt.title ?? 'Unknown title',
    artist: rt.artist ?? 'Unknown artist',
    album: rt.album ?? '',
    duration: typeof rt.duration === 'number' ? rt.duration : 0,
    artworkData:
      typeof rt.astraArtworkData === 'string'
        ? rt.astraArtworkData
        : typeof rt.artwork === 'string'
          ? rt.artwork
          : undefined,
    format: (rt.format as string) ?? 'PCM',
    sampleRate: rt.sampleRate as number | undefined,
    bitDepth: rt.bitDepth as number | undefined,
    bitrate: rt.bitrate as number | undefined,
    sourceType: (rt.sourceType as Track['sourceType']) ?? undefined,
    sourceId: rt.sourceId as number | undefined,
    sourceTrackId: rt.sourceTrackId as string | undefined,
    artworkSourceId: rt.artworkSourceId as string | undefined,
  };
}
