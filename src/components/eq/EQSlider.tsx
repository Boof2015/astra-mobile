import { useRef, useState } from 'react';
import {
  Pressable,
  View,
  StyleSheet,
  type GestureResponderEvent,
  type LayoutChangeEvent
} from 'react-native';
import { Text } from '@/components/Text';
import {
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles } from '@/theme/themed';

const THUMB = 16;

interface EQSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Logarithmic mapping (for frequency). */
  log?: boolean;
  format: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
  onValuePress?: () => void;
}

const clamp01 = (f: number) => Math.min(1, Math.max(0, f));

/** Labeled horizontal slider following the SeekBar gesture/derivation pattern. */
export function EQSlider({
  label,
  value,
  min,
  max,
  log,
  format,
  onChange,
  disabled,
  onValuePress,
}: EQSliderProps) {
  const styles = useStyles();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState(false);
  const widthRef = useRef(0);
  // Anchor on grant, then track absolute pageX deltas so veering off the row
  // vertically can't corrupt the value (the SeekBar pattern).
  const grantRef = useRef({ fraction: 0, pageX: 0 });

  const valueToFraction = (v: number): number => {
    if (log) {
      const lo = Math.log10(min);
      const hi = Math.log10(max);
      return clamp01((Math.log10(Math.max(min, v)) - lo) / (hi - lo));
    }
    return clamp01((v - min) / (max - min));
  };

  const fractionToValue = (f: number): number => {
    if (log) {
      const lo = Math.log10(min);
      const hi = Math.log10(max);
      return 10 ** (lo + clamp01(f) * (hi - lo));
    }
    return min + clamp01(f) * (max - min);
  };

  const onLayout = (e: LayoutChangeEvent) => {
    widthRef.current = e.nativeEvent.layout.width;
    setWidth(e.nativeEvent.layout.width);
  };

  const handleGrant = (e: GestureResponderEvent) => {
    setActive(true);
    const f = clamp01(e.nativeEvent.locationX / Math.max(1, widthRef.current));
    grantRef.current = { fraction: f, pageX: e.nativeEvent.pageX };
    onChange(fractionToValue(f));
  };

  const handleMove = (e: GestureResponderEvent) => {
    const delta = (e.nativeEvent.pageX - grantRef.current.pageX) / Math.max(1, widthRef.current);
    onChange(fractionToValue(clamp01(grantRef.current.fraction + delta)));
  };

  const fraction = valueToFraction(value);

  return (
    <View style={[styles.row, disabled && styles.disabled]}>
      <Text variant="label" style={styles.label}>
        {label}
      </Text>
      <View
        style={styles.touch}
        onLayout={onLayout}
        onStartShouldSetResponder={() => !disabled}
        onMoveShouldSetResponder={() => !disabled}
        onResponderTerminationRequest={() => false}
        onResponderGrant={handleGrant}
        onResponderMove={handleMove}
        onResponderRelease={() => setActive(false)}
        onResponderTerminate={() => setActive(false)}
        accessibilityRole="adjustable"
        accessibilityLabel={label}
      >
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
        </View>
        <View
          pointerEvents="none"
          style={[
            styles.thumb,
            active && styles.thumbActive,
            { left: Math.max(0, fraction * width - THUMB / 2) },
          ]}
        />
      </View>
      {onValuePress && !disabled ? (
        <Pressable
          style={({ pressed }) => [styles.valueButton, pressed && styles.valueButtonPressed]}
          onPress={onValuePress}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${label}`}
        >
          <Text variant="mono" style={styles.value}>
            {format(value)}
          </Text>
        </Pressable>
      ) : (
        <Text variant="mono" style={styles.value}>
          {format(value)}
        </Text>
      )}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  disabled: {
    opacity: 0.4,
  },
  label: {
    width: 78,
  },
  touch: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  track: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.glassBorder,
    overflow: 'hidden',
  },
  fill: {
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.accent,
  },
  thumbActive: {
    transform: [{ scale: 1.3 }],
    backgroundColor: colors.accentHover,
  },
  valueButton: {
    minWidth: 68,
    alignItems: 'flex-end',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  valueButtonPressed: {
    borderColor: colors.accent,
    backgroundColor: colors.glassHighlight,
  },
  value: {
    width: 64,
    textAlign: 'right',
    color: colors.textPrimary,
  },
}));

export default EQSlider;
