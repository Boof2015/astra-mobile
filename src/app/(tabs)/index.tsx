import { View, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { AstraLogo } from '@/components/AstraLogo';
import { FormatBadges } from '@/components/FormatBadge';
import { colors, fonts, radius, spacing } from '@/theme';
import { playSample } from '@/audio/playbackController';
import { SAMPLE_TRACKS } from '@/audio/sampleTracks';

export default function HomeScreen() {
  return (
    <Screen>
      <View style={styles.header}>
        <AstraLogo size={36} />
        <Text style={styles.wordmark}>ASTRA</Text>
      </View>
      <Text variant="label" style={styles.tagline}>
        Audiophile player
      </Text>

      <View style={styles.card}>
        <Text variant="heading">Quick start</Text>
        <Text variant="body" color={colors.textSecondary} style={styles.cardBody}>
          On-device library scanning lands next. For now, stream a test track to
          verify playback, background audio, and lock-screen controls.
        </Text>

        <View style={styles.badges}>
          <FormatBadges track={SAMPLE_TRACKS[0]} />
        </View>

        <Pressable
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          onPress={() => {
            void playSample();
          }}
        >
          <Ionicons name="play" size={20} color={colors.bgPrimary} />
          <Text style={styles.ctaText}>Play sample track</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  wordmark: {
    fontFamily: fonts.sans.bold,
    fontSize: 30,
    letterSpacing: 6,
    color: colors.textPrimary,
  },
  tagline: {
    marginTop: spacing.xs,
    letterSpacing: 1,
  },
  card: {
    marginTop: spacing.xxl,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.glassBg,
    borderColor: colors.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardBody: {
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  badges: {
    marginTop: spacing.md,
  },
  cta: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  ctaPressed: {
    backgroundColor: colors.accentHover,
  },
  ctaText: {
    fontFamily: fonts.sans.semibold,
    fontSize: 15,
    color: colors.bgPrimary,
  },
});
