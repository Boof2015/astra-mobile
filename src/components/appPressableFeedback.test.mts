import assert from 'node:assert/strict';
import test from 'node:test';
import {
  composePressedStyle,
  resolveFeedbackCorners,
  resolvePressFeedback,
} from './appPressableFeedback.ts';

test('maps pressed feedback variants without changing idle or disabled targets', () => {
  assert.deepEqual(resolvePressFeedback('surface', true, false), { overlay: 'behind', opacity: null });
  assert.deepEqual(resolvePressFeedback('tile', true, false), { overlay: 'above', opacity: null });
  assert.deepEqual(resolvePressFeedback('control', true, false), { overlay: null, opacity: 0.74 });
  assert.deepEqual(resolvePressFeedback('accent', true, false), { overlay: null, opacity: 0.88 });
  assert.deepEqual(resolvePressFeedback('control', false, false), { overlay: null, opacity: null });
  assert.deepEqual(resolvePressFeedback('accent', true, true), { overlay: null, opacity: null });
  assert.deepEqual(resolvePressFeedback('none', true, false), { overlay: null, opacity: null });
});

test('resolves per-corner radii and lets the explicit radius override them', () => {
  assert.deepEqual(
    resolveFeedbackCorners({ borderRadius: 12, borderTopLeftRadius: 4 }),
    {
      borderTopLeftRadius: 4,
      borderTopRightRadius: 12,
      borderBottomLeftRadius: 12,
      borderBottomRightRadius: 12,
    },
  );
  assert.deepEqual(resolveFeedbackCorners({ borderRadius: 12 }, 8), {
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
  });
});

test('preserves caller styles while appending pressed opacity', () => {
  const callerStyle = [{ flex: 1 }, { opacity: 0.5 }];
  const decision = resolvePressFeedback('control', true, false);
  assert.deepEqual(composePressedStyle(callerStyle, decision), [callerStyle, { opacity: 0.74 }]);
  assert.equal(
    composePressedStyle(callerStyle, resolvePressFeedback('surface', false, false)),
    callerStyle,
  );
});
