import { useEffect, useRef, useState } from 'react';

const DISPLAY_FRAME_MS = 66;

function clampTime(value: number, duration: number): number {
  if (!Number.isFinite(value)) return 0;
  if (duration <= 0) return Math.max(0, value);
  return Math.min(duration, Math.max(0, value));
}

/**
 * Interpolates displayed playback time between RNTP progress snapshots. RNTP
 * remains authoritative; this only makes the visible timeline move smoothly
 * instead of stepping at the store mirror cadence.
 */
export function useSmoothPlaybackTime(
  currentTime: number,
  duration: number,
  isPlaying: boolean
): number {
  const [displayTime, setDisplayTime] = useState(() => clampTime(currentTime, duration));
  const anchorRef = useRef({
    time: clampTime(currentTime, duration),
    timestamp: 0,
  });

  useEffect(() => {
    const next = clampTime(currentTime, duration);
    anchorRef.current = { time: next, timestamp: Date.now() };
    const raf = requestAnimationFrame(() => setDisplayTime(next));
    return () => cancelAnimationFrame(raf);
  }, [currentTime, duration]);

  useEffect(() => {
    if (!isPlaying || duration <= 0) return;
    let raf = 0;
    let lastPaint = 0;

    const tick = (frameTime: number) => {
      raf = requestAnimationFrame(tick);
      if (frameTime - lastPaint < DISPLAY_FRAME_MS) return;
      lastPaint = frameTime;
      const anchor = anchorRef.current;
      const elapsed = (Date.now() - anchor.timestamp) / 1000;
      setDisplayTime(clampTime(anchor.time + elapsed, duration));
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration, isPlaying]);

  return displayTime;
}
