import { View, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from './Text';
import { AstraLogo } from './AstraLogo';
import { colors, layout, radius, spacing } from '@/theme';
import { usePlayerStore } from '@/stores/playerStore';
import { togglePlay } from '@/audio/playbackController';

/**
 * Persistent mini-player, rendered above the tab bar. Tapping the bar opens the
 * full now-playing screen. The artwork box is where the spectrum "pulse"
 * is-playing indicator will live at M3.
 */
export function MiniPlayer() {
  const router = useRouter();
  const track = usePlayerStore((s) => s.currentTrack);
  const playbackState = usePlayerStore((s) => s.playbackState);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);

  if (!track) return null;

  const isPlaying = playbackState === 'playing';
  const isLoading = playbackState === 'loading';
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  return (
    <View style={styles.container}>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>

      <Pressable style={styles.row} onPress={() => router.push('/now-playing')}>
        <View style={styles.art}>
          {track.artworkData ? (
            <Image source={{ uri: track.artworkData }} style={styles.artImage} contentFit="cover" />
          ) : (
            <AstraLogo size={22} />
          )}
        </View>

        <View style={styles.meta}>
          <Text variant="body" numberOfLines={1} style={styles.title}>
            {track.title}
          </Text>
          <Text variant="label" numberOfLines={1}>
            {track.artist}
          </Text>
        </View>

        <Pressable hitSlop={12} onPress={togglePlay} style={styles.playButton}>
          <Ionicons
            name={isLoading ? 'ellipsis-horizontal' : isPlaying ? 'pause' : 'play'}
            size={26}
            color={colors.accent}
          />
        </Pressable>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: layout.miniPlayerHeight,
    backgroundColor: colors.bgSecondary,
    borderTopColor: colors.glassBorder,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  progressTrack: {
    height: 2,
    backgroundColor: colors.glassBorder,
  },
  progressFill: {
    height: 2,
    backgroundColor: colors.accent,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  art: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
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
    flex: 1,
  },
  title: {
    fontSize: 15,
  },
  playButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default MiniPlayer;
