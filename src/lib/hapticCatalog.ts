export type HapticEvent =
  | 'toggleOn'
  | 'toggleOff'
  | 'selection'
  | 'frequentStep'
  | 'scrubStep'
  | 'threshold'
  | 'thresholdExit'
  | 'action'
  | 'dragStart'
  | 'dragEnd'
  | 'queueLift'
  | 'queueDrop'
  | 'pullLatch'
  | 'pullRelease'
  | 'modeCycle'
  | 'holdAccepted'
  | 'confirm'
  | 'reject';

export type AndroidSemanticHaptic =
  | 'toggle-on'
  | 'toggle-off'
  | 'segment-tick'
  | 'segment-frequent-tick'
  | 'gesture-start'
  | 'virtual-key'
  | 'drag-start'
  | 'gesture-end'
  | 'confirm'
  | 'reject';

export type LegacyHapticFallback =
  | 'selection'
  | 'lightImpact'
  | 'mediumImpact'
  | 'success'
  | 'error';

export interface HapticDefinition {
  semantic: AndroidSemanticHaptic;
  fallback: LegacyHapticFallback;
  recipeId?: string;
}

/**
 * Meaning-first haptic vocabulary. Android chooses the exact actuator rendering
 * for the semantic effect; the fallback only runs on releases that predate the
 * corresponding HapticFeedbackConstant.
 */
export const HAPTIC_DEFINITIONS: Readonly<Record<HapticEvent, HapticDefinition>> = {
  toggleOn: { semantic: 'toggle-on', fallback: 'selection', recipeId: 'toggleOnA' },
  toggleOff: { semantic: 'toggle-off', fallback: 'selection', recipeId: 'toggleOffB' },
  selection: { semantic: 'segment-tick', fallback: 'selection' },
  frequentStep: { semantic: 'segment-frequent-tick', fallback: 'selection' },
  scrubStep: {
    semantic: 'segment-frequent-tick',
    fallback: 'selection',
    recipeId: 'scrubStepA',
  },
  threshold: { semantic: 'gesture-start', fallback: 'lightImpact' },
  thresholdExit: {
    semantic: 'gesture-end',
    fallback: 'lightImpact',
    recipeId: 'thresholdExitA',
  },
  action: { semantic: 'virtual-key', fallback: 'lightImpact' },
  dragStart: { semantic: 'drag-start', fallback: 'mediumImpact', recipeId: 'dragPickupB' },
  dragEnd: { semantic: 'gesture-end', fallback: 'lightImpact', recipeId: 'dragPlacementA' },
  queueLift: { semantic: 'drag-start', fallback: 'mediumImpact', recipeId: 'queueLiftB' },
  queueDrop: { semantic: 'gesture-end', fallback: 'lightImpact', recipeId: 'queueDropA' },
  pullLatch: { semantic: 'gesture-start', fallback: 'lightImpact', recipeId: 'pullLatchB' },
  pullRelease: { semantic: 'gesture-end', fallback: 'lightImpact', recipeId: 'pullReleaseA' },
  modeCycle: { semantic: 'segment-tick', fallback: 'selection', recipeId: 'modeCycleA' },
  holdAccepted: {
    semantic: 'gesture-start',
    fallback: 'mediumImpact',
    recipeId: 'holdAcceptedA',
  },
  confirm: { semantic: 'confirm', fallback: 'success', recipeId: 'confirmA' },
  reject: { semantic: 'reject', fallback: 'error', recipeId: 'rejectB' },
};

export function hapticForToggle(nextValue: boolean): HapticEvent {
  return nextValue ? 'toggleOn' : 'toggleOff';
}
