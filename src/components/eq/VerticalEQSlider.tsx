import { useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent
} from 'react-native';
import { colors, radius } from '@/theme';

// Vertical fader cap (mixer-style): tall capsule with a horizontal grip line
// marking the exact value position. Half its height overshoots the rail at the
// extremes — the panel's meta-row padding absorbs (almost) all of it.
const PILL_W = 16;
const PILL_H = 32;
const HALO_W = 30;
const HALO_H = 50;
const TRACK_W = 4;

interface VerticalEQSliderProps {
  /** Accessibility label ("Bass"); the visible text lives in the panel's rows. */
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}

const clamp01 = (f: number) => Math.min(1, Math.max(0, f));

/**
 * Vertical gain rail for the graphic EQ — EQSlider's gesture pattern rotated:
 * anchor the fraction + pageY on grant, then track absolute page deltas so
 * drifting off the column can't corrupt the value. The rail spans the full
 * measured height and the pill center travels [0, height] — the exact scale
 * the GraphicResponseCurve behind it draws in. The bipolar fill runs from the
 * 0 dB midline to the handle, colored by sign (indigo boost / amber cut, the
 * same code as the readouts).
 */
export function VerticalEQSlider({ label, value, min, max, onChange }: VerticalEQSliderProps) {
  const [height, setHeight] = useState(0);
  const [active, setActive] = useState(false);
  const heightRef = useRef(0);
  const grantRef = useRef({ fraction: 0, pageY: 0 });

  // fraction 0 = bottom (min), 1 = top (max).
  const fraction = clamp01((value - min) / (max - min));

  const onLayout = (e: LayoutChangeEvent) => {
    heightRef.current = e.nativeEvent.layout.height;
    setHeight(e.nativeEvent.layout.height);
  };

  const handleGrant = (e: GestureResponderEvent) => {
    setActive(true);
    const f = 1 - clamp01(e.nativeEvent.locationY / Math.max(1, heightRef.current));
    grantRef.current = { fraction: f, pageY: e.nativeEvent.pageY };
    onChange(min + f * (max - min));
  };

  const handleMove = (e: GestureResponderEvent) => {
    const delta = (grantRef.current.pageY - e.nativeEvent.pageY) / Math.max(1, heightRef.current);
    onChange(min + clamp01(grantRef.current.fraction + delta) * (max - min));
  };

  const centerY = (1 - fraction) * height;
  // Bipolar fill: from the 0 dB midline to the pill center.
  const fillTop = fraction >= 0.5 ? centerY : height / 2;
  const fillHeight = Math.abs(fraction - 0.5) * height;

  return (
    <View
      style={styles.touch}
      onLayout={onLayout}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={handleGrant}
      onResponderMove={handleMove}
      onResponderRelease={() => setActive(false)}
      onResponderTerminate={() => setActive(false)}
      accessibilityRole="adjustable"
      accessibilityLabel={label}
    >
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            {
              top: fillTop,
              height: fillHeight,
              backgroundColor: value < 0 ? colors.warning : colors.accent,
            },
          ]}
        />
      </View>
      {active ? (
        <View pointerEvents="none" style={[styles.halo, { top: centerY - HALO_H / 2 }]} />
      ) : null}
      <View
        pointerEvents="none"
        style={[styles.pill, active && styles.pillActive, { top: centerY - PILL_H / 2 }]}
      >
        <View style={styles.pillLine} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  touch: {
    flex: 1,
    alignItems: 'center',
  },
  track: {
    flex: 1,
    width: TRACK_W,
    borderRadius: radius.pill,
    backgroundColor: colors.glassBorder,
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    width: TRACK_W,
    borderRadius: radius.pill,
  },
  // Soft indigo glow behind the pill while dragging.
  halo: {
    position: 'absolute',
    width: HALO_W,
    height: HALO_H,
    borderRadius: radius.pill,
    backgroundColor: colors.accentGlow,
  },
  pill: {
    position: 'absolute',
    width: PILL_W,
    height: PILL_H,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillActive: {
    transform: [{ scale: 1.08 }],
    backgroundColor: colors.accentHover,
  },
  // The fader's grip line — sits exactly on the value position (pill center).
  pillLine: {
    width: PILL_W - 6,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.bgSecondary,
  },
});

export default VerticalEQSlider;
