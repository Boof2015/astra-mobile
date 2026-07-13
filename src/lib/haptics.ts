import * as Haptics from 'expo-haptics';
import {
  HAPTIC_DEFINITIONS,
  type HapticEvent,
  type LegacyHapticFallback,
} from './hapticCatalog';
import { hapticRecipeCandidate } from './hapticRecipes';
import { AstraHaptics } from '../../modules/astra-haptics';

/**
 * Fire-and-forget semantic haptics. Android renders each meaning for the
 * current actuator and touch-feedback preference. Older Android releases fall
 * back to Expo's legacy vibration effects without surfacing errors to callers.
 */
export function playHaptic(event: HapticEvent): void {
  const definition = HAPTIC_DEFINITIONS[event];
  if (definition.recipeId) {
    const candidate = hapticRecipeCandidate(definition.recipeId);
    if (candidate) {
      try {
        if (AstraHaptics.playComposition(candidate.steps.map((step) => ({ ...step })))) {
          return;
        }
      } catch {
        // Optional or older native builds continue through the semantic path.
      }
    }
  }
  void Haptics.performAndroidHapticsAsync(
    definition.semantic as Haptics.AndroidHaptics
  ).catch(() => playLegacyFallback(definition.fallback));
}

function playLegacyFallback(fallback: LegacyHapticFallback): Promise<void> {
  if (!AstraHaptics.isTouchFeedbackEnabled()) return Promise.resolve();
  switch (fallback) {
    case 'selection':
      return Haptics.selectionAsync().catch(() => {});
    case 'lightImpact':
      return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    case 'mediumImpact':
      return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    case 'success':
      return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    case 'error':
      return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  }
}

export type { HapticEvent } from './hapticCatalog';
