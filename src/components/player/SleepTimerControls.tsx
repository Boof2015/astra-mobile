import { actionButtonStyle, actionButtonTextStyle } from '@/theme/actionButtons';
import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Text } from '@/components/Text';
import { SLEEP_TIMER_PRESETS, formatSleepTimerStatus, normalizeSleepTimerMinutes } from '@/audio/sleepTimerState';
import { supportsNativePauseAtEndOfItem } from '@/audio/trackPlayerExtensions';
import { usePlayerStore } from '@/stores/playerStore';
import { usePlaybackTargetStore } from '@/stores/playbackTargetStore';
import { useSleepTimerStore } from '@/stores/sleepTimerStore';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { AppPressable, SCROLL_PRESS_DELAY } from '@/components/AppPressable';

export interface SleepTimerControlsProps {
  inputContext?: 'screen' | 'bottom-sheet';
}

export function SleepTimerControls({ inputContext = 'screen' }: SleepTimerControlsProps) {
  const styles = useStyles();
  const colors = useColors();
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
  const MinutesInput = inputContext === 'bottom-sheet' ? BottomSheetTextInput : TextInput;
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
          <AppPressable feedback="none"
            key={minutes}
            disabled={!available}

            unstable_pressDelay={SCROLL_PRESS_DELAY}
            onPress={() => void run(() => startMinutes(minutes), `Timer set for ${minutes} minutes.`)}
            style={({ pressed }) => [styles.preset, !available && styles.disabled, pressed && available && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={actionButtonTextStyle(colors, 'secondary')} variant="label">{minutes} min</Text>
          </AppPressable>
        ))}
      </View>

      <View style={styles.customRow}>
        <MinutesInput
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
        <AppPressable feedback="none"
          disabled={!available}

          onPress={startCustom}
          style={({ pressed }) => [styles.action, !available && styles.disabled, pressed && available && styles.pressed]}
        >
          <Text style={actionButtonTextStyle(colors, 'primary')} variant="label">Set custom</Text>
        </AppPressable>
      </View>

      <AppPressable feedback="none"
        disabled={!available || !supportsNativePauseAtEndOfItem()}

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
      </AppPressable>

      {timer ? (
        <AppPressable feedback="control"  onPress={() => void run(cancel, 'Sleep timer canceled.')} style={styles.cancel}>
          <Text style={actionButtonTextStyle(colors, 'danger')} variant="label">Cancel sleep timer</Text>
        </AppPressable>
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
    ...actionButtonStyle(colors, 'secondary'),
    flexGrow: 1,
    minWidth: 66,
  },
  customRow: { flexDirection: 'row', gap: spacing.sm },
  input: {
    width: 92, color: colors.textPrimary, backgroundColor: colors.bgTertiary,
    borderRadius: radius.sm, borderWidth: 1, borderColor: colors.glassBorder,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 16,
  },
  action: {
    ...actionButtonStyle(colors, 'primary'),
    flex: 1,
  },
  fullAction: {
    ...actionButtonStyle(colors, 'secondary'),
    flexDirection: 'column', alignItems: 'flex-start', gap: 2,
  },
  cancel: {
    ...actionButtonStyle(colors, 'danger'),
  },
  disabled: { opacity: 0.42 },
  pressed: { opacity: 0.72 },
}));
