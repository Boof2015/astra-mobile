import * as Haptics from 'expo-haptics';

/**
 * Fire-and-forget haptic wrappers. Calls are best-effort — devices without a
 * vibrator (or with system haptics disabled) reject silently. Keeping them here
 * lets call sites stay declarative and makes the feedback vocabulary consistent
 * across swipe rows and drag-reorder.
 */

/** Subtle tick at a gesture decision point (swipe arm/disarm). */
export function tickHaptic(): void {
  void Haptics.selectionAsync().catch(() => {});
}

/** Confirmation when a swipe commits to its action. */
export function commitHaptic(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** Stronger bump when a hold-to-drag reorder engages. */
export function dragArmHaptic(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}
