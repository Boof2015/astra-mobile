import { shouldResumeAfterExplicitNext } from '../audio/playbackNavigation.ts';
import type {
  DesktopRemoteControlCommand,
  DesktopRemotePlaybackState,
} from '@/types/desktopRemote';

/**
 * The desktop protocol exposes discrete transport commands. Expand a paused
 * Next intent into ordered Next + Play requests so the transition also resumes.
 */
export function desktopRemoteControlSequence(
  command: DesktopRemoteControlCommand,
  playbackState: DesktopRemotePlaybackState | undefined,
): DesktopRemoteControlCommand[] {
  if (
    command === 'next'
    && playbackState
    && shouldResumeAfterExplicitNext(playbackState)
  ) {
    return ['next', 'play'];
  }
  return [command];
}
