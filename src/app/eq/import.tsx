import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useReturnToTabs } from '@/navigation/returnToTabs';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { EQPresetPreviewSheet } from '@/components/eq/EQPresetPreviewSheet';
import { decodeEQPresetQr, EQ_PRESET_QR_PREFIX } from '@/audio/eqShare';
import { genEqId } from '@/audio/eqPresets';
import { useEQStore } from '@/stores/eqStore';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { AppPressable } from '@/components/AppPressable';
import type { EQPreset } from '@/types/audio';

export default function EQPresetImportScreen() {
  const styles = useStyles();
  const colors = useColors();
  const returnToTabs = useReturnToTabs();
  const importPreset = useEQStore((state) => state.importPreset);
  const { data } = useLocalSearchParams<{ data?: string }>();

  const preset = useMemo<EQPreset | null>(() => {
    if (!data) return null;
    try {
      return decodeEQPresetQr(`${EQ_PRESET_QR_PREFIX}${data}`, genEqId);
    } catch {
      return null;
    }
  }, [data]);

  // `/eq` is a tab, and this screen is a root-stack sibling of `(tabs)`, so a
  // bare replace here mints a second copy of the whole tab tree.
  const goToEq = () => returnToTabs('/eq' as never);

  if (!preset) {
    return (
      <Screen>
        <View style={styles.header}>
          <AppPressable feedback="control"  style={styles.back} onPress={goToEq} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
            <Text variant="body" color={colors.textSecondary}>
              Equalizer
            </Text>
          </AppPressable>
        </View>
        <View style={styles.errorCard}>
          <Ionicons name="alert-circle-outline" size={28} color={colors.warning} />
          <Text variant="body">This link does not contain a valid Astra EQ preset.</Text>
          <AppPressable feedback="accent"  style={styles.primaryButton} onPress={goToEq}>
            <Text variant="body" color={colors.accentTextStrong}>
              Go to Equalizer
            </Text>
          </AppPressable>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <EQPresetPreviewSheet
        preset={preset}
        title="Shared EQ preset"
        onConfirm={() => importPreset(preset)}
        onClose={goToEq}
      />
    </Screen>
  );
}

const useStyles = createThemedStyles((colors) => ({
  header: {
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  errorCard: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  primaryButton: {
    minHeight: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
