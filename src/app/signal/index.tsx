import { useMemo, useRef } from 'react';
import { Pressable, Share, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { cacheDirectory, EncodingType, writeAsStringAsync } from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { SignalCode, type SignalCodeHandle } from '@/components/signal/SignalCode';
import { encodeTrackSignalLink, signalLayoutFromTrack } from '@/audio/signalShare';
import { usePlayerStore } from '@/stores/playerStore';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useRipple } from '@/theme/ripple';

// Keep the device presentation identical to the canonical shared PNG. The
// near-white isolation field is part of the proven phone-to-phone geometry.
const CODE_FG = '#0b0b12';
const CODE_BG = '#f4f4f6';

export default function SignalScreen() {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  const router = useRouter();
  const track = usePlayerStore((s) => s.currentTrack);
  const codeRef = useRef<SignalCodeHandle>(null);
  const { width: screenWidth } = useWindowDimensions();
  const layout = useMemo(() => (track ? signalLayoutFromTrack(track) : null), [track]);
  const availableWidth = Math.max(1, screenWidth - spacing.lg * 4);
  const targetWidth = layout?.tier === 'small' ? 280 : layout?.tier === 'medium' ? 340 : availableWidth;
  const codeWidth = Math.min(targetWidth, availableWidth);

  const shareImage = async () => {
    const base64 = codeRef.current?.snapshot();
    if (!base64 || !cacheDirectory) return;
    const fileUri = `${cacheDirectory}astra-signal.png`;
    await writeAsStringAsync(fileUri, base64, { encoding: EncodingType.Base64 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(fileUri, {
        mimeType: 'image/png',
        dialogTitle: 'Share Astra Signal',
        UTI: 'public.png',
      });
    }
  };

  const shareLink = async () => {
    if (!track) return;
    await Share.share({ message: encodeTrackSignalLink(track) });
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable android_ripple={ripple.bounded} style={styles.back} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
          <Text variant="body" color={colors.textSecondary}>
            Back
          </Text>
        </Pressable>
        <Pressable android_ripple={ripple.icon(22)} style={styles.scanBtn} onPress={() => router.navigate('/signal/scan' as never)} hitSlop={8}>
          <Ionicons name="scan-outline" size={22} color={colors.accent} />
        </Pressable>
      </View>

      <Text variant="title" style={styles.heading}>
        Astra Signal
      </Text>

      {!track || !layout ? (
        <View style={styles.empty}>
          <Ionicons name="pulse-outline" size={30} color={colors.textTertiary} />
          <Text variant="body" color={colors.textSecondary}>
            Play a song to make its Signal.
          </Text>
        </View>
      ) : (
        <View style={styles.body}>
          <View style={styles.codeCard}>
            <SignalCode
              ref={codeRef}
              layout={layout}
              width={codeWidth}
              foreground={CODE_FG}
              background={CODE_BG}
              exportForeground={CODE_FG}
              exportBackground={CODE_BG}
            />
          </View>
          <Text variant="heading" style={styles.trackTitle} numberOfLines={1}>
            {track.title}
          </Text>
          <Text variant="body" color={colors.textSecondary} numberOfLines={1}>
            {track.artist}
          </Text>

          <View style={styles.actions}>
            <Pressable android_ripple={ripple.bounded} style={styles.primaryButton} onPress={() => void shareImage()}>
              <Ionicons name="share-outline" size={18} color={colors.accentTextStrong} />
              <Text variant="body" color={colors.accentTextStrong}>
                Share Signal
              </Text>
            </Pressable>
            <Pressable android_ripple={ripple.bounded} style={styles.secondaryButton} onPress={() => void shareLink()}>
              <Ionicons name="link-outline" size={18} color={colors.textPrimary} />
              <Text variant="body">Share link</Text>
            </Pressable>
          </View>
        </View>
      )}
    </Screen>
  );
}

const useStyles = createThemedStyles((colors) => ({
  header: {
    marginTop: spacing.md,
    marginBottom: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  scanBtn: {
    padding: spacing.xs,
  },
  heading: {
    marginBottom: spacing.lg,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  body: {
    alignItems: 'center',
  },
  codeCard: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: CODE_BG,
    marginBottom: spacing.lg,
    overflow: 'hidden',
  },
  trackTitle: {
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.bgSecondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
}));
