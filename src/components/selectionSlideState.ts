import { isMeasured, resolveMark, type ItemRect } from './selectionSlideMath.ts';

export type SelectionAxis = 'horizontal' | 'vertical';

/** Measurements belong to one mounted row/column, not just an item key. */
export interface SelectionSurface {
  axis: SelectionAxis;
  shapeKey: string | number;
  generation: number;
  rects: Map<string, ItemRect>;
}

export function createSelectionSurface(
  axis: SelectionAxis,
  shapeKey: string | number,
  generation = 0,
): SelectionSurface {
  return { axis, shapeKey, generation, rects: new Map() };
}

export interface SelectionSlideState {
  surface: SelectionSurface | null;
  activeKey: string | null;
  placed: boolean;
  travellingUntil: number;
}

export function createSelectionSlideState(): SelectionSlideState {
  return { surface: null, activeKey: null, placed: false, travellingUntil: 0 };
}

export type SelectionPlacement =
  | { kind: 'hide'; immediate: boolean }
  | { kind: 'place'; rect: ItemRect; animate: boolean; reveal: boolean };

function placeSelection(
  state: SelectionSlideState,
  selecting: boolean,
  now: number,
  duration: number,
): SelectionPlacement {
  const rect = state.surface && resolveMark(state.surface.rects, state.activeKey);
  if (!rect) {
    state.placed = false;
    state.travellingUntil = 0;
    return { kind: 'hide', immediate: false };
  }

  const reveal = !state.placed;
  const animate = !reveal && (selecting || now < state.travellingUntil);
  state.placed = true;
  // Retargeting gets a full duration; subsequent corrections respect that deadline.
  state.travellingUntil = animate ? now + duration : 0;
  return { kind: 'place', rect, animate, reveal };
}

/** Commit geometry and selection together, preserving any early measurements. */
export function commitSelection(
  state: SelectionSlideState,
  surface: SelectionSurface,
  activeKey: string | null,
  now: number,
  duration: number,
): SelectionPlacement | null {
  const changedSurface = state.surface !== surface;
  if (!changedSurface && state.activeKey === activeKey) return null;
  state.surface = surface;
  state.activeKey = activeKey;
  if (changedSurface) {
    state.placed = false;
    state.travellingUntil = 0;
  }
  const placement = placeSelection(state, !changedSurface, now, duration);
  return changedSurface && placement.kind === 'hide'
    ? { kind: 'hide', immediate: true }
    : placement;
}

export function measureSelection(
  state: SelectionSlideState,
  surface: SelectionSurface,
  key: string,
  rect: ItemRect,
  now: number,
  duration: number,
): SelectionPlacement | null {
  if (!isMeasured(rect)) return null;
  const previous = surface.rects.get(key);
  surface.rects.set(key, rect);
  // Early events may populate the next surface before its layout effect.
  // Late events only touch their retired surface, never the current mark.
  if (state.surface !== surface || state.activeKey !== key) return null;
  if (state.placed && previous?.offset === rect.offset && previous.extent === rect.extent) {
    return null;
  }
  return placeSelection(state, false, now, duration);
}

export function detachSelection(state: SelectionSlideState): void {
  state.surface = null;
  state.placed = false;
  state.travellingUntil = 0;
}
