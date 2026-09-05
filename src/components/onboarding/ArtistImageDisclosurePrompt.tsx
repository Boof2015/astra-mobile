import { ActionButton } from '@/components/ActionButton';
import { useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { SegmentedControl } from '@/components/SegmentedControl';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useSettingsStore } from '@/stores/settingsStore';
import type { ArtistImageAutoPolicy } from '@/types/artistImages';

export function ArtistImageDisclosurePrompt() {
  const loaded = useSettingsStore((s) => s.loaded);
  const seen = useSettingsStore((s) => s.artistImageDisclosureSeen);
  const policy = useSettingsStore((s) => s.artistImageAutoPolicy);
  if (!loaded || seen) return null;
  return <ArtistImageDisclosureContent initialPolicy={policy} />;
}

function ArtistImageDisclosureContent({
  initialPolicy,
}: {
  initialPolicy: ArtistImageAutoPolicy;
}) {
  const styles = useStyles();
  const colors = useColors();
  const [policy, setPolicy] = useState<ArtistImageAutoPolicy>(initialPolicy);
  const [saving, setSaving] = useState(false);

  const continueSetup = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await useSettingsStore.getState().setArtistImageAutoPolicy(policy);
      await useSettingsStore.getState().acknowledgeArtistImageDisclosure();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => undefined}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.icon}>
            <Ionicons name="person-circle-outline" size={28} color={colors.accent} />
          </View>
          <View style={styles.copy}>
            <Text variant="heading">Set up artist images</Text>
            <Text variant="body" color={colors.textSecondary}>
              Astra can send artist names to Deezer, then store selected portraits locally
              so they still appear offline. Existing album art remains the fallback.
            </Text>
          </View>
          <SegmentedControl
            segments={[
              { key: 'wifi', label: 'Wi-Fi' },
              { key: 'any', label: 'Any network' },
              { key: 'off', label: 'Off' },
            ]}
            value={policy}
            onChange={(value) => setPolicy(value as ArtistImageAutoPolicy)}
          />
          <Text variant="caption" color={colors.textTertiary}>
            Ethernet is included in Wi-Fi mode. You can change this later in Settings › Library,
            and manual searches work while automatic downloads are off.
          </Text>
          <ActionButton
            style={styles.button}
            onPress={() => void continueSetup()}
            disabled={saving}
            variant="primary"
            label="Continue"
            loading={saving}
          />
        </View>
      </View>
    </Modal>
  );
}

const useStyles = createThemedStyles((colors) => ({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.backdrop,
  },
  card: {
    gap: spacing.lg,
    padding: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.bgSecondary,
  },
  icon: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.accentGlow,
  },
  copy: {
    gap: spacing.sm,
  },
  button: {
    minHeight: 50,
    overflow: 'hidden',
  },
}));
