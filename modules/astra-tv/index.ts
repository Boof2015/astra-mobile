import { requireOptionalNativeModule } from 'expo-modules-core';
import { PermissionsAndroid, Platform } from 'react-native';

export type TvAudioProbe = { status: 'granted' | 'denied' | 'unsupported'; total: number; volumes: string[]; files: {
  uri: string; name: string; relativePath: string | null; volume: string; size: number; lastModified: number; mimeType: string | null;
}[] };

export type TvVerticalHoldEvent = { phase: 'start' | 'repeat' | 'jump' | 'release' | 'cancel'; direction: 'up' | 'down' };
type TvVerticalCaptureEvent = { viewTag: number; direction: 'up' | 'down' };
export type TvDirection = 'up' | 'down' | 'left' | 'right';
export type TvDirectionPress = { repeat: boolean; heldMs: number };
type TvDirectionCaptureEvent = TvDirectionPress & { viewTag: number; direction: TvDirection };
const native = requireOptionalNativeModule<{
  showKeyboard: (viewTag: number) => Promise<void>;
  canPickDocuments: () => Promise<boolean>;
  probeLocalAudio: () => Promise<TvAudioProbe>;
  setVerticalHold: (viewTag: number, enabled: boolean) => Promise<void>;
  setVerticalCapture: (viewTag: number, enabled: boolean) => Promise<void>;
  setDirectionCapture: (viewTag: number, enabled: boolean) => Promise<void>;
  setKeepScreenOn: (viewTag: number, enabled: boolean) => Promise<void>;
  addListener(name: 'onVerticalHold', listener: (event: TvVerticalHoldEvent) => void): { remove: () => void };
  addListener(name: 'onVerticalCapture', listener: (event: TvVerticalCaptureEvent) => void): { remove: () => void };
  addListener(name: 'onDirectionCapture', listener: (event: TvDirectionCaptureEvent) => void): { remove: () => void };
}>('AstraTv');

export async function probeTvLocalAudio(): Promise<TvAudioProbe> {
  if (!__DEV__ || !Platform.isTV || !native) throw new Error('TV debug builds only');
  return native.probeLocalAudio();
}

export async function requestTvAudioProbePermission() {
  if (!__DEV__ || !Platform.isTV || Number(Platform.Version) < 33) return 'unavailable';
  return PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO);
}

export function tvAudioPermission() {
  return Number(Platform.Version) >= 33 ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;
}

export async function hasTvAudioPermission() {
  return Platform.isTV && PermissionsAndroid.check(tvAudioPermission());
}

export async function requestTvAudioPermission() {
  if (!Platform.isTV) throw new Error('Music access is only requested on TV.');
  return PermissionsAndroid.request(tvAudioPermission());
}

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

export function captureTvDirections(viewTag: number, listener: (direction: TvDirection, press: TvDirectionPress) => void) {
  if (!Platform.isTV || !native) return () => {};
  const subscription = native.addListener('onDirectionCapture', event => { if (event.viewTag === viewTag) listener(event.direction, event); });
  void native.setDirectionCapture(viewTag, true);
  return () => { subscription.remove(); void native.setDirectionCapture(viewTag, false); };
}

/** A view-owned flag: detached/background windows cannot keep the display on. */
export function setTvKeepScreenOn(viewTag: number, enabled: boolean) {
  if (Platform.isTV) void native?.setKeepScreenOn(viewTag, enabled);
}
