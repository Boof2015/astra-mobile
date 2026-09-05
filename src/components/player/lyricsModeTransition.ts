/** One mounted body; a new mode is committed only at the transparent midpoint. */
export const LYRICS_MODE_EXIT_MS = 80;
export const LYRICS_MODE_ENTER_MS = 140;

export interface LyricsModeTransition {
  requested: boolean;
  displayed: boolean;
  phase: 'idle' | 'exiting' | 'entering';
  generation: number;
}

type Event =
  | { type: 'request'; lyrics: boolean; animate: boolean }
  | { type: 'hidden' | 'visible'; generation: number };

export function initialLyricsModeTransition(lyrics: boolean): LyricsModeTransition {
  return { requested: lyrics, displayed: lyrics, phase: 'idle', generation: 0 };
}

export function reduceLyricsModeTransition(
  state: LyricsModeTransition,
  event: Event,
): LyricsModeTransition {
  if (event.type === 'request') {
    if (!event.animate) {
      if (state.phase === 'idle' && state.displayed === event.lyrics) return state;
      return { ...initialLyricsModeTransition(event.lyrics), generation: state.generation + 1 };
    }
    if (state.requested === event.lyrics) return state;
    return {
      ...state,
      requested: event.lyrics,
      // A second tap during the exit restores the still-mounted body.
      phase: state.displayed === event.lyrics ? 'entering' : 'exiting',
      generation: state.generation + 1,
    };
  }
  if (event.generation !== state.generation) return state;
  if (event.type === 'hidden' && state.phase === 'exiting') {
    return {
      ...state,
      displayed: state.requested,
      phase: 'entering',
      generation: state.generation + 1,
    };
  }
  if (event.type === 'visible' && state.phase === 'entering') {
    return { ...state, phase: 'idle' };
  }
  return state;
}
