import { useRef, useState } from 'react';
import { View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { Text } from '@/components/Text';
import { SegmentedControl } from '@/components/SegmentedControl';
import { showAppDialog } from '@/components/dialogs/AppDialog';
import { ArtistImageSweepStatus } from '@/components/library/ArtistImageSweepStatus';
import { SettingsCard, SettingsToggleRow } from './SettingsSectionScaffold';
import { clearArtistImages } from '@/library/artistImageLookup';
import { useArtistImageStore } from '@/stores/artistImageStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { ArtistImageAutoPolicy, ArtistImageSource } from '@/types/artistImages';
import { spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';

const CLEAR_ACTIONS = [
  {
    source: 'deezer',
    label: 'Clear Deezer images',
    message: 'Remove all Deezer artist images, including images chosen through Deezer searches, and turn automatic downloads off. Custom pictures are kept. Other artists will use album artwork or a placeholder until you choose an image or enable automatic downloads again.',
    success: 'Deezer images cleared. Automatic downloads are off.',
  },
  {
    source: 'manual',
    label: 'Clear custom images',
    message: 'Remove all artist pictures chosen from your device. Artists will use saved Deezer images, album artwork, or a placeholder. Automatic downloads keep their current setting. Original pictures on your device are kept.',
    success: 'Custom artist images cleared.',
  },
] as const;

export function ArtistImageSettings() {
  const styles = useStyles();
  const colors = useColors();
  const policy = useSettingsStore((s) => s.artistImageAutoPolicy);
  const setPolicy = useSettingsStore((s) => s.setArtistImageAutoPolicy);
  const clearingSource = useArtistImageStore((s) => s.clearingSource);
  const savingPolicyRef = useRef(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const disabled = clearingSource !== null || savingPolicy;
  const enabled = policy !== 'off';

  const updatePolicy = async (next: ArtistImageAutoPolicy) => {
    if (savingPolicyRef.current || useArtistImageStore.getState().clearingSource) return;
    savingPolicyRef.current = true;
    setSavingPolicy(true);
    setMessage(null);
    try {
      await setPolicy(next);
    } catch {
      showAppDialog({ title: 'Could not update automatic images', message: 'Please try again.' });
    } finally {
      savingPolicyRef.current = false;
      setSavingPolicy(false);
    }
  };

  const clear = async (source: ArtistImageSource) => {
    if (savingPolicyRef.current || useArtistImageStore.getState().clearingSource) return;
    setMessage(null);
    try {
      await clearArtistImages(source);
      setMessage(CLEAR_ACTIONS.find((action) => action.source === source)!.success);
    } catch {
      showAppDialog({
        title: 'Could not clear artist images',
        message: 'Please try again. If the problem continues, restart Astra and retry.',
      });
    }
  };

  return (
    <SettingsCard>
      <View style={disabled && styles.disabledControls}>
        <SettingsToggleRow
          title="Automatic artist images"
          description="Send artist names to Deezer and cache selected images locally for offline use."
          value={enabled}
          disabled={disabled}
          onValueChange={(value) => void updatePolicy(value ? 'wifi' : 'off')}
        />
        {enabled ? (
          <View style={styles.network}>
            <Text variant="caption" color={colors.textSecondary}>Download network</Text>
            <SegmentedControl
              segments={[
                { key: 'wifi', label: 'Wi-Fi / Ethernet' },
                { key: 'any', label: 'Any network' },
              ]}
              value={policy}
              disabled={disabled}
              onChange={(value) => void updatePolicy(value === 'any' ? 'any' : 'wifi')}
            />
          </View>
        ) : (
          <Text variant="caption" color={colors.textTertiary} style={styles.note}>
            Manual Deezer searches remain available from an artist’s menu.
          </Text>
        )}
        <ArtistImageSweepStatus enabled={enabled} disabled={disabled} />
      </View>
      <View style={styles.actions}>
        {CLEAR_ACTIONS.map((action) => (
          <ActionButton
            key={action.source}
            label={action.label}
            variant="danger"
            icon="trash-outline"
            disabled={disabled}
            loading={clearingSource === action.source}
            onPress={() => showAppDialog({
              title: `${action.label}?`,
              message: action.message,
              actions: [
                { label: 'Cancel', role: 'cancel' },
                { label: action.label, role: 'destructive', onPress: () => void clear(action.source) },
              ],
            })}
          />
        ))}
        {message ? <Text variant="caption" color={colors.textSecondary} accessibilityLiveRegion="polite">{message}</Text> : null}
      </View>
    </SettingsCard>
  );
}

const useStyles = createThemedStyles((colors) => ({
  network: { marginTop: spacing.sm, gap: spacing.sm },
  note: { marginTop: spacing.sm },
  disabledControls: { opacity: 0.45 },
  actions: {
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.glassBorder,
    gap: spacing.sm,
  },
}));
