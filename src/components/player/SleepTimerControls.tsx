import { ActionButton } from '@/components/ActionButton';
import { actionButtonStyle } from '@/theme/actionButtons';
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
          <ActionButton
            key={minutes}
            disabled={!available}
            unstable_pressDelay={SCROLL_PRESS_DELAY}
            onPress={() => void run(() => startMinutes(minutes), `Timer set for ${minutes} minutes.`)}
            style={styles.preset}
            variant="secondary"
            label={`${minutes} min`}
          />
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
        <ActionButton
          disabled={!available}
          onPress={startCustom}
          style={styles.action}
          variant="primary"
          label="Set custom"
        />
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
        <ActionButton
          onPress={() => void run(cancel, 'Sleep timer canceled.')}
          variant="danger"
          label="Cancel sleep timer"
        />
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
    flex: 1,
  },
  fullAction: {
    ...actionButtonStyle(colors, 'secondary'),
    flexDirection: 'column', alignItems: 'flex-start', gap: 2,
  },
  disabled: { opacity: 0.42 },
  pressed: { opacity: 0.72 },
}));
