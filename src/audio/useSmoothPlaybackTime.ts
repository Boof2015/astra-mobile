import { useEffect, useRef, useState } from 'react';
import {
  applyPlaybackSnapshot,
  clampPlaybackTime,
  createPlaybackClock,
  projectPlaybackClock,
  setPlaybackClockRunning,
} from './playbackClock';

const DISPLAY_FRAME_MS = 66;

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
  const [displayTime, setDisplayTime] = useState(() =>
    clampPlaybackTime(currentTime, duration)
  );
  const clockRef = useRef(createPlaybackClock(currentTime, duration, isPlaying));

  useEffect(() => {
    const now = Date.now();
    const nextClock = applyPlaybackSnapshot(
      clockRef.current,
      currentTime,
      duration,
      now
    );
    clockRef.current = nextClock;
    const next = projectPlaybackClock(nextClock, duration, now);
    const raf = requestAnimationFrame(() => setDisplayTime(next));
    return () => cancelAnimationFrame(raf);
  }, [currentTime, duration]);

  useEffect(() => {
    const now = Date.now();
    const nextClock = setPlaybackClockRunning(
      clockRef.current,
      isPlaying,
      duration,
      now
    );
    clockRef.current = nextClock;

    if (!isPlaying || duration <= 0) {
      const frozen = projectPlaybackClock(nextClock, duration, now);
      const freezeRaf = requestAnimationFrame(() => setDisplayTime(frozen));
      return () => cancelAnimationFrame(freezeRaf);
    }

    let raf = 0;
    let lastPaint = 0;

    const tick = (frameTime: number) => {
      raf = requestAnimationFrame(tick);
      if (frameTime - lastPaint < DISPLAY_FRAME_MS) return;
      lastPaint = frameTime;
      setDisplayTime(projectPlaybackClock(clockRef.current, duration, Date.now()));
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration, isPlaying]);

  return displayTime;
}
