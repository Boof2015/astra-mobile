import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import { Text } from '@/components/Text';
import {
  SettingsCard,
  SettingsSectionLabel,
  SettingsSectionScreen,
  SettingsToggleRow,
} from '@/components/settings/SettingsSectionScaffold';
import { spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useLyricsSettingsStore } from '@/stores/lyricsSettingsStore';
import { useLyricsStore } from '@/stores/lyricsStore';
import { usePlayerStore } from '@/stores/playerStore';

export default function LyricsSettingsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const onlineLookupEnabled = useLyricsSettingsStore((s) => s.onlineLookupEnabled);
  const wordTimingEnabled = useLyricsSettingsStore((s) => s.wordTimingEnabled);
  const furiganaEnabled = useLyricsSettingsStore((s) => s.furiganaEnabled);
  const translationsEnabled = useLyricsSettingsStore((s) => s.translationsEnabled);
  const translationPriority = useLyricsSettingsStore((s) => s.translationPriority);
  const voiceLabelsEnabled = useLyricsSettingsStore((s) => s.voiceLabelsEnabled);
  const load = useLyricsSettingsStore((s) => s.load);
  const setOnlineLookupEnabled = useLyricsSettingsStore((s) => s.setOnlineLookupEnabled);
  const setWordTimingEnabled = useLyricsSettingsStore((s) => s.setWordTimingEnabled);
  const setFuriganaEnabled = useLyricsSettingsStore((s) => s.setFuriganaEnabled);
  const setTranslationsEnabled = useLyricsSettingsStore((s) => s.setTranslationsEnabled);
  const setTranslationPriority = useLyricsSettingsStore((s) => s.setTranslationPriority);
  const setVoiceLabelsEnabled = useLyricsSettingsStore((s) => s.setVoiceLabelsEnabled);
  const [priorityDraft, setPriorityDraft] = useState<string | null>(null);
  const priorityValue = priorityDraft ?? translationPriority.join(', ');

  useEffect(() => {
    void load();
  }, [load]);

  const setOnlineLookup = async (enabled: boolean) => {
    await setOnlineLookupEnabled(enabled);
    if (enabled) {
      const entries = Object.values(useLyricsStore.getState().byPath);
      if (entries.some((entry) => entry.result?.status === 'not_found' && entry.result.reason === 'online-disabled')) {
        useLyricsStore.getState().invalidateAll();
        await useLyricsStore.getState().loadForTrack(usePlayerStore.getState().currentTrack);
      }
    }
  };

  const commitPriority = () => {
    void setTranslationPriority(priorityValue).then(() => {
      setPriorityDraft(null);
    });
  };

  return (
    <SettingsSectionScreen title="Lyrics">
      <SettingsSectionLabel>LOOKUP</SettingsSectionLabel>
      <SettingsCard>
        <SettingsToggleRow
          title="Online lookup"
          description="Try XLRCDB, then LRCLIB, after local and cached lyrics."
          value={onlineLookupEnabled}
          onValueChange={(enabled) => void setOnlineLookup(enabled)}
        />
      </SettingsCard>

      <SettingsSectionLabel spaced>XLRC DISPLAY</SettingsSectionLabel>
      <SettingsCard style={styles.stack}>
        <SettingsToggleRow
          title="Word timing"
          description="Sweep the accent across the active timed word."
          value={wordTimingEnabled}
          onValueChange={(enabled) => void setWordTimingEnabled(enabled)}
        />
        <View style={styles.divider} />
        <SettingsToggleRow
          title="Furigana"
          description="Show pronunciation guides included with XLRC lyrics."
          value={furiganaEnabled}
          onValueChange={(enabled) => void setFuriganaEnabled(enabled)}
        />
        <View style={styles.divider} />
        <SettingsToggleRow
          title="Translations"
          description="Show the best available translated line."
          value={translationsEnabled}
          onValueChange={(enabled) => void setTranslationsEnabled(enabled)}
        />
        <View style={styles.divider} />
        <SettingsToggleRow
          title="Voice labels"
          description="Show singer or voice labels supplied by XLRC."
          value={voiceLabelsEnabled}
          onValueChange={(enabled) => void setVoiceLabelsEnabled(enabled)}
        />
      </SettingsCard>

      <SettingsSectionLabel spaced>TRANSLATION PRIORITY</SettingsSectionLabel>
      <SettingsCard style={styles.inputCard}>
        <Text variant="caption" color={colors.textSecondary}>
          Comma-separated language tags, in preferred order.
        </Text>
        <TextInput
          value={priorityValue}
          onChangeText={setPriorityDraft}
          onBlur={commitPriority}
          onSubmitEditing={commitPriority}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          placeholder="en, ja-Latn"
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          accessibilityLabel="Translation language priority"
        />
        <Text variant="caption" color={colors.textTertiary}>
          Duplicates are removed. Leaving this empty restores en, ja-Latn.
        </Text>
      </SettingsCard>
    </SettingsSectionScreen>
  );
}

const useStyles = createThemedStyles((colors) => ({
  stack: {
    gap: spacing.lg,
  },
  divider: {
    height: 1,
    backgroundColor: colors.glassBorder,
  },
  inputCard: {
    gap: spacing.sm,
  },
  input: {
    color: colors.textPrimary,
    backgroundColor: colors.bgTertiary,
    borderColor: colors.glassBorder,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
  },
}));
