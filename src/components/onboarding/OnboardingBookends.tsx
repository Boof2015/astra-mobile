import type { ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { Easing, FadeInDown, ReduceMotion } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { ActionButton } from '@/components/ActionButton';
import { Text } from '@/components/Text';
import { useLibraryStore } from '@/stores/libraryStore';
import { useRemoteSourcesStore } from '@/stores/remoteSourcesStore';
import { fonts, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { HeroMark, Wordmark } from './OnboardingBrand';
import { OnboardingBookend, useOnboardingNav } from './OnboardingFrame';
import { useLibraryPayoff } from './useLibraryPayoff';

const fmt = (value: number) => value.toLocaleString('en-US');
const plural = (count: number, one: string, many: string) => `${fmt(count)} ${count === 1 ? one : many}`;

/** Mark (cropped to its glyph, in the accent), wordmark, one line. Nothing else. */
export function WelcomePage() {
  const styles = useStyles();
  const colors = useColors();
  const nav = useOnboardingNav();
  return (
    <OnboardingBookend
      heroTop={nav.layout.welcomeHeroTop}
      footer={<ActionButton style={styles.grow} variant="primary" label="Get started" onPress={nav.next} />}
      hero={
        <View style={styles.welcome}>
          <HeroMark height={60} color={colors.accent} />
          <View style={styles.wordmark}>
            <Wordmark height={38} color={colors.textPrimary} />
          </View>
          <Text variant="body" color={colors.textSecondary} style={styles.tagline}>
            A player for the music you own. Folders on your phone, your own server, or both.
          </Text>
        </View>
      }
    />
  );
}

// Fan geometry: five tiles, each 44dp further out and 7° more turned than the last.
const TILE = 148;
const FAN_STEP = 44;
const FAN_WIDTH = TILE + FAN_STEP * 4;
const FAN_HEIGHT = 196;

/**
 * Done. Covers only exist once a scan publishes, so the page has three states:
 * still scanning (placeholders + a live count + Cancel), ready (the five most
 * recent covers + counts), and nothing added.
 */
export function DonePage() {
  const styles = useStyles();
  const colors = useColors();
  const nav = useOnboardingNav();
  const payoff = useLibraryPayoff();
  const hasMusic = payoff.trackCount > 0 || payoff.busy;
  const playable = payoff.trackCount > 0 && !payoff.busy;

  const title = !hasMusic ? 'You’re all set' : payoff.busy ? 'Almost ready' : 'Your library is ready';
  const counts = [
    plural(payoff.trackCount, 'track', 'tracks'),
    payoff.albumCount != null ? plural(payoff.albumCount, 'album', 'albums') : null,
    payoff.artistCount != null ? plural(payoff.artistCount, 'artist', 'artists') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const art = !hasMusic ? (
    <View style={styles.emptyTile}>
      <Ionicons name="musical-notes-outline" size={28} color={colors.textTertiary} />
    </View>
  ) : payoff.busy ? (
    // Covers only exist once the scan publishes: outline placeholders hold their spots.
    <Fan>
      {fanOffsets(5).map((offset) => (
        <View key={offset} style={[styles.tile, styles.placeholder, fanPlacement(offset), fanRotation(offset)]}>
          {offset === 0 ? <Ionicons name="musical-notes-outline" size={26} color={colors.textTertiary} /> : null}
        </View>
      ))}
    </Fan>
  ) : payoff.covers.length === 0 ? (
    // A finished library with no embedded art: one solid tile, not "pending" outlines.
    <View style={[styles.emptyTile, styles.solidTile]}>
      <Ionicons name="musical-notes" size={28} color={colors.accent} />
    </View>
  ) : (
    // Only as many tiles as there are covers, so a small library never repeats one.
    <Fan>
      {fanOffsets(payoff.covers.length).map((offset, index) => {
        const cover = payoff.covers[index];
        return (
          <Animated.View
            key={cover.key}
            entering={FadeInDown.delay(Math.abs(offset) * 60)
              .duration(420)
              .easing(Easing.out(Easing.cubic))
              .reduceMotion(ReduceMotion.System)}
            style={[styles.tileSlot, fanPlacement(offset)]}
          >
            <View style={[styles.tile, styles.cover, fanRotation(offset)]}>
              <Image source={{ uri: cover.uri }} style={styles.image} contentFit="cover" transition={120} />
            </View>
          </Animated.View>
        );
      })}
    </Fan>
  );

  const text = (
    <View style={styles.doneText}>
      <Text
        variant="title"
        allowFontScaling={false}
        accessibilityRole="header"
        style={[styles.centered, nav.layout.type.title]}
      >
        {title}
      </Text>
      {!hasMusic ? (
        <Text variant="body" color={colors.textSecondary} style={styles.sub}>
          Add music anytime from Settings › Library.
        </Text>
      ) : payoff.busy ? (
        <>
          <Text variant="body" color={colors.textSecondary} style={styles.sub}>
            Your music is still being added. It keeps scanning in the background.
          </Text>
          <StillScanning />
        </>
      ) : (
        <Text variant="mono" color={colors.textSecondary} style={styles.counts}>
          {counts}
        </Text>
      )}
    </View>
  );

  return (
    <OnboardingBookend
      heroTop={nav.layout.doneHeroTop}
      align="center"
      aside={art}
      hero={text}
      footer={
        <ActionButton
          style={styles.grow}
          variant="primary"
          label={playable ? 'Start listening' : 'Done'}
          onPress={nav.finish}
        />
      }
    />
  );
}

function Fan({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <View style={styles.fan}>{children}</View>;
}

/** Offsets centered on the middle tile: 1 → [0], 2 → [-0.5, 0.5], 5 → [-2 … 2]. */
function fanOffsets(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index - (count - 1) / 2);
}

function fanPlacement(offset: number) {
  return {
    position: 'absolute' as const,
    top: 8,
    left: (FAN_WIDTH - TILE) / 2 + offset * FAN_STEP,
    zIndex: Math.round(10 - Math.abs(offset) * 2),
  };
}

function fanRotation(offset: number) {
  return { transform: [{ rotate: `${offset * 7}deg` }, { translateY: Math.abs(offset) * 10 }] };
}

/** Live count + Cancel while a scan runs; a quieter line while only a server syncs. */
function StillScanning() {
  const styles = useStyles();
  const colors = useColors();
  const isScanning = useLibraryStore((s) => s.isScanning);
  const isCancelling = useLibraryStore((s) => s.isCancelling);
  const progress = useLibraryStore((s) => s.scanProgress);
  const syncingName = useRemoteSourcesStore((s) => {
    const id = Object.keys(s.progressById).find((key) => s.progressById[Number(key)] != null);
    return id ? (s.sources.find((source) => source.id === Number(id))?.name ?? null) : null;
  });
  const counted = isScanning && progress.total > 0 && (progress.phase === 'extracting' || progress.phase === 'analyzing');
  return (
    <View style={styles.still}>
      {isScanning ? (
        <View style={styles.bar}>
          <View
            style={[
              styles.barFill,
              counted ? { width: `${Math.min(1, progress.processed / progress.total) * 100}%` } : styles.barIndeterminate,
            ]}
          />
        </View>
      ) : null}
      <Text variant="mono" color={colors.textSecondary} style={styles.centered}>
        {isScanning
          ? counted
            ? `${fmt(progress.processed)} of ${fmt(progress.total)} tracks scanned`
            : 'Looking for music…'
          : syncingName
            ? `Syncing ${syncingName}…`
            : 'Syncing…'}
      </Text>
      {isScanning ? (
        <ActionButton
          variant="secondary"
          label={isCancelling ? 'Canceling…' : 'Cancel scan'}
          disabled={isCancelling}
          onPress={() => useLibraryStore.getState().cancelScan()}
          accessibilityLabel="Cancel library scan"
          style={styles.cancel}
        />
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  grow: {
    flex: 1,
    minHeight: 52,
  },
  welcome: {
    alignItems: 'flex-start',
  },
  wordmark: {
    marginTop: 24,
  },
  tagline: {
    marginTop: 18,
    maxWidth: 320,
    fontSize: 17,
    lineHeight: 25,
  },
  fan: {
    width: FAN_WIDTH,
    height: FAN_HEIGHT,
  },
  tileSlot: {
    position: 'absolute',
    top: 8,
  },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: 12,
  },
  cover: {
    overflow: 'hidden',
    backgroundColor: colors.bgTertiary,
  },
  image: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  placeholder: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.glassBorderStrong,
    backgroundColor: colors.glassBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  solidTile: {
    borderStyle: 'solid',
    borderWidth: 0,
    backgroundColor: colors.bgTertiary,
  },
  emptyTile: {
    width: TILE,
    height: TILE,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.glassBorderStrong,
    backgroundColor: colors.glassBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 32,
    marginBottom: spacing.lg,
  },
  doneText: {
    alignItems: 'center',
    marginTop: 18,
  },
  centered: {
    textAlign: 'center',
  },
  sub: {
    textAlign: 'center',
    maxWidth: 330,
    marginTop: spacing.sm,
  },
  counts: {
    textAlign: 'center',
    marginTop: spacing.sm,
    fontFamily: fonts.mono.regular,
    fontSize: 13,
    lineHeight: 20,
  },
  still: {
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 18,
  },
  bar: {
    width: 220,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.glassBorder,
    overflow: 'hidden',
  },
  barFill: {
    height: 4,
    backgroundColor: colors.accent,
  },
  barIndeterminate: {
    width: '100%',
    opacity: 0.35,
  },
  cancel: {
    marginTop: spacing.xs,
  },
}));
