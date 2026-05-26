import type { Track as RntpTrack } from 'react-native-track-player';
import type { Track } from '@/types/audio';

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
  return {
    id: track.id,
    url: track.path,
    title: track.title,
    artist: track.artist,
    album: track.album,
    artwork: track.artworkData,
    duration: track.duration,
    // Custom fields preserved by RNTP and read back in `rntpToTrack`.
    format: track.format,
    sampleRate: track.sampleRate,
    bitDepth: track.bitDepth,
    bitrate: track.bitrate,
  };
}

/** Reconstruct an Astra Track from the active RNTP track (for the player store). */
export function rntpToTrack(rt: RntpTrack): Track {
  return {
    id: String(rt.id ?? rt.url),
    path: String(rt.url),
    title: rt.title ?? 'Unknown title',
    artist: rt.artist ?? 'Unknown artist',
    album: rt.album ?? '',
    duration: typeof rt.duration === 'number' ? rt.duration : 0,
    artworkData: typeof rt.artwork === 'string' ? rt.artwork : undefined,
    format: (rt.format as string) ?? 'PCM',
    sampleRate: rt.sampleRate as number | undefined,
    bitDepth: rt.bitDepth as number | undefined,
    bitrate: rt.bitrate as number | undefined,
  };
}
