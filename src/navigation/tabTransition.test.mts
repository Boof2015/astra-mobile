import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TAB_PRESS_SWALLOW_MS,
  TAB_SCENE_ANIMATION,
  TAB_ROUTE_ORDER,
  TAB_SCENE_OPACITY_RANGE,
  TAB_SCENE_PROGRESS_RANGE,
  TAB_SCENE_STYLE_INTERPOLATOR,
  TAB_SCENE_TRANSLATION_DP,
  TAB_SCENE_TRANSLATION_RANGE,
  TAB_STACK_RESET_DELAY_MS,
  TAB_TRANSITION_SETTLE_MS,
  TAB_TRANSITION_SPEC,
  resolveTabSceneMotion,
} from './tabTransition.ts';

test('tab scenes use a cross-fade and retain the short settle guard', () => {
  assert.equal(TAB_SCENE_ANIMATION, 'fade');
  assert.equal(TAB_TRANSITION_SETTLE_MS, 160);
  assert.equal(TAB_PRESS_SWALLOW_MS, TAB_TRANSITION_SETTLE_MS + 30);
});

test('tab scenes drift 20dp in the same direction as navigator order', () => {
  const calls: { inputRange: number[]; outputRange: number[] }[] = [];
  const progress = {
    interpolate(config: { inputRange: number[]; outputRange: number[] }) {
      calls.push(config);
      return 0;
    },
  };

  TAB_SCENE_STYLE_INTERPOLATOR({ current: { progress } } as never);

  assert.equal(TAB_SCENE_TRANSLATION_DP, 20);
  assert.deepEqual(calls, [
    {
      inputRange: [...TAB_SCENE_PROGRESS_RANGE],
      outputRange: [...TAB_SCENE_OPACITY_RANGE],
    },
    {
      inputRange: [...TAB_SCENE_PROGRESS_RANGE],
      outputRange: [...TAB_SCENE_TRANSLATION_RANGE],
    },
  ]);
  assert.deepEqual(TAB_SCENE_TRANSLATION_RANGE, [-20, 0, 20]);
});

test('the hidden Stats route inherits Home-owned transition order', () => {
  assert.deepEqual(TAB_ROUTE_ORDER, ['index', 'stats', 'library', 'eq', 'settings']);
  assert.equal(TAB_ROUTE_ORDER.indexOf('stats') + 1, TAB_ROUTE_ORDER.indexOf('library'));
});

test('Reduced Motion removes both the scene interpolator and transition spec', () => {
  assert.deepEqual(resolveTabSceneMotion(true), { animation: 'none' });
  assert.equal(resolveTabSceneMotion(false).animation, 'fade');
  assert.equal(resolveTabSceneMotion(false).sceneStyleInterpolator, TAB_SCENE_STYLE_INTERPOLATOR);
  assert.equal(resolveTabSceneMotion(false).transitionSpec, TAB_TRANSITION_SPEC);
});

test('a left-behind stack is rewound after the fade but before the next press is accepted', () => {
  assert.ok(TAB_STACK_RESET_DELAY_MS > TAB_TRANSITION_SETTLE_MS);
  assert.ok(TAB_STACK_RESET_DELAY_MS < TAB_PRESS_SWALLOW_MS);
});

test('tab fade uses a critically damped native spring with no overshoot', () => {
  assert.equal(TAB_TRANSITION_SPEC.animation, 'spring');
  assert.equal(TAB_TRANSITION_SPEC.config.overshootClamping, true);
  const criticalDamping =
    2 * Math.sqrt(TAB_TRANSITION_SPEC.config.stiffness * TAB_TRANSITION_SPEC.config.mass);
  assert.equal(TAB_TRANSITION_SPEC.config.damping, criticalDamping);
});
