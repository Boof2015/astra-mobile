import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

export type TvVerticalHoldEvent = { phase: 'start' | 'repeat' | 'jump' | 'release' | 'cancel'; direction: 'up' | 'down' };
const native = requireOptionalNativeModule<{
  showKeyboard: (viewTag: number) => Promise<void>;
  setVerticalHold: (viewTag: number, enabled: boolean) => Promise<void>;
  addListener: (name: 'onVerticalHold', listener: (event: TvVerticalHoldEvent) => void) => { remove: () => void };
}>('AstraTv');

export function setTvVerticalHold(viewTag: number | null, enabled: boolean) {
  if (Platform.isTV && viewTag != null) void native?.setVerticalHold(viewTag, enabled);
}

export function onTvVerticalHold(listener: (event: TvVerticalHoldEvent) => void) {
  return Platform.isTV ? native?.addListener('onVerticalHold', listener) : undefined;
}

export async function showTvKeyboard(viewTag: number | null) {
  if (Platform.isTV && viewTag != null) await native?.showKeyboard(viewTag);
}
