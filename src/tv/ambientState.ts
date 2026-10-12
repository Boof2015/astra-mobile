import { useLayoutEffect } from 'react';
import { create } from 'zustand';
import { getNativeSetting, setNativeSetting } from '../db/nativeSettings';
import { parseAmbientDelay, type AmbientDelay } from './ambientModel';

const KEY = 'tv_ambient_delay_minutes_v1';
let loading: Promise<void> | null = null;
export const useTvAmbientSettings = create<{
  delay: AmbientDelay; loaded: boolean;
  load: () => Promise<void>; setDelay: (value: AmbientDelay) => Promise<void>;
}>((set, get) => ({
  delay: 2, loaded: false,
  load: () => {
    if (get().loaded) return Promise.resolve();
    return loading ??= getNativeSetting(KEY).then(value => { set({ delay: parseAmbientDelay(value), loaded: true }); }).finally(() => { loading = null; });
  },
  setDelay: async value => { await setNativeSetting(KEY, String(value)); set({ delay: value, loaded: true }); },
}));

export const useTvAmbientBlocks = create<{ count: number }>(() => ({ count: 0 }));
/** Explicit modes block Ambient without confusing ordinary page Back handlers
 * with a modal interaction. Inactive kept-alive pages do not register. */
export function useTvAmbientBlock(blocked: boolean) {
  useLayoutEffect(() => {
    if (!blocked) return;
    useTvAmbientBlocks.setState(state => ({ count: state.count + 1 }));
    return () => { useTvAmbientBlocks.setState(state => ({ count: state.count - 1 })); };
  }, [blocked]);
}

let dismiss: (() => boolean) | null = null;
export const dismissTvAmbient = () => dismiss?.() ?? false;
export function registerAmbientDismiss(handler: () => boolean) {
  dismiss = handler;
  return () => { if (dismiss === handler) dismiss = null; };
}
