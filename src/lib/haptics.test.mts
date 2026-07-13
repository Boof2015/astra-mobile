import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  HapticCapabilities,
  HapticPrimitive,
} from '../../modules/astra-haptics/types.ts';
import {
  HAPTIC_DEFINITIONS,
  hapticForToggle,
  type HapticEvent,
} from './hapticCatalog.ts';
import {
  HAPTIC_GAPS_MS,
  HAPTIC_RECIPE_GROUPS,
  HAPTIC_RECIPE_SECTIONS,
  canPlayHapticRecipe,
  hapticRecipeCandidate,
  unsupportedRecipePrimitives,
  validateHapticRecipe,
} from './hapticRecipes.ts';

const expectedSemantics: Record<HapticEvent, string> = {
  toggleOn: 'toggle-on',
  toggleOff: 'toggle-off',
  selection: 'segment-tick',
  frequentStep: 'segment-frequent-tick',
  threshold: 'gesture-start',
  thresholdExit: 'gesture-end',
  action: 'virtual-key',
  dragStart: 'drag-start',
  dragEnd: 'gesture-end',
  queueLift: 'drag-start',
  queueDrop: 'gesture-end',
  pullLatch: 'gesture-start',
  pullRelease: 'gesture-end',
  modeCycle: 'segment-tick',
  holdAccepted: 'gesture-start',
  confirm: 'confirm',
  reject: 'reject',
};

const expectedFallbacks: Record<HapticEvent, string> = {
  toggleOn: 'selection',
  toggleOff: 'selection',
  selection: 'selection',
  frequentStep: 'selection',
  threshold: 'lightImpact',
  thresholdExit: 'lightImpact',
  action: 'lightImpact',
  dragStart: 'mediumImpact',
  dragEnd: 'lightImpact',
  queueLift: 'mediumImpact',
  queueDrop: 'lightImpact',
  pullLatch: 'lightImpact',
  pullRelease: 'lightImpact',
  modeCycle: 'selection',
  holdAccepted: 'mediumImpact',
  confirm: 'success',
  reject: 'error',
};

const primitives: HapticPrimitive[] = [
  'click',
  'thud',
  'spin',
  'quickRise',
  'slowRise',
  'quickFall',
  'tick',
  'lowTick',
];

function capabilities(
  supported: HapticPrimitive[] = primitives
): HapticCapabilities {
  const supportedSet = new Set(supported);
  return {
    moduleAvailable: true,
    apiLevel: 36,
    hasVibrator: true,
    hasAmplitudeControl: true,
    touchFeedbackEnabled: true,
    primitives: Object.fromEntries(
      primitives.map((primitive) => [
        primitive,
        { supported: supportedSet.has(primitive), durationMs: supportedSet.has(primitive) ? 12 : 0 },
      ])
    ) as HapticCapabilities['primitives'],
  };
}

test('maps every application event to an Android semantic haptic', () => {
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(HAPTIC_DEFINITIONS).map(([event, definition]) => [
        event,
        definition.semantic,
      ])
    ),
    expectedSemantics
  );
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(HAPTIC_DEFINITIONS).map(([event, definition]) => [
        event,
        definition.fallback,
      ])
    ),
    expectedFallbacks
  );
  assert.equal(hapticForToggle(true), 'toggleOn');
  assert.equal(hapticForToggle(false), 'toggleOff');
});

test('keeps all tuning candidates within the native recipe contract', () => {
  assert.equal(HAPTIC_RECIPE_SECTIONS.length, 6);
  assert.equal(HAPTIC_RECIPE_GROUPS.length, 16);
  assert.deepEqual(
    HAPTIC_RECIPE_SECTIONS.flatMap((section) => section.groups),
    HAPTIC_RECIPE_GROUPS
  );
  for (const group of HAPTIC_RECIPE_GROUPS) {
    assert.equal(group.candidates.length, group.id.startsWith('timing') ? 4 : 2);
    for (const candidate of group.candidates) {
      assert.equal(validateHapticRecipe(candidate.steps), true, candidate.id);
    }
  }
});

test('calibrates the same primitive pairs at four explicit pauses', () => {
  const timingSection = HAPTIC_RECIPE_SECTIONS.find((section) => section.id === 'timing');
  assert.ok(timingSection);
  assert.equal(timingSection.groups.length, 3);
  for (const group of timingSection.groups) {
    assert.deepEqual(
      group.candidates.map((candidate) => candidate.steps.map((step) => step.delayMs)),
      [[0, 0], [0, 15], [0, 30], [0, 45]]
    );
  }
  assert.deepEqual(
    timingSection.groups.map((group) => group.leadingCandidateId),
    ['timingRiseClick45', 'timingLift30', 'timingSeat30']
  );
  assert.deepEqual(HAPTIC_GAPS_MS, {
    riseLock: 45,
    lift: 30,
    seat: 30,
    neutral: 30,
  });
});

test('records the retimed vote and keeps every composition articulated', () => {
  const selectedCandidates: Record<string, string | undefined> = {
    queueLift: 'queueLiftB',
    queueDrop: 'queueDropA',
    pullLatch: 'pullLatchB',
    pullRelease: 'pullReleaseA',
    toggleOn: 'toggleOnA',
    toggleOff: 'toggleOffB',
    dragPickup: 'dragPickupB',
    dragPlacement: 'dragPlacementA',
    confirm: 'confirmA',
    reject: 'rejectB',
    thresholdExit: 'thresholdExitA',
    modeCycle: 'modeCycleA',
    holdAccepted: 'holdAcceptedA',
  };
  for (const group of HAPTIC_RECIPE_GROUPS) {
    if (group.id.startsWith('timing')) continue;
    assert.equal(group.leadingCandidateId, selectedCandidates[group.id], group.id);
    assert.equal(
      group.selectionStatus,
      'selected',
      group.id
    );
    for (const candidate of group.candidates) {
      if (candidate.steps.length < 2) continue;
      assert.equal(
        candidate.steps.slice(1).every((step) => (step.delayMs ?? 0) > 0),
        true,
        candidate.id
      );
    }
  }
});

test('points every production composition at its selected catalog recipe', () => {
  for (const [event, definition] of Object.entries(HAPTIC_DEFINITIONS)) {
    if (!definition.recipeId) continue;
    const candidate = hapticRecipeCandidate(definition.recipeId);
    assert.ok(candidate, event);
    const group = HAPTIC_RECIPE_GROUPS.find((item) =>
      item.candidates.some((itemCandidate) => itemCandidate.id === definition.recipeId)
    );
    assert.equal(group?.leadingCandidateId, definition.recipeId, event);
    assert.equal(group?.selectionStatus, 'selected', event);
  }
});

test('offers two articulated reject rhythms for a tactile no', () => {
  const reject = HAPTIC_RECIPE_GROUPS.find((group) => group.id === 'reject');
  assert.ok(reject);
  assert.deepEqual(
    reject.candidates.map((candidate) => ({
      primitives: candidate.steps.map((step) => step.primitive),
      delays: candidate.steps.map((step) => step.delayMs),
    })),
    [
      { primitives: ['click', 'click'], delays: [0, 45] },
      { primitives: ['click', 'lowTick'], delays: [0, 45] },
    ]
  );
});

test('rejects invalid scale, delay, and empty recipes', () => {
  assert.equal(validateHapticRecipe([]), false);
  assert.equal(validateHapticRecipe([{ primitive: 'click', scale: 0 }]), false);
  assert.equal(validateHapticRecipe([{ primitive: 'click', scale: 1.01 }]), false);
  assert.equal(
    validateHapticRecipe([{ primitive: 'click', scale: 0.5, delayMs: -1 }]),
    false
  );
  assert.equal(
    validateHapticRecipe([{ primitive: 'click', scale: 0.5, delayMs: 1.5 }]),
    false
  );
});

test('requires every primitive and the system touch-feedback gate', () => {
  const queueLiftGroup = HAPTIC_RECIPE_GROUPS.find((group) => group.id === 'queueLift');
  assert.ok(queueLiftGroup);
  const queueLift = queueLiftGroup.candidates[0].steps;
  assert.equal(canPlayHapticRecipe(queueLift, capabilities()), true);
  assert.deepEqual(unsupportedRecipePrimitives(queueLift, capabilities(['quickRise'])), [
    'lowTick',
  ]);
  assert.equal(canPlayHapticRecipe(queueLift, capabilities(['quickRise'])), false);

  const touchDisabled = { ...capabilities(), touchFeedbackEnabled: false };
  assert.equal(canPlayHapticRecipe(queueLift, touchDisabled), false);
  const moduleMissing = { ...capabilities(), moduleAvailable: false };
  assert.equal(canPlayHapticRecipe(queueLift, moduleMissing), false);
});
