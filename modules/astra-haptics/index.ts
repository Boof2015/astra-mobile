import { Platform } from 'react-native';
import { requireOptionalNativeModule, type NativeModule } from 'expo-modules-core';
import type {
  HapticCapabilities,
  HapticCompositionStep,
  HapticPrimitive,
  HapticPrimitiveCapability,
} from './types';

declare class AstraHapticsModuleType extends NativeModule {
  getCapabilities(): Omit<HapticCapabilities, 'moduleAvailable'>;
  isTouchFeedbackEnabled(): boolean;
  playComposition(steps: HapticCompositionStep[]): boolean;
}

const native = requireOptionalNativeModule<AstraHapticsModuleType>('AstraHaptics');

const PRIMITIVES: HapticPrimitive[] = [
  'click',
  'thud',
  'spin',
  'quickRise',
  'slowRise',
  'quickFall',
  'tick',
  'lowTick',
];

function unsupportedPrimitives(): Record<HapticPrimitive, HapticPrimitiveCapability> {
  return Object.fromEntries(
    PRIMITIVES.map((primitive) => [primitive, { supported: false, durationMs: 0 }])
  ) as Record<HapticPrimitive, HapticPrimitiveCapability>;
}

export const AstraHaptics = {
  isAvailable: native !== null,

  getCapabilities(): HapticCapabilities {
    if (!native) {
      return {
        moduleAvailable: false,
        apiLevel: typeof Platform.Version === 'number' ? Platform.Version : 0,
        hasVibrator: false,
        hasAmplitudeControl: false,
        touchFeedbackEnabled: false,
        primitives: unsupportedPrimitives(),
      };
    }
    return { moduleAvailable: true, ...native.getCapabilities() };
  },

  isTouchFeedbackEnabled(): boolean {
    return native?.isTouchFeedbackEnabled() ?? true;
  },

  playComposition(steps: HapticCompositionStep[]): boolean {
    return native?.playComposition(steps) ?? false;
  },
};

export type {
  HapticCapabilities,
  HapticCompositionStep,
  HapticPrimitive,
  HapticPrimitiveCapability,
} from './types';
