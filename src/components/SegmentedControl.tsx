import { useEffect } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent
} from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming
} from 'react-native-reanimated';
import {
  colors,
  fonts,
  radius
} from '@/theme';
import { motion } from '@/theme/motion';

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
 * Equal-width segmented control on the TabBar "playhead" pattern: one glass
 * track, a thumb that glides to the active segment, labels cross-fading to the
 * accent via interpolateColor on Animated.Text. Spring-free per theme/motion.
 */
export function SegmentedControl({ segments, value, onChange }: SegmentedControlProps) {
  const count = segments.length;
  const activeIndex = Math.max(
    0,
    segments.findIndex((segment) => segment.key === value),
  );

  const trackWidth = useSharedValue(0);
  const position = useSharedValue(activeIndex);

  useEffect(() => {
    position.value = withTiming(activeIndex, motion.snap);
  }, [activeIndex, position]);

  const thumbStyle = useAnimatedStyle(() => {
    const segment = count > 0 ? (trackWidth.value - THUMB_INSET * 2) / count : 0;
    return {
      width: segment,
      transform: [{ translateX: position.value * segment }],
    };
  });

  const onTrackLayout = (e: LayoutChangeEvent) => {
    trackWidth.value = e.nativeEvent.layout.width;
  };

  return (
    <View style={styles.track} onLayout={onTrackLayout}>
      <Animated.View style={[styles.thumb, thumbStyle]} pointerEvents="none" />
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
  // 0 = inactive, 1 = active; drives the label colour cross-fade.
  const progress = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(focused ? 1 : 0, motion.quick);
  }, [focused, progress]);

  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(
      progress.value,
      [0, 1],
      [colors.textSecondary, colors.accentTextStrong],
    ),
  }));

  return (
    <Pressable
      style={({ pressed }) => [styles.segment, pressed && styles.segmentPressed]}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
    >
      <Animated.Text style={[styles.label, labelStyle]} numberOfLines={1}>
        {label}
      </Animated.Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
    top: THUMB_INSET,
    bottom: THUMB_INSET,
    left: THUMB_INSET,
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
  segmentPressed: {
    opacity: 0.72,
  },
  label: {
    fontSize: 12,
    fontFamily: fonts.sans.medium,
  },
});

export default SegmentedControl;
