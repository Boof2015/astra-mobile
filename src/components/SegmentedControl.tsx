import { useEffect } from 'react';
import {
  Pressable,
  StyleSheet,
  View
} from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming
} from 'react-native-reanimated';
import {
  fonts,
  radius,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useRipple } from '@/theme/ripple';
import { motion } from '@/theme/motion';
import { playHaptic } from '@/lib/haptics';

const THUMB_INSET = 3;

export interface Segment {
  key: string;
  label: string;
}

interface SegmentedControlProps {
  segments: Segment[];
  value: string;
  onChange: (key: string) => void;
}

/**
 * Equal-width segmented control with a selection pill anchored inside the
 * active segment. The structural tie to `focused` keeps the pill and content
 * selection synchronized; labels still cross-fade via Animated.Text.
 */
export function SegmentedControl({ segments, value, onChange }: SegmentedControlProps) {
  const styles = useStyles();

  return (
    <View style={styles.track}>
      {segments.map((segment) => (
        <SegmentButton
          key={segment.key}
          label={segment.label}
          focused={segment.key === value}
          onPress={() => onChange(segment.key)}
        />
      ))}
    </View>
  );
}

function SegmentButton({
  label,
  focused,
  onPress,
}: {
  label: string;
  focused: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  // 0 = inactive, 1 = active; drives the label colour cross-fade.
  const progress = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(focused ? 1 : 0, motion.quick);
  }, [focused, progress]);

  // Locals so the worklet captures plain strings: a theme switch re-renders,
  // the captured values change, and Reanimated rebuilds the worklet.
  const inactiveColor = colors.textSecondary;
  const activeColor = colors.accentTextStrong;
  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, [0, 1], [inactiveColor, activeColor]),
  }));

  const handlePress = () => {
    if (focused) return;
    playHaptic('selection');
    onPress();
  };

  return (
    <Pressable
      android_ripple={ripple.bounded}
      style={styles.segment}
      onPress={handlePress}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
    >
      {focused ? <View style={styles.thumb} pointerEvents="none" /> : null}
      <Animated.Text style={[styles.label, labelStyle]} numberOfLines={1}>
        {label}
      </Animated.Text>
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  track: {
    flexDirection: 'row',
    backgroundColor: colors.glassBg,
    borderColor: colors.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    padding: THUMB_INSET,
  },
  thumb: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.glassHighlight,
    borderColor: colors.accent,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
  },
  label: {
    fontSize: 12,
    fontFamily: fonts.sans.medium,
  },
}));

export default SegmentedControl;
