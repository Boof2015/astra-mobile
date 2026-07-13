export type HapticPrimitive =
  | 'click'
  | 'thud'
  | 'spin'
  | 'quickRise'
  | 'slowRise'
  | 'quickFall'
  | 'tick'
  | 'lowTick';

export interface HapticCompositionStep {
  primitive: HapticPrimitive;
  scale: number;
  delayMs?: number;
}

export interface HapticPrimitiveCapability {
  supported: boolean;
  durationMs: number;
}

export interface HapticCapabilities {
  moduleAvailable: boolean;
  apiLevel: number;
  hasVibrator: boolean;
  hasAmplitudeControl: boolean;
  touchFeedbackEnabled: boolean;
  primitives: Record<HapticPrimitive, HapticPrimitiveCapability>;
}
