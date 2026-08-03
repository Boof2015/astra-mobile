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
  MAX_FONT_SCALE,
  fonts,
  fontSize,
  radius,
  variantLineHeight,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useRipple } from '@/theme/ripple';
import { motion } from '@/theme/motion';
import { playHaptic } from '@/lib/haptics';
import { useSelectionSlide } from './selectionSlide.ts';

/** The pill's breathing room inside the track. Now the track's own padding, so
 * the pill can be positioned in the same box its segments are measured in. */
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
 * Segmented control whose selection pill slides to the chosen segment.
 *
 * The pill follows the segment's *measured* box rather than its index — see
 * `selectionSlideMath` for why that distinction is the whole point. A `value`
 * matching no segment leaves the pill hidden instead of parked on the first one,
 * so it can never claim a selection the caller doesn't have. Labels still
 * cross-fade via Animated.Text.
 */
export function SegmentedControl({ segments, value, onChange }: SegmentedControlProps) {
  const styles = useStyles();
  const slide = useSelectionSlide(
    segments.some((segment) => segment.key === value) ? value : null,
    'horizontal'
  );
  const { offset, extent, presence } = slide;
  const thumbStyle = useAnimatedStyle(() => ({
    opacity: presence.value,
    width: extent.value,
    transform: [{ translateX: offset.value }],
  }));

  return (
    <View style={styles.track}>
      {/* The track carries the pill's inset as padding, so this row is the box
          both the pill and the segments are measured in. */}
      <View style={styles.row}>
        <Animated.View style={[styles.thumb, thumbStyle]} pointerEvents="none" />
        {segments.map((segment) => (
          <SegmentButton
            key={segment.key}
            label={segment.label}
            focused={segment.key === value}
            onLayout={slide.measure(segment.key)}
            onPress={() => onChange(segment.key)}
          />
        ))}
      </View>
    </View>
  );
}

function SegmentButton({
  label,
  focused,
  onPress,
  onLayout,
}: {
  label: string;
  focused: boolean;
  onPress: () => void;
  onLayout: (event: LayoutChangeEvent) => void;
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
      onLayout={onLayout}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
    >
      <Animated.Text
        style={[styles.label, labelStyle]}
        numberOfLines={1}
        // Without these the control's height is the font's business, and it
        // grows without bound on a large system font setting. Library reserves a
        // declared slot for this control, so its height has to be knowable.
        maxFontSizeMultiplier={MAX_FONT_SCALE}
      >
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
  // `flex` because the segments inside share it out from a zero basis: without
  // it this row sizes to their content, which is nothing, and the control
  // collapses.
  row: {
    flex: 1,
    flexDirection: 'row',
  },
  // Width and offset come from the focused segment's measurement; the vertical
  // inset is the track's padding around this row.
  thumb: {
    position: 'absolute',
    top: 0,
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
    fontSize: fontSize.sm,
    // Explicit, for the reason theme/typography.ts gives: without it the line box
    // comes from the font's own metrics and differs by OEM.
    lineHeight: variantLineHeight.label,
    fontFamily: fonts.sans.medium,
  },
}));

export default SegmentedControl;
