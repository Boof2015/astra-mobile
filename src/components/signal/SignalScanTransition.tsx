import { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { encodeSignal, type SignalPayload } from '@boof2015/astra-signal';
import { Text } from '@/components/Text';
import { SignalCode } from '@/components/signal/SignalCode';
import { SignalResultCard } from '@/components/signal/SignalResultCard';
import { SIGNAL_SCAN_GUIDE } from '@/audio/signalScanGeometry';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useRipple } from '@/theme/ripple';

export type SignalScanPhase = 'idle' | 'reading' | 'success' | 'failure';

interface SignalScanTransitionProps {
  phase: SignalScanPhase;
  width: number;
  height: number;
  payload: SignalPayload | null;
  onScanAnother: () => void;
  onDone: () => void;
}

const CODE_FG = '#0b0b12';
const CODE_BG = '#f4f4f6';
const PLACEHOLDER_COLUMNS = 40;
const PLACEHOLDER_LEVELS = 4;
const PLACEHOLDER_CHUNKS = 10;
const PLACEHOLDER_STRUCTURES = 4;
const PLACEHOLDER_TRANSITION_START = 0.12;
const PLACEHOLDER_TRANSITION_END = 0.78;
const PLACEHOLDER_UPPER_STRUCTURES = [
  '32113131144213313314341341344212232232',
  '12242324332343223433134344232332322424',
  '34241341144211313421324134431321242123',
  '24324314111412444413311432143222313213',
] as const;
const PLACEHOLDER_LOWER_STRUCTURES = [
  '44324232322142244243343132331243424114',
  '42221243244112214131412221131124441323',
  '43111413331343431142314112233243121433',
  '34441133421331212424112143414432243134',
] as const;

function placeholderChunkForIndex(index: number): number {
  'worklet';
  const innerIndex = index - 1;
  if (innerIndex < 4) return 0;
  if (innerIndex < 7) return 1;
  if (innerIndex < 12) return 2;
  if (innerIndex < 14) return 3;
  if (innerIndex < 18) return 4;
  if (innerIndex < 23) return 5;
  if (innerIndex < 26) return 6;
  if (innerIndex < 30) return 7;
  if (innerIndex < 33) return 8;
  return 9;
}

function PlaceholderCell({
  index,
  level,
  side,
  cycle,
}: {
  index: number;
  level: number;
  side: 'upper' | 'lower';
  cycle: SharedValue<number>;
}) {
  const cellStyle = useAnimatedStyle(() => {
    if (index === 0 || index === PLACEHOLDER_COLUMNS - 1) return { opacity: 1 };
    const structureProgress = cycle.value * PLACEHOLDER_STRUCTURES;
    const currentStructure = Math.floor(structureProgress) % PLACEHOLDER_STRUCTURES;
    const nextStructure = (currentStructure + 1) % PLACEHOLDER_STRUCTURES;
    const stageProgress = structureProgress - Math.floor(structureProgress);
    const transitionProgress = Math.max(
      0,
      Math.min(
        1,
        (stageProgress - PLACEHOLDER_TRANSITION_START)
          / (PLACEHOLDER_TRANSITION_END - PLACEHOLDER_TRANSITION_START)
      )
    );
    const chunk = placeholderChunkForIndex(index);
    const orderMultiplier = currentStructure % 2 === 0 ? 7 : 3;
    const orderOffset = (currentStructure * 3 + 1) % PLACEHOLDER_CHUNKS;
    const updatePosition = (chunk * orderMultiplier + orderOffset) % PLACEHOLDER_CHUNKS;
    const timingJitter = (((updatePosition * 7 + currentStructure * 5) % 5) - 2) * 0.018;
    const switchPoint = Math.max(
      0.04,
      Math.min(0.96, (updatePosition + 0.5) / PLACEHOLDER_CHUNKS + timingJitter)
    );
    const structure = transitionProgress >= switchPoint ? nextStructure : currentStructure;
    const structureLevels = side === 'upper'
      ? PLACEHOLDER_UPPER_STRUCTURES[structure]
      : PLACEHOLDER_LOWER_STRUCTURES[structure];
    const activeLevels = structureLevels.charCodeAt(index - 1) - 48;
    return { opacity: level < activeLevels ? 1 : 0 };
  }, [index, level, side]);

  return <Animated.View style={[styles.placeholderCell, cellStyle]} />;
}

function PlaceholderColumn({ index, cycle }: { index: number; cycle: SharedValue<number> }) {
  const levels = Array.from({ length: PLACEHOLDER_LEVELS }, (_, level) => level);
  return (
    <View style={styles.placeholderColumn}>
      <View style={[styles.placeholderStack, styles.placeholderUpperStack]}>
        {levels.map((level) => (
          <PlaceholderCell key={level} index={index} level={level} side="upper" cycle={cycle} />
        ))}
      </View>
      <View style={[styles.placeholderStack, styles.placeholderLowerStack]}>
        {levels.map((level) => (
          <PlaceholderCell key={level} index={index} level={level} side="lower" cycle={cycle} />
        ))}
      </View>
    </View>
  );
}

export function SignalScanTransition({
  phase,
  width,
  height,
  payload,
  onScanAnother,
  onDone,
}: SignalScanTransitionProps) {
  const themedStyles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  const overlayOpacity = useSharedValue(0);
  const lockProgress = useSharedValue(0);
  const settleProgress = useSharedValue(0);
  const resultProgress = useSharedValue(0);
  const actualOpacity = useSharedValue(0);
  const placeholderOpacity = useSharedValue(1);
  const failurePulse = useSharedValue(0);
  const cycle = useSharedValue(0);

  const layout = useMemo(() => (payload ? encodeSignal(payload) : null), [payload]);
  const guideWidth = width * (1 - SIGNAL_SCAN_GUIDE.horizontalInset * 2);
  const guideHeight = guideWidth / SIGNAL_SCAN_GUIDE.aspectRatio;
  const guideLeft = width * SIGNAL_SCAN_GUIDE.horizontalInset;
  const guideTop = height * SIGNAL_SCAN_GUIDE.top;
  const targetAvailableWidth = Math.max(1, width - spacing.lg * 4);
  const targetCodeWidth = layout
    ? Math.min(
        layout.tier === 'small' ? 280 : layout.tier === 'medium' ? 340 : targetAvailableWidth,
        targetAvailableWidth
      )
    : targetAvailableWidth;
  const targetCardWidth = targetCodeWidth + spacing.lg * 2;
  const targetCardHeight = layout
    ? (layout.heightModules / layout.widthModules) * targetCodeWidth + spacing.lg * 2
    : guideHeight;
  const targetLeft = (width - targetCardWidth) / 2;
  const targetTop = spacing.lg;
  const resultTop = targetTop + targetCardHeight + spacing.lg;

  useEffect(() => {
    if (phase === 'idle') {
      cancelAnimation(cycle);
      overlayOpacity.value = 0;
      lockProgress.value = 0;
      settleProgress.value = 0;
      resultProgress.value = 0;
      actualOpacity.value = 0;
      placeholderOpacity.value = 1;
      failurePulse.value = 0;
      cycle.value = 0;
      return;
    }

    if (phase === 'reading') {
      overlayOpacity.value = withTiming(1, { duration: 150 });
      lockProgress.value = withTiming(1, {
        duration: 240,
        easing: Easing.out(Easing.cubic),
      });
      settleProgress.value = 0;
      resultProgress.value = 0;
      actualOpacity.value = 0;
      placeholderOpacity.value = 1;
      failurePulse.value = 0;
      cycle.value = 0;
      cycle.value = withRepeat(
        withTiming(1, { duration: 4800, easing: Easing.linear }),
        -1,
        false
      );
      return;
    }

    if (phase === 'success') {
      cancelAnimation(cycle);
      actualOpacity.value = withTiming(1, { duration: 240 });
      placeholderOpacity.value = withTiming(0, { duration: 220 });
      settleProgress.value = withDelay(
        100,
        withTiming(1, { duration: 340, easing: Easing.out(Easing.cubic) })
      );
      resultProgress.value = withDelay(
        300,
        withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) })
      );
      return;
    }

    cancelAnimation(cycle);
    failurePulse.value = withSequence(
      withTiming(1, { duration: 120 }),
      withTiming(0, { duration: 180 })
    );
    placeholderOpacity.value = withTiming(0, { duration: 180 });
    lockProgress.value = withDelay(80, withTiming(0, { duration: 240 }));
    overlayOpacity.value = withDelay(220, withTiming(0, { duration: 220 }));
  }, [
    actualOpacity,
    cycle,
    failurePulse,
    lockProgress,
    overlayOpacity,
    phase,
    placeholderOpacity,
    resultProgress,
    settleProgress,
  ]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }));
  const guideStyle = useAnimatedStyle(() => ({
    opacity: 1 - lockProgress.value,
    transform: [{ scaleX: interpolate(lockProgress.value, [0, 1], [1, 0.84]) }],
  }));
  const cardStyle = useAnimatedStyle(() => ({
    left: interpolate(settleProgress.value, [0, 1], [guideLeft, targetLeft]),
    top: interpolate(settleProgress.value, [0, 1], [guideTop, targetTop]),
    width: interpolate(settleProgress.value, [0, 1], [guideWidth, targetCardWidth]),
    height: interpolate(settleProgress.value, [0, 1], [guideHeight, targetCardHeight]),
    opacity: lockProgress.value,
    transform: [{ scale: interpolate(lockProgress.value, [0, 1], [0.94, 1]) }],
  }), [guideHeight, guideLeft, guideTop, guideWidth, targetCardHeight, targetCardWidth, targetLeft, targetTop]);
  const placeholderStyle = useAnimatedStyle(() => ({ opacity: placeholderOpacity.value }));
  const actualStyle = useAnimatedStyle(() => ({ opacity: actualOpacity.value }));
  const failureStyle = useAnimatedStyle(() => ({ opacity: failurePulse.value }));
  const resultStyle = useAnimatedStyle(() => ({
    opacity: resultProgress.value,
    transform: [{ translateY: interpolate(resultProgress.value, [0, 1], [18, 0]) }],
  }));

  if (phase === 'idle' || width <= 0 || height <= 0) return null;

  return (
    <Animated.View
      pointerEvents={phase === 'success' ? 'auto' : 'none'}
      style={[themedStyles.overlay, overlayStyle]}
    >
      <Animated.View
        style={[
          themedStyles.guide,
          { left: guideLeft, top: guideTop, width: guideWidth, height: guideHeight },
          guideStyle,
        ]}
      >
        <View style={[themedStyles.guideCorner, themedStyles.guideTopLeft]} />
        <View style={[themedStyles.guideCorner, themedStyles.guideTopRight]} />
        <View style={[themedStyles.guideCorner, themedStyles.guideBottomLeft]} />
        <View style={[themedStyles.guideCorner, themedStyles.guideBottomRight]} />
      </Animated.View>

      <Animated.View style={[themedStyles.carrier, cardStyle]}>
        <Animated.View style={[styles.placeholderField, placeholderStyle]}>
          {Array.from({ length: PLACEHOLDER_COLUMNS }, (_, index) => (
            <PlaceholderColumn key={index} index={index} cycle={cycle} />
          ))}
        </Animated.View>

        {layout ? (
          <Animated.View style={[styles.actualSignal, actualStyle]}>
            <SignalCode
              layout={layout}
              width={targetCodeWidth}
              foreground={CODE_FG}
              background={CODE_BG}
            />
          </Animated.View>
        ) : null}

        <Animated.View pointerEvents="none" style={[themedStyles.failureOutline, failureStyle]} />
      </Animated.View>

      {payload ? (
        <Animated.View style={[themedStyles.resultPanel, { top: resultTop }, resultStyle]}>
          <SignalResultCard payload={payload} compact />
          <View style={themedStyles.resultActions}>
            <Pressable
              android_ripple={ripple.bounded}
              style={themedStyles.primaryButton}
              onPress={onScanAnother}
            >
              <Ionicons name="scan-outline" size={18} color={colors.accentTextStrong} />
              <Text variant="body" color={colors.accentTextStrong}>
                Scan another
              </Text>
            </Pressable>
            <Pressable
              android_ripple={ripple.bounded}
              style={themedStyles.secondaryButton}
              onPress={onDone}
            >
              <Text variant="body" color={colors.textPrimary}>
                Done
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  placeholderField: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.md,
    flexDirection: 'row',
  },
  placeholderColumn: {
    flex: 1,
    height: '100%',
  },
  placeholderStack: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: '39%',
  },
  placeholderUpperStack: {
    bottom: '50%',
    flexDirection: 'column-reverse',
  },
  placeholderLowerStack: {
    top: '50%',
  },
  placeholderCell: {
    flex: 1,
    marginHorizontal: -StyleSheet.hairlineWidth,
    marginVertical: -StyleSheet.hairlineWidth,
    backgroundColor: CODE_FG,
  },
  actualSignal: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const useStyles = createThemedStyles((colors) => ({
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 20,
    overflow: 'hidden',
    backgroundColor: colors.bgPrimary,
  },
  guide: {
    position: 'absolute',
  },
  guideCorner: {
    position: 'absolute',
    width: 30,
    height: 22,
    borderColor: colors.accent,
  },
  guideTopLeft: {
    left: 0,
    top: 0,
    borderLeftWidth: 3,
    borderTopWidth: 3,
    borderTopLeftRadius: radius.sm,
  },
  guideTopRight: {
    right: 0,
    top: 0,
    borderRightWidth: 3,
    borderTopWidth: 3,
    borderTopRightRadius: radius.sm,
  },
  guideBottomLeft: {
    left: 0,
    bottom: 0,
    borderLeftWidth: 3,
    borderBottomWidth: 3,
    borderBottomLeftRadius: radius.sm,
  },
  guideBottomRight: {
    right: 0,
    bottom: 0,
    borderRightWidth: 3,
    borderBottomWidth: 3,
    borderBottomRightRadius: radius.sm,
  },
  carrier: {
    position: 'absolute',
    overflow: 'hidden',
    borderRadius: radius.lg,
    backgroundColor: CODE_BG,
    elevation: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
  },
  failureOutline: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderWidth: 3,
    borderRadius: radius.lg,
    borderColor: colors.warning,
  },
  resultPanel: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    gap: spacing.md,
  },
  resultActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  primaryButton: {
    minHeight: 48,
    flex: 1.35,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
  },
  secondaryButton: {
    minHeight: 48,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.bgSecondary,
  },
}));
