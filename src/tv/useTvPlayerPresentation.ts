import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, findNodeHandle, type View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { setTvKeepScreenOn } from '../../modules/astra-tv';
import { canPlayerIdle } from './nowPlayingModel';

export function useTvPlayerPresentation(playing: boolean, blocked: boolean, node: View | null) {
  const initialReduced = useReducedMotion();
  const [reduced, setReduced] = useState(initialReduced);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [activity, setActivity] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const context = useMemo(() => ({ playing, foreground, blocked, activity }), [playing, foreground, blocked, activity]);
  const [idleContext, setIdleContext] = useState<typeof context | null>(null);
  const idle = idleContext === context;
  const interact = useCallback(() => { setActivity(value => value + 1); }, []);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReduced(value); });
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    const state = AppState.addEventListener('change', value => { setForeground(value === 'active'); setActivity(value => value + 1); });
    return () => { alive = false; motion.remove(); state.remove(); };
  }, []);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (canPlayerIdle(playing, foreground, false, blocked)) timer.current = setTimeout(() => setIdleContext(context), 6000);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [playing, foreground, blocked, context]);
  useEffect(() => {
    const tag = node && findNodeHandle(node);
    if (tag == null) return;
    setTvKeepScreenOn(tag, playing && foreground && !reduced && !blocked);
    return () => setTvKeepScreenOn(tag, false);
  }, [node, playing, foreground, reduced, blocked]);
  return { idle, interact, foreground, reduced };
}
