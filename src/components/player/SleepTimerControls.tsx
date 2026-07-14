import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Text } from '@/components/Text';
import { SLEEP_TIMER_PRESETS, formatSleepTimerStatus, normalizeSleepTimerMinutes } from '@/audio/sleepTimerState';
import { supportsNativePauseAtEndOfItem } from '@/audio/trackPlayerExtensions';
import { usePlayerStore } from '@/stores/playerStore';
import { usePlaybackTargetStore } from '@/stores/playbackTargetStore';
import { useSleepTimerStore } from '@/stores/sleepTimerStore';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { SCROLL_PRESS_DELAY, useRipple } from '@/theme/ripple';

export function SleepTimerControls() {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  const timer = useSleepTimerStore((s) => s.timer);
  const remainingMs = useSleepTimerStore((s) => s.remainingMs);
  const hydrate = useSleepTimerStore((s) => s.hydrate);
  const startMinutes = useSleepTimerStore((s) => s.startMinutes);
  const startEndOfTrack = useSleepTimerStore((s) => s.startEndOfTrack);
  const cancel = useSleepTimerStore((s) => s.cancel);
  const reconcile = useSleepTimerStore((s) => s.reconcile);
  const target = usePlaybackTargetStore((s) => s.target);
  const track = usePlayerStore((s) => s.currentTrack);
  const [customMinutes, setCustomMinutes] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const available = target === 'phone' && Boolean(track);
  void remainingMs;

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!timer) return;
    const interval = setInterval(() => void reconcile(), 1000);
    return () => clearInterval(interval);
  }, [reconcile, timer]);

  const run = async (action: () => Promise<void>, success: string) => {
    setFeedback(null);
    try {
      await action();
      setFeedback(success);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Could not update the sleep timer.');
    }
  };

  const startCustom = () => {
    const minutes = normalizeSleepTimerMinutes(customMinutes);
    if (minutes === null) {
      setFeedback('Enter a whole number from 1 to 720 minutes.');
      return;
    }
    void run(() => startMinutes(minutes), `Timer set for ${minutes} minutes.`);
  };

  return (
    <View style={styles.container}>
      <View style={styles.statusBlock}>
        <Text variant="body">{timer ? formatSleepTimerStatus(timer) : 'No sleep timer'}</Text>
        <Text variant="caption" color={colors.textSecondary}>
          {!available
            ? target === 'desktop'
              ? 'Sleep timers are available for phone playback only.'
              : 'Load a track on this phone to set a timer.'
            : timer?.mode === 'minutes'
              ? 'Wall-clock time continues while playback is paused.'
              : timer?.mode === 'end-of-track'
                ? 'Seeking and manual skips keep the timer armed.'
                : 'Playback pauses without clearing the queue or position.'}
        </Text>
      </View>

      <View style={styles.presets}>
        {SLEEP_TIMER_PRESETS.map((minutes) => (
          <Pressable
            key={minutes}
            disabled={!available}
            android_ripple={ripple.bounded}
            unstable_pressDelay={SCROLL_PRESS_DELAY}
            onPress={() => void run(() => startMinutes(minutes), `Timer set for ${minutes} minutes.`)}
            style={({ pressed }) => [styles.preset, !available && styles.disabled, pressed && available && styles.pressed]}
            accessibilityRole="button"
          >
            <Text variant="label" color={colors.textPrimary}>{minutes} min</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.customRow}>
        <TextInput
          value={customMinutes}
          onChangeText={setCustomMinutes}
          editable={available}
          keyboardType="number-pad"
          returnKeyType="done"
          placeholder="1–720"
          placeholderTextColor={colors.textTertiary}
          onSubmitEditing={startCustom}
          style={[styles.input, !available && styles.disabled]}
          accessibilityLabel="Custom sleep timer minutes"
        />
        <Pressable
          disabled={!available}
          android_ripple={ripple.bounded}
          onPress={startCustom}
          style={({ pressed }) => [styles.action, !available && styles.disabled, pressed && available && styles.pressed]}
        >
          <Text variant="label" color={colors.accentTextStrong}>Set custom</Text>
        </Pressable>
      </View>

      <Pressable
        disabled={!available || !supportsNativePauseAtEndOfItem()}
        android_ripple={ripple.bounded}
        onPress={() => void run(startEndOfTrack, 'Timer set for the end of the track.')}
        style={({ pressed }) => [
          styles.fullAction,
          (!available || !supportsNativePauseAtEndOfItem()) && styles.disabled,
          pressed && available && styles.pressed,
        ]}
      >
        <Text variant="body">End of track</Text>
        <Text variant="caption" color={colors.textSecondary}>
          {supportsNativePauseAtEndOfItem() ? 'Pause exactly before the next track begins.' : 'Requires the Android playback engine.'}
        </Text>
      </Pressable>

      {timer ? (
        <Pressable android_ripple={ripple.bounded} onPress={() => void run(cancel, 'Sleep timer canceled.')} style={styles.cancel}>
          <Text variant="label" color={colors.warning}>Cancel sleep timer</Text>
        </Pressable>
      ) : null}

      {feedback ? <Text variant="caption" color={colors.textSecondary}>{feedback}</Text> : null}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  container: { gap: spacing.md },
  statusBlock: { gap: 3 },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  preset: {
    flexGrow: 1, minWidth: 66, alignItems: 'center', paddingVertical: spacing.sm,
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.glassBorder,
    backgroundColor: colors.bgTertiary,
  },
  customRow: { flexDirection: 'row', gap: spacing.sm },
  input: {
    width: 92, color: colors.textPrimary, backgroundColor: colors.bgTertiary,
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.glassBorder,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 16,
  },
  action: {
    flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.bgTertiary,
  },
  fullAction: {
    gap: 2, padding: spacing.md, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.glassBorder, backgroundColor: colors.bgTertiary,
  },
  cancel: { alignItems: 'center', paddingVertical: spacing.sm },
  disabled: { opacity: 0.42 },
  pressed: { opacity: 0.72 },
}));
