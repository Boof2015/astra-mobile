export interface LyricsFollowCommand {
  target: number;
  animate: boolean;
  reason: 'sync' | 'recenter';
  expectedGeneration?: number;
}

export interface LyricsFollowState {
  browsing: boolean;
  focus: number;
  target: number | null;
  layoutRevision: number;
  active: boolean;
  reduced: boolean;
  command: LyricsFollowCommand | null;
}

export const initialLyricsFollowState: LyricsFollowState = {
  browsing: false, focus: -1, target: null, layoutRevision: -1,
  active: false, reduced: false, command: null,
};

export type LyricsFollowEvent =
  | { type: 'browse' }
  | { type: 'recenter'; generation: number }
  | { type: 'sync'; focus: number; target: number | null; layoutRevision: number; active: boolean; reduced: boolean };

/** Layout revisions and discontinuities settle; only continuous cue movement
 * and an explicit Recenter request animate. Browsing never loses its owner. */
export function reduceLyricsFollow(state: LyricsFollowState, event: LyricsFollowEvent): LyricsFollowState {
  if (event.type === 'browse') return state.browsing ? state : { ...state, browsing: true, command: null };
  if (event.type === 'recenter') {
    if (state.target === null) return state;
    return { ...state, browsing: false, command: {
      target: state.target, animate: state.active && !state.reduced, reason: 'recenter',
      expectedGeneration: event.generation,
    } };
  }
  const { focus, target, layoutRevision, active, reduced } = event;
  if (state.focus === focus && state.target === target && state.layoutRevision === layoutRevision
    && state.active === active && state.reduced === reduced) return state;
  const animate = active && state.active && !reduced && !state.reduced && state.target !== null
    && state.layoutRevision === layoutRevision && Math.abs(focus - state.focus) <= 1;
  return {
    ...state, focus, target, layoutRevision, active, reduced,
    command: state.browsing || target === null ? null : { target, animate, reason: 'sync' },
  };
}

/** UI gestures can arrive while JS is busy. A queued Recenter must not steal
 * ownership from a newer drag, nor may a queued cue resume manual browsing. */
export function canApplyLyricsFollowCommand(command: LyricsFollowCommand, mode: 'follow' | 'browse', generation: number): boolean {
  'worklet';
  return command.reason === 'recenter' ? command.expectedGeneration === generation : mode === 'follow';
}

export function lyricsAnchorOffset(top: number | undefined, height: number | undefined, viewport: number, content: number): number | null {
  if (top === undefined || height === undefined || height <= 0 || viewport <= 0 || content <= 0) return null;
  return Math.max(0, Math.min(content - viewport, top + height / 2 - viewport * .4));
}

/** One screen of overscan either side; tall wrapped rows count by intersection. */
export function lyricsRowInWindow(top: number | undefined, height: number | undefined, scroll: number, viewport: number): boolean {
  return top !== undefined && height !== undefined && top + height >= scroll - viewport && top <= scroll + viewport * 2;
}
