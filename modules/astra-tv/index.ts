import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

export type TvVerticalHoldEvent = { phase: 'start' | 'repeat' | 'jump' | 'release' | 'cancel'; direction: 'up' | 'down' };
type TvVerticalCaptureEvent = { viewTag: number; direction: 'up' | 'down' };
export type TvDirection = 'up' | 'down' | 'left' | 'right';
type TvDirectionCaptureEvent = { viewTag: number; direction: TvDirection };
const native = requireOptionalNativeModule<{
  showKeyboard: (viewTag: number) => Promise<void>;
  canPickDocuments: () => Promise<boolean>;
  setVerticalHold: (viewTag: number, enabled: boolean) => Promise<void>;
  setVerticalCapture: (viewTag: number, enabled: boolean) => Promise<void>;
  setDirectionCapture: (viewTag: number, enabled: boolean) => Promise<void>;
  addListener(name: 'onVerticalHold', listener: (event: TvVerticalHoldEvent) => void): { remove: () => void };
  addListener(name: 'onVerticalCapture', listener: (event: TvVerticalCaptureEvent) => void): { remove: () => void };
  addListener(name: 'onDirectionCapture', listener: (event: TvDirectionCaptureEvent) => void): { remove: () => void };
}>('AstraTv');

export function setTvVerticalHold(viewTag: number | null, enabled: boolean) {
  if (Platform.isTV && viewTag != null) void native?.setVerticalHold(viewTag, enabled);
}

export function onTvVerticalHold(listener: (event: TvVerticalHoldEvent) => void) {
  return Platform.isTV ? native?.addListener('onVerticalHold', listener) : undefined;
}

export function captureTvVertical(viewTag: number, listener: (direction: 'up' | 'down') => void) {
  if (!Platform.isTV || !native) return () => {};
  const subscription = native.addListener('onVerticalCapture', event => { if (event.viewTag === viewTag) listener(event.direction); });
  void native.setVerticalCapture(viewTag, true);
  return () => { subscription.remove(); void native.setVerticalCapture(viewTag, false); };
}

export async function showTvKeyboard(viewTag: number | null) {
  if (Platform.isTV && viewTag != null) await native?.showKeyboard(viewTag);
}

export async function canPickTvDocuments(): Promise<boolean> {
  return Platform.isTV && native ? native.canPickDocuments() : false;
}

export function captureTvDirections(viewTag: number, listener: (direction: TvDirection) => void) {
  if (!Platform.isTV || !native) return () => {};
  const subscription = native.addListener('onDirectionCapture', event => { if (event.viewTag === viewTag) listener(event.direction); });
  void native.setDirectionCapture(viewTag, true);
  return () => { subscription.remove(); void native.setDirectionCapture(viewTag, false); };
}
