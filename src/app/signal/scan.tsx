import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { SignalResultCard } from '@/components/signal/SignalResultCard';
import { decodeSignalFromUri } from '@/audio/signalDecodeImage';
import { SIGNAL_SCAN_GUIDE } from '@/audio/signalScanGeometry';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useRipple } from '@/theme/ripple';
import type { SignalPayload } from '@boof2015/astra-signal';

export default function SignalScanScreen() {
  const styles = useStyles();
  const ripple = useRipple();
  const colors = useColors();
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SignalPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });

  const runDecode = async (uri: string, useGuideCrop = false) => {
    setBusy(true);
    setError(null);
    try {
      setResult(await decodeSignalFromUri(uri, useGuideCrop ? { previewSize } : undefined));
    } catch {
      setError("Couldn't read Signal. Line the code up in the frame, hold steady, and try again.");
    } finally {
      setBusy(false);
    }
  };

  const capture = async () => {
    if (busy) return;
    const photo = await cameraRef.current?.takePictureAsync({ quality: 1 });
    if (photo?.uri) await runDecode(photo.uri, true);
  };

  const pickImage = async () => {
    if (busy) return;
    const picked = await DocumentPicker.getDocumentAsync({ type: 'image/*', copyToCacheDirectory: true });
    const uri = picked.assets?.[0]?.uri;
    if (uri) await runDecode(uri);
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable android_ripple={ripple.bounded} style={styles.back} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
          <Text variant="body" color={colors.textSecondary}>
            Signal
          </Text>
        </Pressable>
      </View>

      <Text variant="title" style={styles.heading}>
        Scan the Signal
      </Text>

      {!permission ? (
        <View style={styles.center} />
      ) : !permission.granted ? (
        <View style={styles.permissionCard}>
          <Ionicons name="camera-outline" size={28} color={colors.accent} />
          <Text variant="body">Camera access is needed to scan a Signal.</Text>
          <Pressable android_ripple={ripple.bounded} style={styles.primaryButton} onPress={() => void requestPermission()}>
            <Text variant="body" color={colors.accentTextStrong}>
              Allow camera
            </Text>
          </Pressable>
          <Pressable android_ripple={ripple.bounded} style={styles.linkButton} onPress={() => void pickImage()}>
            <Text variant="body" color={colors.accent}>
              Or pick a Signal image
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.scannerFrame}>
          <CameraView
            ref={cameraRef}
            style={styles.camera}
            facing="back"
            onLayout={(event) => setPreviewSize(event.nativeEvent.layout)}
          />
          <View pointerEvents="none" style={styles.scanGuide}>
            <View style={[styles.guideCorner, styles.guideTopLeft]} />
            <View style={[styles.guideCorner, styles.guideTopRight]} />
            <View style={[styles.guideCorner, styles.guideBottomLeft]} />
            <View style={[styles.guideCorner, styles.guideBottomRight]} />
          </View>
          {busy ? (
            <View style={styles.busyOverlay}>
              <ActivityIndicator color={colors.accent} />
              <Text variant="label" color={colors.textPrimary}>
                Reading signal…
              </Text>
            </View>
          ) : null}
          <View style={styles.controls}>
            <Pressable android_ripple={ripple.icon(28)} style={styles.iconButton} onPress={() => void pickImage()} hitSlop={8}>
              <Ionicons name="image-outline" size={24} color={colors.textPrimary} />
            </Pressable>
            <Pressable android_ripple={ripple.bounded} style={styles.shutter} onPress={() => void capture()} hitSlop={8}>
              <Ionicons name="pulse" size={26} color={colors.accentTextStrong} />
            </Pressable>
            <View style={styles.iconButton} />
          </View>
        </View>
      )}

      {error ? (
        <View style={styles.errorPanel}>
          <Ionicons name="alert-circle-outline" size={20} color={colors.warning} />
          <Text variant="body" color={colors.textPrimary} style={styles.errorCopy}>
            {error}
          </Text>
        </View>
      ) : null}

      {result ? (
        <View style={styles.resultWrap}>
          <SignalResultCard payload={result} />
          <Pressable android_ripple={ripple.bounded} style={styles.primaryButton} onPress={() => setResult(null)}>
            <Text variant="body" color={colors.accentTextStrong}>
              Scan another
            </Text>
          </Pressable>
        </View>
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
  linkButton: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  scannerFrame: {
    flex: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.bgSecondary,
    marginBottom: spacing.lg,
  },
  camera: {
    flex: 1,
  },
  scanGuide: {
    position: 'absolute',
    left: `${SIGNAL_SCAN_GUIDE.horizontalInset * 100}%`,
    right: `${SIGNAL_SCAN_GUIDE.horizontalInset * 100}%`,
    top: `${SIGNAL_SCAN_GUIDE.top * 100}%`,
    aspectRatio: SIGNAL_SCAN_GUIDE.aspectRatio,
  },
  guideCorner: {
    position: 'absolute',
    width: 30,
    height: 22,
    borderColor: colors.accent,
  },
  guideTopLeft: {
    left: 0,
    top: 0,
    borderLeftWidth: 3,
    borderTopWidth: 3,
    borderTopLeftRadius: radius.sm,
  },
  guideTopRight: {
    right: 0,
    top: 0,
    borderRightWidth: 3,
    borderTopWidth: 3,
    borderTopRightRadius: radius.sm,
  },
  guideBottomLeft: {
    left: 0,
    bottom: 0,
    borderLeftWidth: 3,
    borderBottomWidth: 3,
    borderBottomLeftRadius: radius.sm,
  },
  guideBottomRight: {
    right: 0,
    bottom: 0,
    borderRightWidth: 3,
    borderBottomWidth: 3,
    borderBottomRightRadius: radius.sm,
  },
  busyOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  controls: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgSecondary,
  },
  shutter: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  errorPanel: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorCopy: {
    flex: 1,
  },
  resultWrap: {
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
}));
