import { useRef, useState } from 'react';
import {
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent
} from 'react-native';
import { Text } from './Text';
import {
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles } from '@/theme/themed';
import { formatDuration } from '@/lib/format';

const THUMB_SIZE = 12;

interface SeekBarProps {
  currentTime: number;
  duration: number;
  onSeek: (seconds: number) => void;
  /** Identity of the playing track; a pending seek only applies to its own track. */
  trackKey?: string | number;
}

const clamp = (fraction: number) => Math.min(1, Math.max(0, fraction));

/**
 * Tap/drag seek bar with time labels. Plain progress bar for M1 — the
 * waveform seek bar port (desktop WaveformSeekBar) replaces the visuals at M3+.
 */
export function SeekBar({ currentTime, duration, onSeek, trackKey }: SeekBarProps) {
  const styles = useStyles();
  const [scrubFraction, setScrubFraction] = useState<number | null>(null);
  const [barWidth, setBarWidth] = useState(0);
  // Last released seek. Displayed instead of live progress until playback
  // catches up, so the bar doesn't snap back to a stale pre-seek progress
  // event; never cleared, just superseded or ignored (pure derivation below).
  const [pendingSeek, setPendingSeek] = useState<{ target: number; key?: string | number } | null>(
    null
  );

  // Gesture-internal values (only touched inside event handlers).
  const widthRef = useRef(0);
  const scrubRef = useRef<number | null>(null);
  const grantRef = useRef({ fraction: 0, pageX: 0 });

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
    setPendingSeek({ target, key: trackKey });
    onSeek(target);
    setScrub(null);
  };

  // Displayed position: scrub > held seek target > live progress. The held
  // target applies only while playback hasn't caught up on the same track.
  const holdSeek =
    pendingSeek != null &&
    pendingSeek.key === trackKey &&
    duration > 0 &&
    Math.abs(currentTime - pendingSeek.target) >= 1.5;
  const liveFraction = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const heldFraction = holdSeek ? clamp(pendingSeek.target / duration) : null;
  const fraction = scrubFraction ?? heldFraction ?? liveFraction;
  const shownTime = fraction * duration;

  return (
    <View>
      <View
        style={styles.touchArea}
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
        accessibilityValue={{
          min: 0,
          max: Math.round(duration),
          now: Math.round(shownTime),
        }}
      >
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${fraction * 100}%` }]} />
        </View>
        <View
          pointerEvents="none"
          style={[
            styles.thumb,
            scrubFraction != null && styles.thumbActive,
            { left: Math.max(0, fraction * barWidth - THUMB_SIZE / 2) },
          ]}
        />
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

const useStyles = createThemedStyles((colors) => ({
  touchArea: {
    justifyContent: 'center',
    paddingVertical: spacing.md, // generous touch target around the 4px track
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
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: colors.accent,
  },
  thumbActive: {
    transform: [{ scale: 1.35 }],
    backgroundColor: colors.accentHover,
  },
  times: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  time: {
    color: colors.textTertiary,
  },
  timeActive: {
    color: colors.accentText,
  },
}));

export default SeekBar;
