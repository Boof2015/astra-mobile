import { useLayoutEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { cancelAnimation, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { motion } from '@/theme/motion';
import {
  commitSelection,
  createSelectionSlideState,
  createSelectionSurface,
  detachSelection,
  measureSelection,
  type SelectionAxis,
  type SelectionPlacement,
} from './selectionSlideState.ts';

export type { SelectionAxis } from './selectionSlideState.ts';

export interface SelectionSlide {
  /** Key the measured row/column with this so new geometry always reports layout. */
  surfaceKey: number;
  measure: (key: string) => (event: LayoutChangeEvent) => void;
  offset: SharedValue<number>;
  extent: SharedValue<number>;
  presence: SharedValue<number>;
}

function applyPlacement(
  placement: SelectionPlacement | null,
  offset: SharedValue<number>,
  extent: SharedValue<number>,
  presence: SharedValue<number>,
) {
  if (!placement) return;
  if (placement.kind === 'hide') {
    cancelAnimation(offset);
    cancelAnimation(extent);
    presence.value = placement.immediate ? 0 : withTiming(0, motion.quick);
    return;
  }
  const { rect, animate, reveal } = placement;
  offset.value = animate ? withTiming(rect.offset, motion.quick) : rect.offset;
  extent.value = animate ? withTiming(rect.extent, motion.quick) : rect.extent;
  if (reveal) presence.value = withTiming(1, motion.quick);
}

/** Slide between selections; cut to fresh geometry on mount or a shape change. */
export function useSelectionSlide(
  activeKey: string | null,
  axis: SelectionAxis,
  shapeKey: string | number = 'fixed',
): SelectionSlide {
  const offset = useSharedValue(0);
  const extent = useSharedValue(0);
  const presence = useSharedValue(0);
  const state = useRef(createSelectionSlideState());
  const [surface, setSurface] = useState(() => createSelectionSurface(axis, shapeKey));

  // Adjust this component's state before React commits its children. Unlike an
  // effect that clears a shared map, this cannot erase fresh onLayout events.
  // Each callback closes over its own surface, including across A -> B -> A.
  if (surface.axis !== axis || surface.shapeKey !== shapeKey) {
    setSurface(createSelectionSurface(axis, shapeKey, surface.generation + 1));
  }

  useLayoutEffect(() => {
    applyPlacement(
      commitSelection(state.current, surface, activeKey, Date.now(), motion.quick.duration),
      offset, extent, presence,
    );
  }, [activeKey, surface, offset, extent, presence]);

  useLayoutEffect(() => {
    const current = state.current;
    return () => {
      detachSelection(current);
      cancelAnimation(offset);
      cancelAnimation(extent);
      cancelAnimation(presence);
    };
  }, [offset, extent, presence]);

  const measure = (key: string) => (event: LayoutChangeEvent) => {
    const { x, y, width, height } = event.nativeEvent.layout;
    const rect = surface.axis === 'horizontal'
      ? { offset: x, extent: width }
      : { offset: y, extent: height };
    applyPlacement(
      measureSelection(state.current, surface, key, rect, Date.now(), motion.quick.duration),
      offset, extent, presence,
    );
  };

  return { surfaceKey: surface.generation, measure, offset, extent, presence };
}
