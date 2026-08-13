import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import {
  Canvas,
  Group,
  LinearGradient,
  Path,
  Rect,
  Skia,
  vec,
  type SkPath,
} from '@shopify/react-native-skia';
import {
  Easing,
  ReduceMotion,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Text } from '@/components/Text';
import { formatBucketDate, formatListeningTime } from '@/listeningStats/format';
import { playHaptic } from '@/lib/haptics';
import { radius, spacing } from '@/theme';
import { motion } from '@/theme/motion';
import { createThemedStyles, useColors } from '@/theme/themed';
import type {
  ListeningStatsActivityBucket,
  ListeningStatsGranularity,
  ListeningStatsRankingMetric,
} from '@/types/listeningStats';
import {
  CHART_PLOT_HEIGHT,
  animatedBarHeight,
  barHeights,
  barSlots,
  nearestBarIndex,
  type BarSlot,
} from './activityChartMath';

/** Reveal sweep on first paint and on range/metric change. */
const WIPE = {
  duration: 520,
  easing: Easing.out(Easing.cubic),
  reduceMotion: ReduceMotion.System,
} as const;

const GRANULARITY_LABEL: Record<ListeningStatsGranularity, string> = {
  day: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
};

interface ActivityChartProps {
  buckets: readonly ListeningStatsActivityBucket[];
  granularity: ListeningStatsGranularity;
  metric: ListeningStatsRankingMetric;
}

/**
 * Listening activity over the selected range, drawn as one Skia canvas measured
 * by `onLayout` — the same idiom as EQGraph. Bars are positioned in absolute
 * pixels across the measured width, so every range fills the card and nothing
 * scrolls. Bar heights animate on the UI thread, so the reveal and subsequent
 * value changes cost no React renders.
 *
 * The caller remounts this on range/metric change (via `key`), which restarts
 * the reveal and drops the selection. Refreshes that keep the same range reuse
 * the mount, so bars glide to their new heights instead of re-sweeping.
 */
export function ActivityChart({ buckets, granularity, metric }: ActivityChartProps) {
  const styles = useStyles();
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const count = buckets.length;
  const values = useMemo(
    () =>
      buckets.map((bucket) =>
        metric === 'plays' ? bucket.qualifiedPlays : bucket.listenedSeconds,
      ),
    [buckets, metric],
  );
  const slots = useMemo(() => barSlots(count, width), [count, width]);
  const heights = useMemo(() => barHeights(values, CHART_PLOT_HEIGHT), [values]);

  // `wipe` drives the left-to-right reveal; `morph` cross-fades bar heights when
  // a background refresh lands, so new listening slides in without re-sweeping.
  const wipe = useSharedValue(0);
  const morph = useSharedValue(1);
  const fromHeights = useSharedValue<number[]>([]);
  const toHeights = useSharedValue<number[]>([]);

  useEffect(() => {
    wipe.value = 0;
    wipe.value = withTiming(1, WIPE);
  }, [wipe]);

  useEffect(() => {
    const settled = toHeights.value;
    // Only tween when the bucket count is unchanged; a different count means new
    // geometry, which should land immediately rather than morph through it.
    fromHeights.value = settled.length === heights.length ? settled : heights;
    toHeights.value = heights;
    morph.value = 0;
    morph.value = withTiming(1, motion.quick);
  }, [heights, fromHeights, toHeights, morph]);

  // Explicit dependency arrays: the paths must rebuild whenever the measured
  // geometry or the selection changes, and relying on inferred dependencies here
  // would risk a chart that never repaints after its first layout pass.
  const barsPath = useDerivedValue(() => {
    const path = Skia.Path.Make();
    const from = fromHeights.value;
    const to = toHeights.value;
    const settle = morph.value;
    const reveal = wipe.value;
    for (let i = 0; i < slots.length; i++) {
      if (i === selectedIndex) continue;
      addBar(path, slots[i], animatedBarHeight(from, to, settle, reveal, i, slots.length));
    }
    return path;
  }, [slots, selectedIndex]);

  const selectedPath = useDerivedValue(() => {
    const path = Skia.Path.Make();
    const slot = selectedIndex == null ? undefined : slots[selectedIndex];
    if (selectedIndex == null || !slot) return path;
    const height = animatedBarHeight(
      fromHeights.value,
      toHeights.value,
      morph.value,
      wipe.value,
      selectedIndex,
      slots.length,
    );
    addBar(path, slot, height);
    return path;
  }, [slots, selectedIndex]);

  const onLayout = (event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  };

  // Dragging scrubs the chart — essential once bars are only a few px wide.
  const lastScrubbed = useRef<number | null>(null);
  const scrubTo = useCallback(
    (x: number) => {
      const index = nearestBarIndex(x, count, width);
      if (index < 0 || index === lastScrubbed.current) return;
      lastScrubbed.current = index;
      setSelectedIndex(index);
      playHaptic('frequentStep');
    },
    [count, width],
  );

  const handleGrant = (event: GestureResponderEvent) => {
    lastScrubbed.current = null;
    scrubTo(event.nativeEvent.locationX);
  };
  const handleMove = (event: GestureResponderEvent) => {
    scrubTo(event.nativeEvent.locationX);
  };

  const stepSelection = useCallback(
    (delta: number) => {
      setSelectedIndex((current) => {
        const base = current ?? count - 1;
        return Math.max(0, Math.min(count - 1, base + delta));
      });
    },
    [count],
  );

  const selected = selectedIndex != null ? buckets[selectedIndex] : null;
  const readout = selected
    ? `${formatBucketDate(selected.startAt, selected.endAt)} · ${formatListeningTime(selected.listenedSeconds)} · ${selected.qualifiedPlays} ${selected.qualifiedPlays === 1 ? 'play' : 'plays'}`
    : null;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text variant="heading">Activity</Text>
        <Text variant="caption" color={colors.textSecondary}>
          {GRANULARITY_LABEL[granularity]}
        </Text>
      </View>

      {/* Reserved so selecting a bucket can't change the card's height. */}
      <View style={styles.readout}>
        <Text
          variant="caption"
          color={selected ? colors.textPrimary : colors.textTertiary}
          numberOfLines={1}
        >
          {readout ?? 'Touch the chart for a breakdown'}
        </Text>
      </View>

      <View
        style={styles.plot}
        onLayout={onLayout}
        onStartShouldSetResponder={() => count > 0}
        onMoveShouldSetResponder={() => count > 0}
        onResponderTerminationRequest={() => false}
        onResponderGrant={handleGrant}
        onResponderMove={handleMove}
        accessibilityRole="adjustable"
        accessibilityLabel={`Listening activity, ${GRANULARITY_LABEL[granularity].toLowerCase()}`}
        accessibilityValue={{ text: readout ?? 'No period selected' }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'increment') stepSelection(1);
          else if (event.nativeEvent.actionName === 'decrement') stepSelection(-1);
        }}
      >
        {width > 0 && count > 0 ? (
          <Canvas style={styles.canvas}>
            {/* Unselected bars sit back; the selected bar reads at full strength.
                An opacity split is legible where the previous accent/accentHover
                pair differed by only ~8% lightness. */}
            <Group opacity={0.34}>
              <Path path={barsPath}>
                <LinearGradient
                  start={vec(0, 0)}
                  end={vec(0, CHART_PLOT_HEIGHT)}
                  colors={[colors.accentHover, colors.accent]}
                />
              </Path>
            </Group>
            <Path path={selectedPath}>
              <LinearGradient
                start={vec(0, 0)}
                end={vec(0, CHART_PLOT_HEIGHT)}
                colors={[colors.accentHover, colors.accent]}
              />
            </Path>
            <Rect
              x={0}
              y={CHART_PLOT_HEIGHT}
              width={width}
              height={1}
              color={colors.glassBorder}
            />
          </Canvas>
        ) : null}
      </View>

      {/* Two labels instead of every Nth bar: legible at 53 buckets, and immune
          to the baseline jitter the old per-bar label/spacer pair caused. */}
      {count > 0 ? (
        <View style={styles.axis}>
          <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
            {buckets[0].label}
          </Text>
          <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
            {buckets[count - 1].label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function addBar(path: SkPath, slot: BarSlot, height: number): void {
  'worklet';
  path.addRRect({
    rect: {
      x: slot.x,
      y: CHART_PLOT_HEIGHT - height,
      width: slot.width,
      height,
    },
    rx: slot.radius,
    ry: slot.radius,
  });
}

const useStyles = createThemedStyles((colors) => ({
  card: {
    padding: spacing.lg,
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  readout: {
    minHeight: 16,
    justifyContent: 'center',
  },
  plot: {
    height: CHART_PLOT_HEIGHT + 1,
  },
  canvas: {
    flex: 1,
  },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
}));
