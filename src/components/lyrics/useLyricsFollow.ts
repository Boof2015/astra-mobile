import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ScrollView } from 'react-native';
import {
  Easing, runOnJS, runOnUI, scrollTo, useAnimatedReaction,
  useAnimatedRef, useAnimatedScrollHandler, useSharedValue, type SharedValue,
} from 'react-native-reanimated';
import { canSettleLyricsScroll, settleLyricsScroll } from '../../../modules/astra-tv';
import { canApplyLyricsFollowCommand, initialLyricsFollowState, reduceLyricsFollow, type LyricsFollowCommand } from './lyricsFollowState';

export const LYRICS_EASE = Easing.bezier(.22, 1, .36, 1);

interface ScrollCommand {
  mode: 'follow' | 'browse';
  from: number;
  target: number;
  animate: boolean;
  stagger: boolean;
  generation: number;
}

export interface LyricsScrollMotion {
  command: SharedValue<ScrollCommand>;
  started: SharedValue<number>;
  cue: SharedValue<{ focus: number; current: number }>;
}

export function useLyricsFollow({ focus, current, target, layoutRevision, active, reduced, viewport, windowChanged }: {
  focus: number; current: number; target: number | null; layoutRevision: number; active: boolean; reduced: boolean;
  viewport: number; windowChanged: (offset: number) => void;
}) {
  const ref = useAnimatedRef<ScrollView>();
  const actual = useSharedValue(0);
  const started = useSharedValue(-1);
  const reportedWindow = useSharedValue(0);
  const command = useSharedValue<ScrollCommand>({ mode: 'follow', from: 0, target: 0, animate: false, stagger: false, generation: 0 });
  const cue = useSharedValue({ focus, current });
  const motion = useMemo(() => ({ command, started, cue }), [command, started, cue]);
  const state = useRef(initialLyricsFollowState);
  const pendingRecenter = useRef<LyricsFollowCommand | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const browse = useCallback(() => {
    pendingRecenter.current = null;
    state.current = reduceLyricsFollow(state.current, { type: 'browse' });
    setBrowsing(true);
  }, []);

  const publish = useCallback((next: LyricsFollowCommand | null, nextCue: { focus: number; current: number }) => {
    runOnUI(() => {
      // Publish emphasis and movement together. A second React commit here
      // used to let the new highlight finish before the scroll even began.
      cue.set(nextCue);
      // A native drag owns scrolling immediately, even if its JS notification
      // is queued behind a cue/layout effect. Only Recenter may take it back.
      if (!next || !canApplyLyricsFollowCommand(next, command.value.mode, command.value.generation)) return;
      command.set({ mode: 'follow', from: actual.value, target: next.target, animate: next.animate,
        stagger: next.animate && next.reason === 'sync', generation: command.value.generation + 1 });
    })();
  }, [actual, command, cue]);

  useLayoutEffect(() => {
    const previous = state.current;
    const next = reduceLyricsFollow(previous, { type: 'sync', focus, target, layoutRevision, active, reduced });
    state.current = next;
    const recenterCommand = pendingRecenter.current;
    pendingRecenter.current = null;
    publish(recenterCommand ?? (next.command !== previous.command ? next.command : null), { focus, current });
  }, [focus, current, target, layoutRevision, active, reduced, browsing, publish]);

  const recenter = useCallback(() => {
    const next = reduceLyricsFollow(state.current, { type: 'recenter', generation: command.value.generation });
    if (next === state.current) return;
    state.current = next;
    // Commit the destination's animation window before moving native content.
    pendingRecenter.current = next.command;
    setBrowsing(false);
  }, [command]);

  const settle = useCallback((target: number, generation: number) => {
    // Ignore a settle queued before a newer cue or a user's drag.
    if (!ref.current || command.get().generation !== generation) return;
    const tag = ref.getTag?.();
    if (tag != null) void settleLyricsScroll(tag, target);
  }, [ref, command]);

  useAnimatedReaction(() => command.value, next => {
    // Android owns the main movement. Jumping native content and compensating
    // with transforms is not atomic under Fabric and flashes for one frame.
    if (next.mode !== 'follow') return;
    if (!next.animate && canSettleLyricsScroll) runOnJS(settle)(next.target, next.generation);
    else scrollTo(ref, 0, next.target, next.animate);
  });
  const onScroll = useAnimatedScrollHandler({
    onScroll: event => {
      actual.set(event.contentOffset.y);
      // Start the small ripple only once native motion actually begins. Scroll
      // offsets never feed a row transform, so a late event cannot jump text.
      if (command.value.mode === 'follow' && command.value.animate && started.value !== command.value.generation
        && Math.abs(actual.value - command.value.from) > .01) started.set(command.value.generation);
      // Window changes update animation eligibility, not the mounted content.
      // A half-screen threshold keeps React out of the per-frame scroll path.
      if (Math.abs(actual.value - reportedWindow.value) >= viewport / 2) {
        reportedWindow.set(actual.value);
        runOnJS(windowChanged)(actual.value);
      }
    },
    onBeginDrag: event => {
      actual.set(event.contentOffset.y);
      command.set({ mode: 'browse', from: actual.value, target: actual.value, animate: false, stagger: false, generation: command.value.generation + 1 });
      runOnJS(browse)();
    },
  });
  return { ref, motion, onScroll, browsing, recenter };
}
