import TrackPlayer, { isPlaying } from 'react-native-track-player';
import type { Track } from '@/types/audio';
import { setupPlayer } from './trackPlayer';
import { SAMPLE_TRACKS, toRntpTrack } from './sampleTracks';

/**
 * Transport actions screens call. Thin wrappers over RNTP so the UI never
 * imports the engine directly — at M3/M4 this is where a custom Media3 module
 * would slot in behind the same function signatures.
 */

/**
 * Set up the player. Setup is deferred to here (a user-initiated play) rather
 * than app launch: RNTP starts a foreground MediaSession service on setup, and
 * Android only permits starting a foreground service while the app is in the
 * foreground.
 */
async function ensurePlayerReady(): Promise<void> {
  await setupPlayer();
}

/** Replace the queue with the given tracks and start playing at startIndex. */
export async function playTracks(tracks: Track[], startIndex = 0): Promise<void> {
  if (tracks.length === 0) return;
  await ensurePlayerReady();
  await TrackPlayer.setQueue(tracks.map(toRntpTrack));
  if (startIndex > 0) {
    await TrackPlayer.skip(startIndex);
  }
  await TrackPlayer.play();
}

/** M0 demo entry point: load the streamed sample queue if nothing is queued. */
export async function playSample(): Promise<void> {
  await ensurePlayerReady();
  const queue = await TrackPlayer.getQueue();
  if (queue.length === 0) {
    await TrackPlayer.add(SAMPLE_TRACKS.map(toRntpTrack));
  }
  await TrackPlayer.play();
}

export const play = (): Promise<void> => TrackPlayer.play();
export const pause = (): Promise<void> => TrackPlayer.pause();
export const seekTo = (seconds: number): Promise<void> => TrackPlayer.seekTo(seconds);

export async function togglePlay(): Promise<void> {
  const { playing } = await isPlaying();
  if (playing) {
    await TrackPlayer.pause();
  } else {
    await ensurePlayerReady();
    await TrackPlayer.play();
  }
}

export async function skipToNext(): Promise<void> {
  try {
    await TrackPlayer.skipToNext();
  } catch {
    // no next track — ignore
  }
}

export async function skipToPrevious(): Promise<void> {
  try {
    await TrackPlayer.skipToPrevious();
  } catch {
    // no previous track — ignore
  }
}
