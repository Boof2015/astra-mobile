import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { SignalResultCard } from '@/components/signal/SignalResultCard';
import {
  SignalScanTransition,
  type SignalScanPhase,
} from '@/components/signal/SignalScanTransition';
import { decodeSignalFromUri } from '@/audio/signalDecodeImage';
import { SIGNAL_SCAN_GUIDE } from '@/audio/signalScanGeometry';
import { usePlayerStore } from '@/stores/playerStore';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useRipple } from '@/theme/ripple';
import type { SignalPayload } from '@boof2015/astra-signal';

const MIN_READING_MS = 600;
const FAILURE_RETURN_MS = 480;

export default function SignalScanScreen() {
  const styles = useStyles();
  const ripple = useRipple();
  const colors = useColors();
  const router = useRouter();
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SignalPayload | null>(null);
  const [phase, setPhase] = useState<SignalScanPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const readingStartedAt = useRef(0);

  useEffect(() => {
    if (phase !== 'failure') return;
    const timeout = setTimeout(() => setPhase('idle'), FAILURE_RETURN_MS);
    return () => clearTimeout(timeout);
  }, [phase]);

  const beginReading = () => {
    readingStartedAt.current = Date.now();
    setBusy(true);
    setError(null);
    setPhase('reading');
  };

  const finishReadingBeat = async () => {
    const remaining = MIN_READING_MS - (Date.now() - readingStartedAt.current);
    if (remaining > 0) await new Promise<void>((resolve) => setTimeout(resolve, remaining));
  };

  const runDecode = async (uri: string, useGuideCrop = false) => {
    try {
      const payload = await decodeSignalFromUri(uri, useGuideCrop ? { previewSize } : undefined);
      await finishReadingBeat();
      setResult(payload);
      setPhase('success');
    } catch {
      await finishReadingBeat();
      setError("Couldn't read Signal. Line the code up in the frame, hold steady, and try again.");
      setPhase('failure');
    } finally {
      setBusy(false);
    }
  };

  const capture = async () => {
    if (busy) return;
    beginReading();
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 1 });
      if (photo?.uri) {
        await runDecode(photo.uri, true);
      } else {
        await finishReadingBeat();
        setError("Couldn't capture that image. Hold steady and try again.");
        setPhase('failure');
        setBusy(false);
      }
    } catch {
      await finishReadingBeat();
      setError("Couldn't capture that image. Hold steady and try again.");
      setPhase('failure');
      setBusy(false);
    }
  };

  const pickImage = async () => {
    if (busy) return;
    const picked = await DocumentPicker.getDocumentAsync({ type: 'image/*', copyToCacheDirectory: true });
    const uri = picked.assets?.[0]?.uri;
    if (uri) {
      beginReading();
      await runDecode(uri);
    }
  };

  const scanAnother = () => {
    setResult(null);
    setError(null);
    setPhase('idle');
  };
  const standaloneResult = result !== null && !permission?.granted;

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable android_ripple={ripple.bounded} style={styles.back} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
          <Text variant="body" color={colors.textSecondary}>
            Back
          </Text>
        </Pressable>
      </View>

      <Text variant="title" style={styles.heading}>
        Scan a Signal
      </Text>
      {standaloneResult ? (
        <View style={styles.resultState}>
          <SignalResultCard payload={result} />
          <View style={styles.resultActions}>
            <Pressable android_ripple={ripple.bounded} style={styles.primaryButton} onPress={scanAnother}>
              <Ionicons name="scan-outline" size={18} color={colors.accentTextStrong} />
              <Text variant="body" color={colors.accentTextStrong}>
                Scan another
              </Text>
            </Pressable>
            <Pressable android_ripple={ripple.bounded} style={styles.secondaryButton} onPress={() => router.back()}>
              <Text variant="body" color={colors.textPrimary}>
                Done
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <>
          <Text variant="body" color={colors.textSecondary} style={styles.instruction}>
            Keep the full white Signal card visible and hold steady.
          </Text>

          {currentTrack ? (
            <Pressable
              android_ripple={ripple.bounded}
              style={styles.currentSignal}
              onPress={() => router.push('/signal' as never)}
              accessibilityRole="button"
              accessibilityLabel={`View the Signal for ${currentTrack.title} by ${currentTrack.artist}`}
            >
              <View style={styles.currentSignalIcon}>
                <Ionicons name="pulse" size={18} color={colors.accent} />
              </View>
              <View style={styles.currentSignalCopy}>
                <Text variant="label" color={colors.textTertiary}>
                  NOW PLAYING
                </Text>
                <Text variant="body" numberOfLines={1}>
                  {currentTrack.title} · {currentTrack.artist}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={19} color={colors.textTertiary} />
            </Pressable>
          ) : null}

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
              <View style={styles.controls}>
                <Pressable android_ripple={ripple.icon(28)} style={styles.iconButton} onPress={() => void pickImage()} hitSlop={8}>
                  <Ionicons name="image-outline" size={24} color={colors.textPrimary} />
                </Pressable>
                <Pressable android_ripple={ripple.bounded} style={styles.shutter} onPress={() => void capture()} hitSlop={8}>
                  <Ionicons name="pulse" size={26} color={colors.accentTextStrong} />
                </Pressable>
                <View style={styles.iconButton} />
              </View>
              <SignalScanTransition
                phase={phase}
                width={previewSize.width}
                height={previewSize.height}
                payload={result}
                onScanAnother={scanAnother}
                onDone={() => router.back()}
              />
            </View>
          )}

          {error && phase === 'idle' ? (
            <View style={styles.errorPanel}>
              <Ionicons name="alert-circle-outline" size={20} color={colors.warning} />
              <Text variant="body" color={colors.textPrimary} style={styles.errorCopy}>
                {error}
              </Text>
            </View>
          ) : null}
        </>
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
    marginBottom: spacing.xs,
  },
  instruction: {
    marginBottom: spacing.md,
  },
  currentSignal: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  currentSignalIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentGlow,
  },
  currentSignalCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
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
    flexDirection: 'row',
    gap: spacing.sm,
  },
  secondaryButton: {
    minHeight: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.bgSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
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
  resultState: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  resultActions: {
    gap: spacing.md,
  },
}));
