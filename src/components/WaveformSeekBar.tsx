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
import { Text } from './Text';
import { spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { formatDuration } from '@/lib/format';
import { downsampleWaveform, getWaveform } from '@/scope/waveform';
import { useSmoothPlaybackTime } from '@/audio/useSmoothPlaybackTime';
import { usePlayerStore } from '@/stores/playerStore';
import { playHaptic } from '@/lib/haptics';
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
type WaveformQuality = 'preview' | 'accurate';

interface WaveformSeekBarProps {
  onSeek: (seconds: number) => void;
  height?: number;
  touchPadding?: number;
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
  const smoothTime = useSmoothPlaybackTime(currentTime, duration, isPlaying);

  // Load (cache-first) the offline peaks whenever the track changes.
  useEffect(() => {
    if (!trackPath) return;
    let cancelled = false;
    void getWaveform(trackPath, {
      onPreview: (peaks) => {
        if (cancelled) return;
        setLoaded((current) => {
          if (current?.path === trackPath && current.quality === 'accurate' && current.peaks) {
            return current;
          }
          return { path: trackPath, peaks, quality: 'preview' };
        });
      },
    }).then((peaks) => {
      if (cancelled) return;
      setLoaded((current) => {
        if (!peaks && current?.path === trackPath && current.quality === 'preview') return current;
        return { path: trackPath, peaks, quality: 'accurate' };
      });
    });
    return () => {
      cancelled = true;
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
  const liveFraction = duration > 0 ? Math.min(1, smoothTime / duration) : 0;
  const heldFraction = pendingSeek && duration > 0 ? clamp(pendingSeek.target / duration) : null;
  const fraction = scrubFraction ?? heldFraction ?? liveFraction;
  const shownTime = fraction * duration;

  const barCount = Math.max(1, Math.floor(barWidth / (BAR_WIDTH + BAR_GAP)));

  // Build one Skia path of all bars (rounded rects). Drawn twice with a clip
  // split at the playhead: played in accent, unplayed in glassBorder.
  const barsPath = useMemo(() => {
    const path = Skia.Path.Make();
    if (barWidth <= 0) return path;
    const display = source
      ? downsampleWaveform(source, barCount)
      : new Float32Array(barCount).fill(MIN_BAR);
    const r = BAR_WIDTH / 2;
    for (let i = 0; i < barCount; i++) {
      const amp = Math.max(MIN_BAR, display[i] ?? MIN_BAR);
      const h = amp * height;
      const x = i * (BAR_WIDTH + BAR_GAP);
      const y = (height - h) / 2;
      path.addRRect(Skia.RRectXY(Skia.XYWHRect(x, y, BAR_WIDTH, h), r, r));
    }
    return path;
  }, [source, barCount, barWidth, height]);

  const splitX = fraction * barWidth;
  const playheadX = Math.min(
    Math.max(0, barWidth - PLAYHEAD_WIDTH),
    Math.max(0, splitX - PLAYHEAD_WIDTH / 2)
  );

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
          <Group clip={rect(0, 0, splitX, height)}>
            <Path path={barsPath} color={colors.accent} />
          </Group>
          <Group clip={rect(splitX, 0, Math.max(0, barWidth - splitX), height)}>
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
      <View style={styles.times}>
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
    justifyContent: 'space-between',
    marginTop: spacing.xs,
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
