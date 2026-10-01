import { useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  type AccessibilityActionEvent,
  type GestureResponderEvent
} from 'react-native';
import { Text } from '@/components/Text';
import { AppPressable } from '@/components/AppPressable';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { mixHex } from '@/theme/colorUtils';
import { playHaptic } from '@/lib/haptics';
import {
  SCRUB_DETENT_SPACING_DP,
  SCRUB_TICK_ACTIVATION_DISTANCE_DP,
  SCRUB_TICK_MIN_INTERVAL_MS
} from '@/components/waveformScrubDetents';
import {
  paramFraction,
  scrubValue,
  stepValue,
  type PEQParam
} from './peqGeometry';

const TICKS = 21;
const TOUCH_HEIGHT = 44;

interface ParamScrubberProps {
  label: string;
  param: PEQParam;
  value: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  /** Open the exact value editor (the sheet lives at the screen root). */
  onValuePress: () => void;
  /** The parameter doesn't apply to this band (gain on a pass filter). */
  disabled?: boolean;
  /** The band's color, for the filled ticks and the thumb. */
  tint: string;
}

/**
 * One band parameter: its name, its value (tap to type an exact one), and a
 * scrub track under it.
 *
 * The track shows where the value sits in its range, but dragging it is
 * *relative* — the value moves by how far the finger has travelled since it
 * went down, never to where the finger is, so touching it can't make the value
 * jump. The rates in `scrubValue` are finer than the graph's, and the finger
 * may run past the column once it has hold, so a whole-range sweep still fits
 * in a narrow column. Anchored on page coordinates, the SeekBar/EQSlider way.
 */
export function ParamScrubber({
  label,
  param,
  value,
  format,
  onChange,
  onValuePress,
  disabled = false,
  tint,
}: ParamScrubberProps) {
  const styles = useStyles();
  const colors = useColors();
  const [active, setActive] = useState(false);
  const scrubRef = useRef({
    pageX: 0,
    start: 0,
    last: 0,
    tickIndex: 0,
    tickValue: 0,
    lastTickAt: 0,
    activated: false,
  });

  const handleGrant = (e: GestureResponderEvent) => {
    setActive(true);
    scrubRef.current = {
      pageX: e.nativeEvent.pageX,
      start: value,
      last: value,
      tickIndex: 0,
      tickValue: value,
      lastTickAt: 0,
      activated: false,
    };
  };

  const handleMove = (e: GestureResponderEvent) => {
    const s = scrubRef.current;
    const dx = e.nativeEvent.pageX - s.pageX;
    const next = scrubValue(param, s.start, dx);
    if (next !== s.last) {
      if (param === 'gain' && next === 0 && s.last !== 0) playHaptic('threshold');
      s.last = next;
      onChange(next);
    }

    // A detent tick per stretch of travel — and only while the value is still
    // moving, so pinning it at a limit goes quiet.
    s.activated ||= Math.abs(dx) >= SCRUB_TICK_ACTIVATION_DISTANCE_DP;
    const index = Math.floor(dx / SCRUB_DETENT_SPACING_DP);
    if (!s.activated || index === s.tickIndex) return;
    s.tickIndex = index;
    const now = Date.now();
    if (next === s.tickValue || now - s.lastTickAt < SCRUB_TICK_MIN_INTERVAL_MS) return;
    s.tickValue = next;
    s.lastTickAt = now;
    playHaptic('scrubStep');
  };

  const handleAccessibilityAction = (e: AccessibilityActionEvent) => {
    const direction = e.nativeEvent.actionName === 'increment' ? 1 : -1;
    onChange(stepValue(param, value, direction));
  };

  const fraction = paramFraction(param, value);
  const shown = disabled ? '—' : format(value);

  return (
    <View style={[styles.column, disabled && styles.disabled]}>
      <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>
        {label}
      </Text>
      <AppPressable
        feedback="none"
        disabled={disabled}
        // Same deliberate pressed emphasis as EQSlider's value box: it marks the
        // value as editable, not just pressed.
        style={({ pressed }) => [styles.valueButton, pressed && styles.valueButtonPressed]}
        onPress={onValuePress}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${label}, ${shown}`}
      >
        <Text variant="mono" style={styles.value} numberOfLines={1}>
          {shown}
        </Text>
      </AppPressable>
      <View
        style={styles.touch}
        pointerEvents={disabled ? 'none' : 'auto'}
        onStartShouldSetResponder={() => !disabled}
        onMoveShouldSetResponder={() => !disabled}
        onResponderTerminationRequest={() => false}
        onResponderGrant={handleGrant}
        onResponderMove={handleMove}
        onResponderRelease={() => setActive(false)}
        onResponderTerminate={() => setActive(false)}
        accessible={!disabled}
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: shown }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={handleAccessibilityAction}
      >
        <View style={styles.ticks}>
          {Array.from({ length: TICKS }, (_, i) => (
            <View
              key={i}
              style={[
                styles.tick,
                i / (TICKS - 1) <= fraction && [styles.tickFilled, { backgroundColor: tint, opacity: 0.7 }],
              ]}
            />
          ))}
        </View>
        <View style={styles.baseline} />
        <View
          pointerEvents="none"
          style={[styles.thumb, active && styles.thumbActive, { left: `${fraction * 100}%`, backgroundColor: tint }]}
        />
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  column: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  disabled: {
    opacity: 0.4,
  },
  valueButton: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    backgroundColor: colors.bgTertiary,
  },
  valueButtonPressed: {
    borderColor: colors.accent,
    backgroundColor: mixHex(colors.bgTertiary, colors.accent, 0.12),
  },
  value: {
    color: colors.textPrimary,
  },
  touch: {
    height: TOUCH_HEIGHT,
    justifyContent: 'center',
  },
  ticks: {
    height: 10,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  tick: {
    width: 1,
    height: 6,
    borderRadius: 1,
    backgroundColor: colors.glassBorder,
  },
  tickFilled: {
    height: 10,
  },
  baseline: {
    height: 1,
    marginTop: 2,
    backgroundColor: colors.glassBorder,
  },
  thumb: {
    position: 'absolute',
    width: 2,
    height: 20,
    marginLeft: -1,
    borderRadius: 1,
  },
  thumbActive: {
    width: 3,
    height: 26,
    marginLeft: -1.5,
  },
}));

export default ParamScrubber;
