import TrackPlayer, { State } from 'react-native-track-player';

import { handleAstraCarCommand } from '@/car/carCommandService';
import { AstraWidget, type AstraWidgetCommand } from '../../modules/astra-widget';

/** Mid-skip and loading count as playing: a tap then means "stop". */
async function isPlaying(): Promise<boolean> {
  try {
    const { state } = await TrackPlayer.getPlaybackState();
    return state === State.Playing || state === State.Buffering || state === State.Loading;
  } catch {
    // The player isn't set up yet, so nothing is playing.
    return false;
  }
}

async function runWidgetCommand(command: AstraWidgetCommand): Promise<void> {
  const carCommand =
    command === 'togglePlay' ? ((await isPlaying()) ? 'pause' : 'play') : command;
  // Android Auto's path: restores a saved session when nothing is loaded, sets
  // the player up even with no Activity, and queues behind any car command.
  await handleAstraCarCommand({ command: carCommand });
}

/**
 * The home-screen widget's buttons while Astra's JS is running, in the UI or
 * headless. With Astra closed, the widget starts it through the same command
 * path natively (AstraWidgetCommands.kt), so registering at bundle load covers
 * both.
 */
export function registerWidgetCommands(): void {
  AstraWidget.addListener('onCommand', ({ command }) => {
    void runWidgetCommand(command);
  });
}
