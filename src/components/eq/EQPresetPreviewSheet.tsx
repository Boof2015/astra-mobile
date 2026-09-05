import { ActionButton } from '@/components/ActionButton';
import {
  StyleSheet,
  View
} from 'react-native';
import { Text } from '@/components/Text';
import { AppSheetBody, AppSheetFooter, AppSheetTitle } from '@/components/sheets/AppSheet';
import {
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import type { EQPreset } from '@/types/audio';
import { EqSheet } from './EqSheet';
import { formatGain } from './format';

interface EQPresetPreviewSheetProps {
  preset: EQPreset;
  title?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function EQPresetPreviewSheet({
  preset,
  title = 'Import preset',
  confirmLabel = 'Import and Apply',
  onConfirm,
  onClose,
}: EQPresetPreviewSheetProps) {
  const styles = useStyles();
  const colors = useColors();
  const enabledBands = preset.bands.filter((band) => band.enabled).length;
  const modeLabel = preset.mode === 'graphic' ? 'Graphic' : 'Parametric';

  return (
    <EqSheet onClose={onClose} scrollable>
      <AppSheetTitle title={title} />
      <AppSheetBody>
        <View style={styles.preview}>
          <Text variant="body" color={colors.textPrimary}>
            {preset.name}
          </Text>
          <View style={styles.metaRow}>
            <Text variant="caption" color={colors.textTertiary}>
              Mode
            </Text>
            <Text variant="label" color={colors.textSecondary}>
              {modeLabel}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text variant="caption" color={colors.textTertiary}>
              Preamp
            </Text>
            <Text variant="label" color={colors.textSecondary}>
              {formatGain(preset.preamp)} dB
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text variant="caption" color={colors.textTertiary}>
              Bands
            </Text>
            <Text variant="label" color={colors.textSecondary}>
              {enabledBands}/{preset.bands.length}
            </Text>
          </View>
        </View>
      </AppSheetBody>
      <AppSheetFooter>
        <ActionButton
          onPress={onClose}
          variant="secondary"
          label="Cancel"
        />
        <ActionButton
          onPress={() => {
            onConfirm();
            onClose();
          }}
          variant="primary"
          label={confirmLabel}
        />
      </AppSheetFooter>
    </EqSheet>
  );
}

const useStyles = createThemedStyles((colors) => ({
  preview: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
}));

export default EQPresetPreviewSheet;
