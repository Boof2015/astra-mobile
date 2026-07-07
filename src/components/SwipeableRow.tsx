import { useState, type ReactNode } from 'react';
import {
  StyleSheet,
  View,
  type LayoutChangeEvent
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Gesture,
  GestureDetector,
  type GestureType
} from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming
} from 'react-native-reanimated';
import { useColors } from '@/theme/themed';
import { motion } from '@/theme/motion';
import { commitHaptic, tickHaptic } from '@/lib/haptics';

type IconName = keyof typeof Ionicons.glyphMap;

const SWIPE_ACTIVE_OFFSET_X = 10;
const SWIPE_FAIL_OFFSET_Y = 30;

export interface SwipeAction {
  icon: IconName;
  /** Background of the revealed action lane. */
  color: string;
  iconColor?: string;
  onCommit: () => void;
}

interface SwipeableRowProps {
  /** Revealed on the LEFT as the row is dragged right (a rightward swipe). */
  swipeRight?: SwipeAction;
  /** Revealed on the RIGHT as the row is dragged left (a leftward swipe). */
  swipeLeft?: SwipeAction;
  /**
   * Optional vertical gesture (e.g. a hold-to-drag reorder) raced against the
   * horizontal swipe in the SAME detector — composing here avoids the nested
   * GestureDetectors that broke continuous hold-and-drag.
   */
  dragGesture?: GestureType;
  enabled?: boolean;
  children: ReactNode;
}

/**
 * Horizontally swipeable row. Translation is clamped to ±width/2; a haptic tick
 * fires when crossing the ±width/4 "arm" point in either direction (arming to
 * commit, or backing off). Releasing past the arm point runs the matching
 * action; otherwise the row springs back. Vertical drags fall through so the row
 * still scrolls / lets a parent sheet pan.
 */
export function SwipeableRow({
  swipeRight,
  swipeLeft,
  dragGesture,
  enabled = true,
  children,
}: SwipeableRowProps) {
  const colors = useColors();
  const tx = useSharedValue(0);
  const armed = useSharedValue(false);
  const [rowWidth, setRowWidth] = useState(0);

  const max = rowWidth / 2;
  const arm = rowWidth / 4;
  const hasRight = !!swipeRight;
  const hasLeft = !!swipeLeft;

  const onLayout = (e: LayoutChangeEvent) => setRowWidth(e.nativeEvent.layout.width);

  const onCommit = (direction: 'right' | 'left') => {
    if (direction === 'right') swipeRight?.onCommit();
    else swipeLeft?.onCommit();
    commitHaptic();
  };

  const pan = Gesture.Pan()
    .enabled(enabled && rowWidth > 0 && (hasRight || hasLeft))
    .activeOffsetX([-SWIPE_ACTIVE_OFFSET_X, SWIPE_ACTIVE_OFFSET_X])
    .failOffsetY([-SWIPE_FAIL_OFFSET_Y, SWIPE_FAIL_OFFSET_Y])
    .onUpdate((e) => {
      let t = e.translationX;
      if (t > 0 && !hasRight) t = 0;
      if (t < 0 && !hasLeft) t = 0;
      t = Math.max(-max, Math.min(max, t));
      tx.value = t;
      const nowArmed = Math.abs(t) >= arm;
      if (nowArmed !== armed.value) {
        armed.value = nowArmed;
        runOnJS(tickHaptic)();
      }
    })
    .onEnd(() => {
      const t = tx.value;
      if (t >= arm && hasRight) runOnJS(onCommit)('right');
      else if (t <= -arm && hasLeft) runOnJS(onCommit)('left');
      armed.value = false;
      tx.value = withTiming(0, motion.quick);
    });

  // Race so a horizontal swipe and a (long-press) vertical drag never fight:
  // whichever activates first wins and cancels the other.
  const gesture = dragGesture ? Gesture.Race(dragGesture, pan) : pan;

  const contentStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));
  const leftLaneStyle = useAnimatedStyle(() => ({ opacity: tx.value > 1 ? 1 : 0 }));
  const rightLaneStyle = useAnimatedStyle(() => ({ opacity: tx.value < -1 ? 1 : 0 }));

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      {swipeRight ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.lane, styles.laneLeft, { backgroundColor: swipeRight.color }, leftLaneStyle]}
        >
          <Ionicons name={swipeRight.icon} size={22} color={swipeRight.iconColor ?? colors.bgPrimary} />
        </Animated.View>
      ) : null}
      {swipeLeft ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.lane, styles.laneRight, { backgroundColor: swipeLeft.color }, rightLaneStyle]}
        >
          <Ionicons name={swipeLeft.icon} size={22} color={swipeLeft.iconColor ?? colors.bgPrimary} />
        </Animated.View>
      ) : null}
      <GestureDetector gesture={gesture}>
        <Animated.View style={contentStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    overflow: 'hidden',
  },
  lane: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  laneLeft: {
    justifyContent: 'flex-start',
  },
  laneRight: {
    justifyContent: 'flex-end',
  },
});
