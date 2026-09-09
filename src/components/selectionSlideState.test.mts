import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commitSelection,
  createSelectionSlideState,
  createSelectionSurface,
  detachSelection,
  measureSelection,
  type SelectionPlacement,
} from './selectionSlideState.ts';

const DURATION = 160;
const A = { offset: 0, extent: 80 };
const B = { offset: 80, extent: 80 };
const C = { offset: 160, extent: 80 };
const cut = (rect: typeof A): SelectionPlacement => ({ kind: 'place', rect, animate: false, reveal: true });
const slide = (rect: typeof A): SelectionPlacement => ({ kind: 'place', rect, animate: true, reveal: false });

function fixture() {
  const state = createSelectionSlideState();
  const surface = createSelectionSurface('horizontal', 'row');
  const commit = (key: string | null, now = 0) => commitSelection(state, surface, key, now, DURATION);
  const measure = (key: string, rect: typeof A, now = 0) => measureSelection(state, surface, key, rect, now, DURATION);
  return { state, surface, commit, measure };
}

for (const layoutFirst of [true, false]) {
  test(`initial placement survives layout ${layoutFirst ? 'before' : 'after'} the first commit`, () => {
    const { state, surface, commit, measure } = fixture();
    if (layoutFirst) {
      assert.equal(measure('a', A), null);
      assert.deepEqual(commit('a'), cut(A));
    } else {
      assert.deepEqual(commit('a'), { kind: 'hide', immediate: true });
      assert.deepEqual(measure('a', A), cut(A));
    }
    assert.equal(commit('a', 500), null);
    assert.deepEqual(surface.rects.get('a'), A);
    assert.equal(state.placed, true);
  });
}

test('selection and geometry commit together on rotation with the same selected key', () => {
  const { state, surface, commit, measure } = fixture();
  measure('a', A);
  commit('a');
  const rail = createSelectionSurface('vertical', 'row', 1);
  assert.deepEqual(commitSelection(state, rail, 'a', 10, DURATION), { kind: 'hide', immediate: true });
  assert.equal(measureSelection(state, surface, 'a', C, 11, DURATION), null);
  assert.deepEqual(measureSelection(state, rail, 'a', { offset: 52, extent: 52 }, 12, DURATION), cut({ offset: 52, extent: 52 }));
});

test('early measurements of a new shape survive a simultaneous selection change', () => {
  const { state, commit, measure } = fixture();
  measure('a', A);
  commit('a');
  const next = createSelectionSurface('horizontal', 'split', 1);
  assert.equal(measureSelection(state, next, 'b', B, 10, DURATION), null);
  assert.deepEqual(commitSelection(state, next, 'b', 11, DURATION), cut(B));
});

test('A -> B -> A ignores callbacks from the original A surface', () => {
  const { state, surface, commit, measure } = fixture();
  measure('a', A);
  commit('a');
  commitSelection(state, createSelectionSurface('vertical', 'rail', 1), 'a', 10, DURATION);
  const restored = createSelectionSurface('horizontal', 'row', 2);
  commitSelection(state, restored, 'a', 20, DURATION);
  assert.equal(measureSelection(state, surface, 'a', C, 21, DURATION), null);
  assert.equal(restored.rects.size, 0);
  assert.deepEqual(measureSelection(state, restored, 'a', A, 22, DURATION), cut(A));
});

test('rapid selection changes always target the latest committed key', () => {
  const { state, commit, measure } = fixture();
  measure('a', A);
  measure('b', B);
  measure('c', C);
  commit('a');
  assert.deepEqual(commit('b', 10), slide(B));
  assert.deepEqual(commit('c', 20), slide(C));
  assert.equal(measure('b', { offset: 75, extent: 85 }, 30), null);
  assert.equal(state.activeKey, 'c');
  assert.deepEqual(commit('a', 40), slide(A));
});

test('an unchanged commit or duplicate layout does not restart a selection animation', () => {
  const { state, commit, measure } = fixture();
  measure('a', A);
  measure('b', B);
  commit('a');
  commit('b', 10);
  assert.equal(commit('b', 100), null);
  assert.equal(measure('b', B, 110), null);
  assert.equal(state.travellingUntil, 170);
});

test('selected label expansion retargets the animation for its actual remaining lifetime', () => {
  const { state, commit, measure } = fixture();
  measure('a', A);
  measure('b', B);
  commit('a');
  commit('b', 10);
  assert.deepEqual(measure('b', { offset: 70, extent: 160 }, 150), slide({ offset: 70, extent: 160 }));
  assert.equal(state.travellingUntil, 310);
  assert.deepEqual(measure('b', { offset: 72, extent: 158 }, 200), slide({ offset: 72, extent: 158 }));
  assert.equal(state.travellingUntil, 360);
});

test('layout corrections after settling cut to the selected item without travelling', () => {
  const { commit, measure } = fixture();
  measure('a', A);
  commit('a');
  assert.deepEqual(measure('a', B, 500), { kind: 'place', rect: B, animate: false, reveal: false });
});

test('toolbar entry hides the mark and exit requires fresh navigation measurements', () => {
  const { state, surface, commit, measure } = fixture();
  measure('b', B);
  commit('b');
  const toolbar = createSelectionSurface('horizontal', 'selection', 1);
  assert.deepEqual(commitSelection(state, toolbar, null, 10, DURATION), { kind: 'hide', immediate: true });
  assert.equal(measureSelection(state, surface, 'b', C, 11, DURATION), null);
  const restored = createSelectionSurface('horizontal', 'row', 2);
  assert.deepEqual(commitSelection(state, restored, 'b', 20, DURATION), { kind: 'hide', immediate: true });
  assert.deepEqual(measureSelection(state, restored, 'b', B, 21, DURATION), cut(B));
});

test('an unknown or unmeasured selection hides, then cuts when measurement arrives', () => {
  const { commit, measure } = fixture();
  measure('a', A);
  commit('a');
  assert.deepEqual(commit('b', 10), { kind: 'hide', immediate: false });
  assert.deepEqual(measure('b', B, 11), cut(B));
  assert.deepEqual(commit(null, 12), { kind: 'hide', immediate: false });
  assert.deepEqual(commit('b', 13), cut(B));
});

test('zero, negative and nonfinite measurements cannot replace a valid rect', () => {
  const { state, surface, commit, measure } = fixture();
  measure('a', A);
  commit('a');
  for (const rect of [
    { offset: 0, extent: 0 }, { offset: 0, extent: -1 },
    { offset: NaN, extent: 80 }, { offset: Infinity, extent: 80 },
    { offset: 0, extent: Infinity }, { offset: 0, extent: NaN },
  ]) assert.equal(measure('a', rect, 100), null);
  assert.deepEqual(surface.rects.get('a'), A);
  assert.equal(state.placed, true);
});

test('unmount rejects late placement and an effect replay preserves recorded layout', () => {
  const { state, commit, measure } = fixture();
  measure('a', A);
  commit('a');
  detachSelection(state);
  assert.equal(measure('a', B, 10), null);
  assert.deepEqual(commit('a', 11), cut(B));
});
