import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, AppState, Keyboard, Platform, StyleSheet, View, type ViewProps } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { usePlayerStore } from '@/stores/playerStore';
import { registerAmbientDismiss, useTvAmbientBlocks, useTvAmbientSettings } from './ambientState';
import { loadAmbientMoment, type PreparedAmbientMoment } from './ambientData';
import { TvAmbientScene } from './TvAmbientScene';

const NativeHost = Platform.OS === 'android' && Platform.isTV ? requireNativeViewManager<ViewProps & {
  idleEnabled: boolean; timeoutMs: number; ambientVisible: boolean; resetToken: number;
  onIdle: () => void; onActivity: () => void; onDismiss: () => void;
}>('AstraTv', 'AstraTvAmbientHost') : null;

/** The browse tree stays mounted and keeps native focus. The native parent
 * observes even clamped arrows and consumes the entire first wake gesture. */
export function TvAmbient({ children }: { children: ReactNode }) {
  return NativeHost ? <AmbientController>{children}</AmbientController> : children;
}

function AmbientController({ children }: { children: ReactNode }) {
  const playing = usePlayerStore(s => s.playbackState === 'playing');
  const blocks = useTvAmbientBlocks(s => s.count);
  const { delay, loaded, load } = useTvAmbientSettings();
  const initialReduced = useReducedMotion();
  const [reduced, setReduced] = useState(initialReduced);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [keyboard, setKeyboard] = useState(Keyboard.isVisible());
  const [first, setFirst] = useState<PreparedAmbientMoment | null>(null);
  const [visible, setVisible] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  const permitted = loaded && delay > 0 && playing && foreground && !reduced && !keyboard && blocks === 0;
  const live = useRef({ permitted, visible: false, request: 0 });
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const opacity = useSharedValue(1);
  const pageStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  useLayoutEffect(() => { live.current.permitted = permitted; }, [permitted]);
  const dismiss = useCallback(() => {
    live.current.request++;
    if (!live.current.visible) return false;
    live.current.visible = false;
    setVisible(false);
    opacity.set(withTiming(1, { duration: 450, easing: Easing.out(Easing.cubic) }));
    exitTimer.current = setTimeout(() => { setFirst(null); exitTimer.current = null; }, 450);
    return true;
  }, [opacity]);
  useLayoutEffect(() => registerAmbientDismiss(dismiss), [dismiss]);
  useEffect(() => { if (!permitted) dismiss(); }, [permitted, dismiss]);
  useEffect(() => {
    let alive = true;
    const lifetime = live.current;
    void load().catch(() => {});
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReduced(value); });
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    const state = AppState.addEventListener('change', value => { live.current.request++; setForeground(value === 'active'); if (value !== 'active') dismiss(); });
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false));
    return () => {
      alive = false; lifetime.permitted = false; lifetime.request++;
      motion.remove(); state.remove(); show.remove(); hide.remove();
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
  }, [load, dismiss]);
  const start = useCallback(async () => {
    if (!live.current.permitted || live.current.visible) return;
    const version = ++live.current.request;
    const trackPath = usePlayerStore.getState().currentTrack?.path;
    let moment: PreparedAmbientMoment | null = null;
    try { moment = await loadAmbientMoment([]); } catch { /* A failed lookup leaves ordinary browsing alone. */ }
    if (version !== live.current.request || !live.current.permitted || trackPath !== usePlayerStore.getState().currentTrack?.path) {
      moment?.image?.release();
      if (version === live.current.request) setResetToken(value => value + 1);
      return;
    }
    if (!moment) { setResetToken(value => value + 1); return; }
    live.current.visible = true; setFirst(moment); setVisible(true);
    opacity.set(withTiming(.25, { duration: 1600, easing: Easing.out(Easing.cubic) }));
  }, [opacity]);
  if (!NativeHost) return children;
  return <NativeHost idleEnabled={permitted} timeoutMs={delay * 60_000} ambientVisible={visible && permitted} resetToken={resetToken}
    onIdle={() => { void start(); }} onActivity={() => { live.current.request++; }} onDismiss={dismiss} style={StyleSheet.absoluteFill}>
    <Animated.View style={[StyleSheet.absoluteFill, pageStyle]}>{children}</Animated.View>
    {first && <View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
      <TvAmbientScene first={first} visible={visible && permitted} dismiss={dismiss} />
    </View>}
  </NativeHost>;
}
