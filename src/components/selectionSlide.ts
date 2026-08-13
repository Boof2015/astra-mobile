import { useEffect, useRef } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { motion } from '@/theme/motion';
import { isMeasured, resolveMark, type ItemRect } from './selectionSlideMath.ts';

/** Which way the mark travels. Rails run down their leading edge. */
export type SelectionAxis = 'horizontal' | 'vertical';

/**
 * Why the mark is moving, which is what decides whether it travels at all.
 *
 * `select` is the mark saying something — the selection changed and the trip
 * between the two is the message. `correct` is the mark saying nothing: the
 * layout moved underneath it and it is only staying on the item it already
 * points at. Corrections land immediately, because a mark in flight is a mark
 * temporarily pointing at nothing, and there is nothing here worth watching.
 */
type Travel = 'select' | 'correct';

export interface SelectionSlide {
  /** `onLayout` for the item with this key. */
  measure: (key: string) => (event: LayoutChangeEvent) => void;
  /** Distance along the travel axis: x, or y on a rail. */
  offset: SharedValue<number>;
  /** Size along the travel axis: the item's width, or its height on a rail. */
  extent: SharedValue<number>;
  /** 0 hides the mark — nothing is selected, or nothing has measured yet. */
  presence: SharedValue<number>;
}

interface SlideState {
  rects: Map<string, ItemRect>;
  activeKey: string | null;
  /** False until the mark holds a real position, so the next landing is a cut. */
  placed: boolean;
  /**
   * When the selection trip currently in flight lands. A correction arriving
   * before then re-aims that trip instead of teleporting out of the middle of
   * it.
   */
  travellingUntil: number;
}

/**
 * Move the mark to wherever the selected item measured, or hide it if there
 * isn't one.
 *
 * At module scope on purpose: the compiler freezes a value once a component
 * passes it to a hook, so the writes live in a plain function that only ever
 * sees the shared values as arguments.
 */
function placeMark(
  state: SlideState,
  offset: SharedValue<number>,
  extent: SharedValue<number>,
  presence: SharedValue<number>,
  travel: Travel
) {
  const mark = resolveMark(state.rects, state.activeKey);
  if (!mark) {
    // Nothing to point at. Fade out where it stands and forget the spot, so
    // whatever is selected next is a cut rather than a slide out of a stale
    // position it was never really at.
    presence.value = withTiming(0, motion.quick);
    state.placed = false;
    state.travellingUntil = 0;
    return;
  }
  if (!state.placed) {
    offset.value = mark.offset;
    extent.value = mark.extent;
    presence.value = withTiming(1, motion.quick);
    state.placed = true;
    state.travellingUntil = 0;
    return;
  }
  if (travel === 'select') {
    offset.value = withTiming(mark.offset, motion.quick);
    extent.value = withTiming(mark.extent, motion.quick);
    state.travellingUntil = Date.now() + motion.quick.duration;
    return;
  }
  if (Date.now() < state.travellingUntil) {
    // Mid-trip. Re-aim rather than cut, or a layout event landing during a tab
    // switch would abort the very animation the switch is there to show.
    offset.value = withTiming(mark.offset, motion.quick);
    extent.value = withTiming(mark.extent, motion.quick);
    return;
  }
  offset.value = mark.offset;
  extent.value = mark.extent;
}

/**
 * Slide a selection mark to whichever item is selected.
 *
 * Position comes from the items' own measured rects (see `selectionSlideMath`),
 * so one hook serves a phone's equal-flex tab row, a rail's column and a split
 * card's shell-sized items without knowing which it is in.
 *
 * Whether the mark travels depends on *why* it moved:
 *
 * - **Selection changed** — it travels, over `motion.quick`, matching both the
 *   tab scene's 160ms cross-fade and the icon/label colour fade in the item
 *   itself. The mark this replaces took 220ms, so it was still crossing the bar
 *   after the scene and the colours had already committed to the new tab.
 * - **Layout changed** — it lands, immediately. Animating these was what made a
 *   single bad measurement read as a deliberate move in the wrong direction, and
 *   landing them also keeps the mark glued to an item that is itself animating
 *   (the split card's items resizing when the dock opens) rather than lagging a
 *   fixed duration behind it.
 * - **First placement, or a new `shapeKey`** — no travel at all. A cold start or
 *   a rotation should find the mark already in place, not watch it fly in.
 */
export function useSelectionSlide(
  activeKey: string | null,
  axis: SelectionAxis,
  /**
   * Changing this drops every measurement, because the shape they described no
   * longer exists. Pass the shell mode where the container can change shape.
   */
  shapeKey: string | number = 'fixed'
): SelectionSlide {
  const offset = useSharedValue(0);
  const extent = useSharedValue(0);
  const presence = useSharedValue(0);
  const state = useRef<SlideState>({
    rects: new Map(),
    activeKey,
    placed: false,
    travellingUntil: 0,
  });

  // Declared first so a simultaneous shape-and-selection change clears the old
  // geometry before anything is placed against it.
  useEffect(() => {
    const current = state.current;
    current.rects.clear();
    current.placed = false;
    current.travellingUntil = 0;
    // Hidden rather than left standing: one frame of the mark at an offset from
    // a layout that no longer exists is exactly the wrong thing to highlight.
    presence.value = 0;
  }, [shapeKey, presence]);

  useEffect(() => {
    state.current.activeKey = activeKey;
    placeMark(state.current, offset, extent, presence, 'select');
  }, [activeKey, offset, extent, presence]);

  const measure = (key: string) => (event: LayoutChangeEvent) => {
    const { x, y, width, height } = event.nativeEvent.layout;
    const rect: ItemRect =
      axis === 'horizontal' ? { offset: x, extent: width } : { offset: y, extent: height };
    // A pass that sized the item at nothing is not a measurement — see
    // `isMeasured`. Recording it would collapse the mark's box and throw the
    // centred bar half a tab to the left until a real one arrived.
    if (!isMeasured(rect)) return;
    const current = state.current;
    const previous = current.rects.get(key);
    if (previous && previous.offset === rect.offset && previous.extent === rect.extent) {
      return;
    }
    current.rects.set(key, rect);
    // Only the selected item moving needs anything done about it; the rest are
    // being recorded against the moment they are selected.
    if (key === current.activeKey) {
      placeMark(current, offset, extent, presence, 'correct');
    }
  };

  return { measure, offset, extent, presence };
}
