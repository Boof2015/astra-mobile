import { View, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/Text';
import { AstraLogo } from '@/components/AstraLogo';
import { FormatBadges } from '@/components/FormatBadge';
import { SeekBar } from '@/components/SeekBar';
import { colors, radius, spacing } from '@/theme';
import { usePlayerStore } from '@/stores/playerStore';
import { seekTo, skipToNext, skipToPrevious, togglePlay } from '@/audio/playbackController';

export default function NowPlayingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const track = usePlayerStore((s) => s.currentTrack);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);

  const isPlaying = playbackState === 'playing';
  const isLoading = playbackState === 'loading';

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.xl },
      ]}
    >
      <Pressable style={styles.close} onPress={() => router.back()} hitSlop={12}>
        <Ionicons name="chevron-down" size={28} color={colors.textSecondary} />
      </Pressable>

      {track ? (
        <>
          <View style={styles.artWrap}>
            <View style={styles.art}>
              {track.artworkData ? (
                <Image source={{ uri: track.artworkData }} style={styles.artImage} contentFit="cover" />
              ) : (
                <AstraLogo size={104} />
              )}
            </View>
          </View>

          <View style={styles.meta}>
            <Text variant="heading" numberOfLines={2}>
              {track.title}
            </Text>
            <Text
              variant="body"
              color={colors.textSecondary}
              numberOfLines={1}
              style={styles.subtitle}
            >
              {track.artist}
              {track.album ? ` · ${track.album}` : ''}
            </Text>
            <View style={styles.badges}>
              <FormatBadges track={track} />
            </View>
          </View>

          <View style={styles.progressBlock}>
            <SeekBar
              currentTime={currentTime}
              duration={duration}
              trackKey={track.id}
              onSeek={(seconds) => void seekTo(seconds)}
            />
          </View>

          <View style={styles.transport}>
            <Pressable onPress={skipToPrevious} hitSlop={12}>
              <Ionicons name="play-skip-back" size={34} color={colors.textPrimary} />
            </Pressable>
            <Pressable onPress={togglePlay} hitSlop={12} style={styles.playButton}>
              <Ionicons
                name={isLoading ? 'ellipsis-horizontal' : isPlaying ? 'pause' : 'play'}
                size={36}
                color={colors.bgPrimary}
              />
            </Pressable>
            <Pressable onPress={skipToNext} hitSlop={12}>
              <Ionicons name="play-skip-forward" size={34} color={colors.textPrimary} />
            </Pressable>
          </View>
        </>
      ) : (
        <View style={styles.empty}>
          <Text variant="heading">Nothing playing</Text>
          <Text variant="body" color={colors.textSecondary} style={styles.subtitle}>
            Start a track from Home.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
    paddingHorizontal: spacing.xl,
  },
  close: {
    alignSelf: 'flex-start',
    padding: spacing.xs,
  },
  artWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  art: {
    width: 260,
    height: 260,
    borderRadius: radius.lg,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  artImage: {
    width: '100%',
    height: '100%',
  },
  meta: {
    marginTop: spacing.xl,
  },
  subtitle: {
    marginTop: spacing.xs,
  },
  badges: {
    marginTop: spacing.md,
  },
  progressBlock: {
    marginTop: spacing.md,
  },
  transport: {
    marginTop: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxl,
  },
  playButton: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
