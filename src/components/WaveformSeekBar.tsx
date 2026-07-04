import {
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent
} from 'react-native';
import {
  Canvas,
  Group,
  Path,
  Skia,
  rect
} from '@shopify/react-native-skia';
import { Text } from './Text';
import { colors, spacing } from '@/theme';
import { formatDuration } from '@/lib/format';
import { downsampleWaveform, getWaveform } from '@/scope/waveform';

const CANVAS_HEIGHT = 58;
const BAR_WIDTH = 3;
const BAR_GAP = 2;
const MIN_BAR = 0.05; // floor so silent/idle sections still show a sliver
// While a seek is pending, keep showing the target until the player's reported
// position moves off the pre-seek value (`from`) — i.e. the seek has landed.
const HOLD_EPS = 0.75;

interface WaveformSeekBarProps {
  currentTime: number;
  duration: number;
  onSeek: (seconds: number) => void;
  height?: number;
  touchPadding?: number;
  /** Identity of the playing track; a pending seek only applies to its own track. */
  trackKey?: string | number;
  /** Track file URI used to load/cache the offline waveform peaks. */
  trackPath?: string;
}

const clamp = (fraction: number) => Math.min(1, Math.max(0, fraction));

/**
 * Waveform seek bar (M3) — ports desktop WaveformSeekBar's look (RMS bars, a
 * played/unplayed split, draggable playhead) on Skia, while keeping SeekBar's
 * tap/drag + pending-seek "hold" state machine verbatim so seeking behaves
 * identically. Peaks load offline (getWaveform) and fall back to flat bars.
 */
export function WaveformSeekBar({
  currentTime,
  duration,
  onSeek,
  height = CANVAS_HEIGHT,
  touchPadding = spacing.md,
  trackKey,
  trackPath,
}: WaveformSeekBarProps) {
  const [scrubFraction, setScrubFraction] = useState<number | null>(null);
  const [barWidth, setBarWidth] = useState(0);
  const [pendingSeek, setPendingSeek] = useState<{
    target: number;
    from: number;
    key?: string | number;
  } | null>(null);
  // Peaks tagged with the path they belong to, so a track change drops the old
  // waveform as a pure derivation (no synchronous setState in the effect).
  const [loaded, setLoaded] = useState<{ path: string; peaks: Float32Array | null } | null>(null);

  const widthRef = useRef(0);
  const scrubRef = useRef<number | null>(null);
  const grantRef = useRef({ fraction: 0, pageX: 0 });

  // Load (cache-first) the offline peaks whenever the track changes.
  useEffect(() => {
    if (!trackPath) return;
    let cancelled = false;
    void getWaveform(trackPath).then((peaks) => {
      if (!cancelled) setLoaded({ path: trackPath, peaks });
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
    setScrub(fraction);
  };

  const handleMove = (event: GestureResponderEvent) => {
    const delta = (event.nativeEvent.pageX - grantRef.current.pageX) / Math.max(1, widthRef.current);
    setScrub(clamp(grantRef.current.fraction + delta));
  };

  const handleRelease = () => {
    const fraction = scrubRef.current ?? grantRef.current.fraction;
    const target = fraction * duration;
    // Capture the pre-seek position so we can hold the target until the player
    // moves off it. Using `from` (not the target) means the hold releases when
    // the seek lands and can never re-engage as playback advances past target.
    setPendingSeek({ target, from: currentTime, key: trackKey });
    onSeek(target);
    setScrub(null);
  };

  // Displayed position: scrub > held seek target > live progress. Hold while the
  // player still reports the stale pre-seek position; release once it jumps.
  const holdSeek =
    pendingSeek != null &&
    pendingSeek.key === trackKey &&
    duration > 0 &&
    Math.abs(currentTime - pendingSeek.from) < HOLD_EPS;
  const liveFraction = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const heldFraction = holdSeek ? clamp(pendingSeek.target / duration) : null;
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
        onResponderTerminate={() => setScrub(null)}
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

const styles = StyleSheet.create({
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
});

export default WaveformSeekBar;
