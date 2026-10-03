import {
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent
} from 'react-native';
import {
  Canvas,
  Group,
  Path,
  Rect,
  Skia,
  rect
} from '@shopify/react-native-skia';
import {
  Easing,
  cancelAnimation,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Text } from './Text';
import { spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { formatDuration } from '@/lib/format';
import {
  downsampleWaveform,
  getWaveform,
  normalizeProgressiveWaveform,
  subscribeWaveformProgress,
} from '@/scope/waveform';
import { useAnimatedPlaybackProgress } from '@/audio/useAnimatedPlaybackProgress';
import { usePlayerStore } from '@/stores/playerStore';
import { playHaptic } from '@/lib/haptics';
import {
  getWaveformBarScale,
  getWaveformTransitionDurationMs,
  interpolateWaveformBarHeight,
} from './waveformTransition';
import {
  beginScrubDetents,
  updateScrubDetents,
  type ScrubDetentState,
} from './waveformScrubDetents';

const CANVAS_HEIGHT = 58;
const BAR_WIDTH = 3;
const BAR_GAP = 2;
const MIN_BAR = 0.05; // floor so silent/idle sections still show a sliver
const PLAYHEAD_WIDTH = 2;
/** Every bar change morphs with desktop's handoff timing (stagger included). */
const MORPH_MS = getWaveformTransitionDurationMs('handoff');
/** Ascending confidence — a partial result never overwrites an accurate cache hit. */
type WaveformQuality = 'partial' | 'accurate';

interface WaveformSeekBarProps {
  onSeek: (seconds: number) => void;
  height?: number;
  touchPadding?: number;
  /** Gap between the canvas and the elapsed/remaining row. */
  timesGap?: number;
  /**
   * Line box reserved for the elapsed/remaining row. Declared by the caller so
   * this component's total height is `height + touchPadding * 2 + timesGap +
   * timesHeight` exactly — the now-playing deck reserves that same sum.
   */
  timesHeight?: number;
  /** Track file URI used to load/cache the offline waveform peaks. */
  trackPath?: string;
  /**
   * False while the bar is mounted but hidden (the now-playing overlay stays
   * mounted when closed): pins progress and stops the smooth-time rAF loop.
   */
  active?: boolean;
}

const clamp = (fraction: number) => Math.min(1, Math.max(0, fraction));

/**
 * Waveform seek bar (M3) — ports desktop WaveformSeekBar's look (RMS bars, a
 * played/unplayed split, draggable playhead) on Skia, while keeping SeekBar's
 * tap/drag + pending-seek "hold" state machine verbatim so seeking behaves
 * identically. Peaks load offline (getWaveform) and fall back to flat bars.
 *
 * Phone-target only: progress comes straight from the player store so the 2Hz
 * tick re-renders this leaf, not the whole now-playing tree.
 */
export function WaveformSeekBar({
  onSeek,
  height = CANVAS_HEIGHT,
  touchPadding = spacing.md,
  timesGap = spacing.xs,
  timesHeight,
  trackPath,
  active = true,
}: WaveformSeekBarProps) {
  const styles = useStyles();
  const colors = useColors();
  const currentTime = usePlayerStore((s) => (active ? s.currentTime : 0));
  const duration = usePlayerStore((s) => s.duration);
  const isPlaying = usePlayerStore((s) => active && s.playbackState === 'playing');
  const [scrubFraction, setScrubFraction] = useState<number | null>(null);
  const [barWidth, setBarWidth] = useState(0);
  const pendingSeek = usePlayerStore((s) => s.pendingSeek);
  // Peaks tagged with the path they belong to, so a track change drops the old
  // waveform as a pure derivation (no synchronous setState in the effect).
  const [loaded, setLoaded] = useState<{
    path: string;
    peaks: Float32Array | null;
    quality: WaveformQuality;
  } | null>(null);

  const widthRef = useRef(0);
  const scrubRef = useRef<number | null>(null);
  const grantRef = useRef({ fraction: 0, pageX: 0 });
  const detentRef = useRef<ScrubDetentState | null>(null);
  const heldFraction = pendingSeek && duration > 0 ? clamp(pendingSeek.target / duration) : null;
  const progress = useAnimatedPlaybackProgress({
    currentTime,
    duration,
    isPlaying,
    active,
    trackKey: trackPath,
    overrideFraction: scrubFraction ?? heldFraction,
  });
  // Load (cache-first) the offline peaks whenever the track changes, and follow the decode
  // as it runs so the bars resolve left-to-right rather than snapping in at the end. The
  // progress subscription is independent of who started the decode — usually the queue
  // prefetch got there first, in which case this only ever sees the cache hit.
  useEffect(() => {
    if (!trackPath) return;
    let cancelled = false;

    const unsubscribe = subscribeWaveformProgress(trackPath, ({ peaks, totalBins }) => {
      if (cancelled) return;
      const progressive = normalizeProgressiveWaveform(peaks, totalBins);
      setLoaded((current) => {
        if (current?.path === trackPath && current.quality === 'accurate' && current.peaks) {
          return current;
        }
        return { path: trackPath, peaks: progressive, quality: 'partial' };
      });
    });

    void getWaveform(trackPath).then((peaks) => {
      if (cancelled) return;
      setLoaded((current) => {
        // A failed decode must not wipe a good partial fill.
        if (!peaks && current?.path === trackPath && current.peaks) return current;
        return { path: trackPath, peaks, quality: 'accurate' };
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [trackPath]);

  const source = loaded && loaded.path === trackPath ? loaded.peaks : null;

  const setScrub = (fraction: number | null) => {
    scrubRef.current = fraction;
    setScrubFraction(fraction);
  };

  const onLayout = (event: LayoutChangeEvent) => {
    widthRef.current = event.nativeEvent.layout.width;
    setBarWidth(event.nativeEvent.layout.width);
  };

  const handleGrant = (event: GestureResponderEvent) => {
    const fraction = clamp(event.nativeEvent.locationX / Math.max(1, widthRef.current));
    grantRef.current = { fraction, pageX: event.nativeEvent.pageX };
    detentRef.current = beginScrubDetents(fraction * widthRef.current, widthRef.current);
    setScrub(fraction);
  };

  const handleMove = (event: GestureResponderEvent) => {
    const delta = (event.nativeEvent.pageX - grantRef.current.pageX) / Math.max(1, widthRef.current);
    const fraction = clamp(grantRef.current.fraction + delta);
    setScrub(fraction);

    const detents = detentRef.current;
    if (!detents) return;
    const update = updateScrubDetents(
      detents,
      fraction * widthRef.current,
      widthRef.current,
      Date.now()
    );
    detentRef.current = update.state;
    if (update.shouldTick) playHaptic('scrubStep');
  };

  const handleRelease = () => {
    const fraction = scrubRef.current ?? grantRef.current.fraction;
    const target = fraction * duration;
    detentRef.current = null;
    onSeek(target);
    setScrub(null);
  };

  const handleTerminate = () => {
    detentRef.current = null;
    setScrub(null);
  };

  // Displayed position: scrub > pending seek target > live progress. The player
  // store clears pendingSeek only after native progress acknowledges the target
  // or the guard times out, so stale RNTP progress cannot bounce the UI back.
  const liveFraction = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const fraction = scrubFraction ?? heldFraction ?? liveFraction;
  const shownTime = fraction * duration;

  const barCount = Math.max(1, Math.floor(barWidth / (BAR_WIDTH + BAR_GAP)));

  // Bar amplitudes for what *should* be showing. No peaks yet is a row of
  // slivers, the same baseline the bars collapse toward while a track loads.
  const placeholder = !source;
  const targetAmps = useMemo(() => {
    if (barWidth <= 0) return null;
    const display = source ? downsampleWaveform(source, barCount) : null;
    const amps = new Array<number>(barCount);
    for (let i = 0; i < barCount; i++) amps[i] = Math.max(MIN_BAR, display?.[i] ?? MIN_BAR);
    return amps;
  }, [source, barCount, barWidth]);

  // Track-change motion, ported from desktop: each bar eases from the height it
  // has on screen to its new one, left to right. One elapsed clock drives every
  // bar, so a retarget mid-flight never has to reconcile per-bar animations.
  const reduceMotion = useReducedMotion();
  const fromAmps = useSharedValue<number[]>([]);
  const toAmps = useSharedValue<number[]>([]);
  const morphElapsed = useSharedValue(MORPH_MS);
  const morphRef = useRef<{ key: string | undefined; placeholder: boolean }>({
    key: undefined,
    placeholder: true,
  });

  useEffect(() => {
    if (!targetAmps) return;
    const previous = morphRef.current;
    morphRef.current = { key: trackPath, placeholder };
    const elapsed = morphElapsed.value;
    const from = fromAmps.value;
    const to = toAmps.value;

    // Width change (or first layout): bar counts differ, nothing to morph between.
    if (to.length !== targetAmps.length || reduceMotion) {
      cancelAnimation(morphElapsed);
      fromAmps.value = targetAmps;
      toAmps.value = targetAmps;
      morphElapsed.value = MORPH_MS;
      return;
    }

    // A new track, or real peaks replacing the loading baseline: morph from
    // exactly what is on screen now, so an interrupted morph never jumps.
    if (previous.key !== trackPath || (previous.placeholder && !placeholder)) {
      const onScreen = to.map((target, i) =>
        interpolateWaveformBarHeight(
          from[i] ?? target,
          target,
          getWaveformBarScale('handoff', elapsed, i, to.length),
        ),
      );
      fromAmps.value = onScreen;
      toAmps.value = targetAmps;
      cancelAnimation(morphElapsed);
      morphElapsed.value = 0;
      morphElapsed.value = withTiming(MORPH_MS, { duration: MORPH_MS, easing: Easing.linear });
      return;
    }

    // Same track filling in progressively: retarget a running morph, otherwise
    // swap in place (the decode already resolves left to right on its own).
    toAmps.value = targetAmps;
    if (elapsed >= MORPH_MS) fromAmps.value = targetAmps;
  }, [targetAmps, trackPath, placeholder, reduceMotion, fromAmps, toAmps, morphElapsed]);

  // One Skia path of all bars (rounded rects), rebuilt on the UI thread only
  // while a morph is running. Drawn twice with a clip split at the playhead:
  // played in accent, unplayed in glassBorder.
  const barsPath = useDerivedValue(() => {
    const path = Skia.Path.Make();
    const from = fromAmps.value;
    const to = toAmps.value;
    const elapsed = morphElapsed.value;
    const count = to.length;
    const r = BAR_WIDTH / 2;
    for (let i = 0; i < count; i++) {
      const amp = interpolateWaveformBarHeight(
        from[i] ?? to[i],
        to[i],
        getWaveformBarScale('handoff', elapsed, i, count),
      );
      const h = amp * height;
      const x = i * (BAR_WIDTH + BAR_GAP);
      const y = (height - h) / 2;
      path.addRRect(Skia.RRectXY(Skia.XYWHRect(x, y, BAR_WIDTH, h), r, r));
    }
    return path;
  }, [height]);

  const playedClip = useDerivedValue(
    () => rect(0, 0, progress.value * barWidth, height),
    [barWidth, height]
  );
  const unplayedClip = useDerivedValue(() => {
    const splitX = progress.value * barWidth;
    return rect(splitX, 0, Math.max(0, barWidth - splitX), height);
  }, [barWidth, height]);
  const playheadX = useDerivedValue(() => {
    const splitX = progress.value * barWidth;
    return Math.min(
      Math.max(0, barWidth - PLAYHEAD_WIDTH),
      Math.max(0, splitX - PLAYHEAD_WIDTH / 2)
    );
  }, [barWidth]);

  return (
    <View>
      <View
        style={[styles.touchArea, { height: height + touchPadding * 2 }]}
        onLayout={onLayout}
        onStartShouldSetResponder={() => duration > 0}
        onMoveShouldSetResponder={() => duration > 0}
        onResponderTerminationRequest={() => false}
        onResponderGrant={handleGrant}
        onResponderMove={handleMove}
        onResponderRelease={handleRelease}
        onResponderTerminate={handleTerminate}
        accessibilityRole="adjustable"
        accessibilityLabel="Seek"
        accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(shownTime) }}
      >
        <Canvas style={{ width: '100%', height }}>
          <Group clip={playedClip}>
            <Path path={barsPath} color={colors.accent} />
          </Group>
          <Group clip={unplayedClip}>
            <Path path={barsPath} color={colors.glassBorder} />
          </Group>
          {barWidth > 0 ? (
            <Rect
              x={playheadX}
              y={0}
              width={PLAYHEAD_WIDTH}
              height={height}
              color={colors.textPrimary}
            />
          ) : null}
        </Canvas>
      </View>
      <View
        style={[
          styles.times,
          { marginTop: timesGap },
          timesHeight != null && { height: timesHeight },
        ]}
      >
        <Text variant="mono" style={[styles.time, scrubFraction != null && styles.timeActive]}>
          {formatDuration(shownTime)}
        </Text>
        <Text variant="mono" style={styles.time}>
          {formatDuration(duration)}
        </Text>
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  touchArea: {
    justifyContent: 'center',
  },
  times: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  time: {
    color: colors.textTertiary,
    fontSize: 13,
  },
  timeActive: {
    color: colors.accentText,
  },
}));

export default WaveformSeekBar;
