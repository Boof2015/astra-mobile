import { useState } from 'react';
import {
  ActivityIndicator,
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
import {
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useRipple } from '@/theme/ripple';
import { useDesktopRemoteStore } from '@/stores/desktopRemoteStore';

export default function DesktopRemoteScanScreen() {
  const styles = useStyles();
  const ripple = useRipple();
  const colors = useColors();
  const router = useRouter();
  const pairFromInput = useDesktopRemoteStore((s) => s.pairFromInput);
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);

  const onScanned = (result: BarcodeScanningResult) => {
    if (locked) return;
    const data = result.data?.trim();
    if (!data) return;
    setLocked(true);
    void pairFromInput(data).finally(() => {
      router.replace('/desktop-remote' as never);
    });
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable android_ripple={ripple.bounded} style={styles.back} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
          <Text variant="body" color={colors.textSecondary}>
            Desktop Remote
          </Text>
        </Pressable>
      </View>

      <Text variant="title" style={styles.heading}>
        Scan pairing QR
      </Text>

      {!permission ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : !permission.granted ? (
        <View style={styles.permissionCard}>
          <Ionicons name="camera-outline" size={28} color={colors.accent} />
          <Text variant="body">Camera access is needed to scan the desktop pairing QR.</Text>
          <Pressable android_ripple={ripple.bounded} style={styles.primaryButton} onPress={() => void requestPermission()}>
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
          {locked ? (
            <View style={styles.locked}>
              <ActivityIndicator color={colors.accentTextStrong} />
              <Text variant="body" color={colors.accentTextStrong}>
                Pairing...
              </Text>
            </View>
          ) : null}
        </View>
      )}
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
    alignItems: 'center',
    justifyContent: 'center',
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
  locked: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    minHeight: 48,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
}));
