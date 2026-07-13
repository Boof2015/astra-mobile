import type {
  HapticCapabilities,
  HapticCompositionStep,
  HapticPrimitive,
} from '../../modules/astra-haptics/types';

export interface HapticRecipeCandidate {
  id: string;
  label: string;
  steps: readonly HapticCompositionStep[];
}

export interface HapticRecipeGroup {
  id: string;
  label: string;
  description: string;
  candidates: readonly HapticRecipeCandidate[];
  leadingCandidateId?: string;
  selectionStatus?: 'selected' | 'provisional';
}

export interface HapticRecipeSection {
  id: 'timing' | 'signatures' | 'state' | 'manipulation' | 'outcome' | 'gesture';
  label: string;
  description: string;
  groups: readonly HapticRecipeGroup[];
}

export const HAPTIC_GAPS_MS = {
  riseLock: 45,
  lift: 30,
  seat: 30,
  neutral: 30,
} as const;

const recipe = (
  ...steps: [HapticPrimitive, number, number?][]
): readonly HapticCompositionStep[] =>
  steps.map(([primitive, scale, gapMs], index) => ({
    primitive,
    scale,
    delayMs: index === 0 ? 0 : (gapMs ?? 0),
  }));

const timedRecipe = (
  first: [HapticPrimitive, number],
  second: [HapticPrimitive, number],
  gapMs: number
): readonly HapticCompositionStep[] => [
  { primitive: first[0], scale: first[1], delayMs: 0 },
  { primitive: second[0], scale: second[1], delayMs: gapMs },
];

const timingCandidates = (
  id: string,
  first: [HapticPrimitive, number],
  second: [HapticPrimitive, number]
): readonly HapticRecipeCandidate[] => [
  { id: `${id}0`, label: '0 ms · fused', steps: timedRecipe(first, second, 0) },
  { id: `${id}15`, label: '15 ms · subtle', steps: timedRecipe(first, second, 15) },
  { id: `${id}30`, label: '30 ms · clear', steps: timedRecipe(first, second, 30) },
  { id: `${id}45`, label: '45 ms · two beats', steps: timedRecipe(first, second, 45) },
];

export const HAPTIC_RECIPE_SECTIONS: readonly HapticRecipeSection[] = [
  {
    id: 'timing',
    label: 'TIMING CALIBRATION',
    description: 'Selected articulation: 45 ms for rise + lock, 30 ms for lift and weighted seat.',
    groups: [
      {
        id: 'timingRiseClick',
        label: 'Rise + lock',
        description: 'Quick rise (.55), then click (.65). Closest to toggle on.',
        leadingCandidateId: 'timingRiseClick45',
        candidates: timingCandidates(
          'timingRiseClick',
          ['quickRise', 0.55],
          ['click', 0.65]
        ),
      },
      {
        id: 'timingLift',
        label: 'Lift articulation',
        description: 'Low tick (.55), then quick rise (.65). Closest to drag pickup.',
        leadingCandidateId: 'timingLift30',
        candidates: timingCandidates(
          'timingLift',
          ['lowTick', 0.55],
          ['quickRise', 0.65]
        ),
      },
      {
        id: 'timingSeat',
        label: 'Weighted seat',
        description: 'Click (.70), then thud (.40). Closest to drag placement.',
        leadingCandidateId: 'timingSeat30',
        candidates: timingCandidates(
          'timingSeat',
          ['click', 0.7],
          ['thud', 0.4]
        ),
      },
    ],
  },
  {
    id: 'signatures',
    label: 'INTERACTION SIGNATURES',
    description: 'Retimed with the selected articulation. Revote all four candidates.',
    groups: [
      {
        id: 'queueLift',
        label: 'Queue lift',
        description: 'The row detaches from the queue.',
        leadingCandidateId: 'queueLiftB',
        selectionStatus: 'selected',
        candidates: [
          { id: 'queueLiftA', label: 'A · weighted lift', steps: recipe(['lowTick', 0.7], ['quickRise', 0.5, HAPTIC_GAPS_MS.lift]) },
          { id: 'queueLiftB', label: 'B · crisp lift', steps: recipe(['quickRise', 0.7], ['click', 0.5, HAPTIC_GAPS_MS.riseLock]) },
        ],
      },
      {
        id: 'queueDrop',
        label: 'Queue drop',
        description: 'The row seats into its new position.',
        leadingCandidateId: 'queueDropA',
        selectionStatus: 'selected',
        candidates: [
          { id: 'queueDropA', label: 'A · click + weight', steps: recipe(['click', 0.7], ['thud', 0.5, HAPTIC_GAPS_MS.seat]) },
          { id: 'queueDropB', label: 'B · falling seat', steps: recipe(['quickFall', 0.7], ['click', 0.5, HAPTIC_GAPS_MS.neutral]) },
        ],
      },
      {
        id: 'pullLatch',
        label: 'Pull latch',
        description: 'Pull-to-search crosses its armed threshold.',
        leadingCandidateId: 'pullLatchB',
        selectionStatus: 'selected',
        candidates: [
          { id: 'pullLatchA', label: 'A · clean latch', steps: recipe(['tick', 0.7]) },
          { id: 'pullLatchB', label: 'B · weighted latch', steps: recipe(['lowTick', 0.5], ['click', 0.5, HAPTIC_GAPS_MS.neutral]) },
        ],
      },
      {
        id: 'pullRelease',
        label: 'Pull release',
        description: 'Search opens after the armed pull releases.',
        leadingCandidateId: 'pullReleaseA',
        selectionStatus: 'selected',
        candidates: [
          { id: 'pullReleaseA', label: 'A · rise + release', steps: recipe(['quickRise', 0.5], ['click', 0.5, HAPTIC_GAPS_MS.riseLock]) },
          { id: 'pullReleaseB', label: 'B · clean rise', steps: recipe(['quickRise', 0.7]) },
        ],
      },
    ],
  },
  {
    id: 'state',
    label: 'STATE CHANGES',
    description: 'Directional signatures for controls entering and leaving an active state.',
    groups: [
      {
        id: 'toggleOn',
        label: 'Toggle on',
        description: 'A switch or binary control engages.',
        leadingCandidateId: 'toggleOnA',
        selectionStatus: 'selected',
        candidates: [
          { id: 'toggleOnA', label: 'A · precise rise', steps: recipe(['quickRise', 0.55], ['click', 0.65, HAPTIC_GAPS_MS.riseLock]) },
          { id: 'toggleOnB', label: 'B · weighted rise', steps: recipe(['lowTick', 0.5], ['quickRise', 0.6, HAPTIC_GAPS_MS.lift], ['click', 0.35, HAPTIC_GAPS_MS.riseLock]) },
        ],
      },
      {
        id: 'toggleOff',
        label: 'Toggle off',
        description: 'A switch or binary control disengages.',
        leadingCandidateId: 'toggleOffB',
        selectionStatus: 'selected',
        candidates: [
          { id: 'toggleOffA', label: 'A · clean fall', steps: recipe(['click', 0.5], ['quickFall', 0.65, HAPTIC_GAPS_MS.neutral]) },
          { id: 'toggleOffB', label: 'B · weighted fall', steps: recipe(['quickFall', 0.6], ['lowTick', 0.55, HAPTIC_GAPS_MS.neutral]) },
        ],
      },
    ],
  },
  {
    id: 'manipulation',
    label: 'MANIPULATION',
    description: 'Pickup and placement textures for direct manipulation.',
    groups: [
      {
        id: 'dragPickup',
        label: 'Drag pickup',
        description: 'An item lifts from rest and begins following the finger.',
        leadingCandidateId: 'dragPickupB',
        selectionStatus: 'selected',
        candidates: [
          { id: 'dragPickupA', label: 'A · lift from rest', steps: recipe(['lowTick', 0.55], ['quickRise', 0.65, HAPTIC_GAPS_MS.lift]) },
          { id: 'dragPickupB', label: 'B · sprung pickup', steps: recipe(['quickRise', 0.7], ['click', 0.45, HAPTIC_GAPS_MS.riseLock]) },
        ],
      },
      {
        id: 'dragPlacement',
        label: 'Drag placement',
        description: 'An item lands at its destination.',
        leadingCandidateId: 'dragPlacementA',
        selectionStatus: 'selected',
        candidates: [
          { id: 'dragPlacementA', label: 'A · weighted seat', steps: recipe(['click', 0.7], ['thud', 0.4, HAPTIC_GAPS_MS.seat]) },
          { id: 'dragPlacementB', label: 'B · soft landing', steps: recipe(['quickFall', 0.55], ['lowTick', 0.6, HAPTIC_GAPS_MS.neutral]) },
        ],
      },
    ],
  },
  {
    id: 'outcome',
    label: 'OUTCOMES',
    description: 'Distinct positive and blocked endings without imitating notification buzzes.',
    groups: [
      {
        id: 'confirm',
        label: 'Confirm',
        description: 'A meaningful operation completes successfully.',
        leadingCandidateId: 'confirmA',
        selectionStatus: 'selected',
        candidates: [
          { id: 'confirmA', label: 'A · rising resolve', steps: recipe(['quickRise', 0.45], ['click', 0.75, HAPTIC_GAPS_MS.riseLock]) },
          { id: 'confirmB', label: 'B · crisp resolve', steps: recipe(['tick', 0.5], ['click', 0.8, HAPTIC_GAPS_MS.neutral]) },
        ],
      },
      {
        id: 'reject',
        label: 'Reject',
        description: 'An attempted operation is blocked, expressed as a tactile “no.”',
        leadingCandidateId: 'rejectB',
        selectionStatus: 'selected',
        candidates: [
          { id: 'rejectA', label: 'A · even double stop', steps: recipe(['click', 0.7], ['click', 0.7, HAPTIC_GAPS_MS.riseLock]) },
          { id: 'rejectB', label: 'B · descending no', steps: recipe(['click', 0.75], ['lowTick', 0.7, HAPTIC_GAPS_MS.riseLock]) },
        ],
      },
    ],
  },
  {
    id: 'gesture',
    label: 'GESTURE SHAPES',
    description: 'Less common textures reserved for interactions whose motion matches the primitive.',
    groups: [
      {
        id: 'thresholdExit',
        label: 'Threshold exit',
        description: 'A gesture backs out of an armed state before release.',
        leadingCandidateId: 'thresholdExitA',
        selectionStatus: 'selected',
        candidates: [
          { id: 'thresholdExitA', label: 'A · gentle retreat', steps: recipe(['quickFall', 0.45]) },
          { id: 'thresholdExitB', label: 'B · weighted retreat', steps: recipe(['lowTick', 0.45], ['quickFall', 0.5, HAPTIC_GAPS_MS.neutral]) },
        ],
      },
      {
        id: 'modeCycle',
        label: 'Mode cycle',
        description: 'A control rotates to the next mode, such as repeat state.',
        leadingCandidateId: 'modeCycleA',
        selectionStatus: 'selected',
        candidates: [
          { id: 'modeCycleA', label: 'A · spin + lock', steps: recipe(['spin', 0.5], ['click', 0.55, HAPTIC_GAPS_MS.neutral]) },
          { id: 'modeCycleB', label: 'B · tick + spin', steps: recipe(['tick', 0.5], ['spin', 0.45, HAPTIC_GAPS_MS.neutral]) },
        ],
      },
      {
        id: 'holdAccepted',
        label: 'Hold accepted',
        description: 'A deliberate long press crosses its activation time.',
        leadingCandidateId: 'holdAcceptedA',
        selectionStatus: 'selected',
        candidates: [
          { id: 'holdAcceptedA', label: 'A · swell + lock', steps: recipe(['slowRise', 0.5], ['click', 0.65, HAPTIC_GAPS_MS.riseLock]) },
          { id: 'holdAcceptedB', label: 'B · weighted hold', steps: recipe(['lowTick', 0.45], ['thud', 0.45, HAPTIC_GAPS_MS.neutral]) },
        ],
      },
    ],
  },
] as const;

export const HAPTIC_RECIPE_GROUPS: readonly HapticRecipeGroup[] =
  HAPTIC_RECIPE_SECTIONS.flatMap((section) => section.groups);

export function hapticRecipeCandidate(
  candidateId: string
): HapticRecipeCandidate | undefined {
  for (const group of HAPTIC_RECIPE_GROUPS) {
    const candidate = group.candidates.find((item) => item.id === candidateId);
    if (candidate) return candidate;
  }
  return undefined;
}

export function validateHapticRecipe(
  steps: readonly HapticCompositionStep[]
): boolean {
  return (
    steps.length > 0 &&
    steps.length <= 8 &&
    steps.every(
      (step) =>
        Number.isFinite(step.scale) &&
        step.scale > 0 &&
        step.scale <= 1 &&
        Number.isInteger(step.delayMs ?? 0) &&
        (step.delayMs ?? 0) >= 0 &&
        (step.delayMs ?? 0) <= 1_000
    )
  );
}

export function unsupportedRecipePrimitives(
  steps: readonly HapticCompositionStep[],
  capabilities: HapticCapabilities
): HapticPrimitive[] {
  return [...new Set(
    steps
      .map((step) => step.primitive)
      .filter((primitive) => !capabilities.primitives[primitive].supported)
  )];
}

export function canPlayHapticRecipe(
  steps: readonly HapticCompositionStep[],
  capabilities: HapticCapabilities
): boolean {
  return (
    capabilities.moduleAvailable &&
    capabilities.hasVibrator &&
    capabilities.touchFeedbackEnabled &&
    validateHapticRecipe(steps) &&
    unsupportedRecipePrimitives(steps, capabilities).length === 0
  );
}
