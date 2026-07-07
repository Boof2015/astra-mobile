import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  View
} from 'react-native';
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult
} from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { EQPresetPreviewSheet } from '@/components/eq/EQPresetPreviewSheet';
import { decodeEQPresetQr } from '@/audio/eqShare';
import { genEqId } from '@/audio/eqPresets';
import { useEQStore } from '@/stores/eqStore';
import {
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import type { EQPreset } from '@/types/audio';

export default function EQPresetScanScreen() {
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const importPreset = useEQStore((state) => state.importPreset);
  const [permission, requestPermission] = useCameraPermissions();
  const [pendingPreset, setPendingPreset] = useState<EQPreset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locked = pendingPreset !== null || error !== null;

  const onScanned = (result: BarcodeScanningResult) => {
    if (locked) return;
    const data = result.data?.trim();
    if (!data) return;
    try {
      setPendingPreset(decodeEQPresetQr(data, genEqId));
      setError(null);
    } catch {
      setError('That QR does not contain an Astra EQ preset.');
    }
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
          <Text variant="body" color={colors.textSecondary}>
            Equalizer
          </Text>
        </Pressable>
      </View>

      <Text variant="title" style={styles.heading}>
        Scan EQ preset QR
      </Text>

      {!permission ? (
        <View style={styles.center} />
      ) : !permission.granted ? (
        <View style={styles.permissionCard}>
          <Ionicons name="camera-outline" size={28} color={colors.accent} />
          <Text variant="body">Camera access is needed to scan EQ preset QR codes.</Text>
          <Pressable style={styles.primaryButton} onPress={() => void requestPermission()}>
            <Text variant="body" color={colors.accentTextStrong}>
              Allow camera
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.scannerFrame}>
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={locked ? undefined : onScanned}
          />
          <View pointerEvents="none" style={styles.scanBox} />
          {error ? (
            <View style={styles.errorPanel}>
              <View style={styles.errorText}>
                <Ionicons name="alert-circle-outline" size={20} color={colors.warning} />
                <Text variant="body" color={colors.textPrimary} style={styles.errorCopy}>
                  {error}
                </Text>
              </View>
              <Pressable style={styles.retryButton} onPress={() => setError(null)}>
                <Text variant="label" color={colors.accentTextStrong}>
                  Scan again
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      )}

      {pendingPreset ? (
        <EQPresetPreviewSheet
          preset={pendingPreset}
          title="Scanned preset"
          onConfirm={() => {
            importPreset(pendingPreset);
            setPendingPreset(null);
            router.replace('/eq' as never);
          }}
          onClose={() => setPendingPreset(null)}
        />
      ) : null}
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
  heading: {
    marginBottom: spacing.lg,
  },
  center: {
    flex: 1,
  },
  permissionCard: {
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
  scannerFrame: {
    flex: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.bgSecondary,
    marginBottom: spacing.xl,
  },
  camera: {
    flex: 1,
  },
  scanBox: {
    position: 'absolute',
    left: '15%',
    right: '15%',
    top: '25%',
    aspectRatio: 1,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.accent,
  },
  errorPanel: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    padding: spacing.md,
    gap: spacing.md,
  },
  errorText: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  errorCopy: {
    flex: 1,
  },
  retryButton: {
    alignSelf: 'flex-end',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accentGlow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
  },
}));
