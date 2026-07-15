import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { SignalResultCard } from '@/components/signal/SignalResultCard';
import { decodeTrackSignalLink, SIGNAL_LINK_PREFIX } from '@/audio/signalShare';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { useRipple } from '@/theme/ripple';
import type { SignalPayload } from '@boof2015/astra-signal';

export default function SignalImportScreen() {
  const styles = useStyles();
  const ripple = useRipple();
  const colors = useColors();
  const router = useRouter();
  const { data } = useLocalSearchParams<{ data?: string }>();

  const payload = useMemo<SignalPayload | null>(() => {
    if (!data) return null;
    try {
      return decodeTrackSignalLink(`${SIGNAL_LINK_PREFIX}${data}`);
    } catch {
      return null;
    }
  }, [data]);

  const goToSignal = () => router.replace('/signal' as never);

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable android_ripple={ripple.bounded} style={styles.back} onPress={goToSignal} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
          <Text variant="body" color={colors.textSecondary}>
            Signal
          </Text>
        </Pressable>
      </View>

      {payload ? (
        <SignalResultCard payload={payload} />
      ) : (
        <View style={styles.errorCard}>
          <Ionicons name="alert-circle-outline" size={28} color={colors.warning} />
          <Text variant="body">This link does not contain a valid Astra Signal.</Text>
          <Pressable android_ripple={ripple.bounded} style={styles.primaryButton} onPress={goToSignal}>
            <Text variant="body" color={colors.accentTextStrong}>
              Go to Signal
            </Text>
          </Pressable>
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
