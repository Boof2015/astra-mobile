import { useMemo, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { AstraLogo } from '@/components/AstraLogo';
import { TrackRow } from '@/components/library/TrackRow';
import { TrackActionsSheet } from '@/components/library/TrackActionsSheet';
import { colors, radius, spacing } from '@/theme';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePlayerStore } from '@/stores/playerStore';
import { playTracks, shuffleTracks } from '@/audio/playbackController';
import { dbTrackToTrack } from '@/library/trackAdapter';
import { albumArtworkSource } from '@/library/artwork';
import { formatDuration } from '@/lib/format';
import type { DbTrack } from '@/types/library';

export default function AlbumScreen() {
  const router = useRouter();
  const { key } = useLocalSearchParams<{ key: string }>();
  const albums = useLibraryStore((s) => s.albums);
  const allTracks = useLibraryStore((s) => s.tracks);
  const currentPath = usePlayerStore((s) => s.currentTrack?.path);

  const album = albums.find((entry) => entry.identity_key === key);
  // Store tracks are ordered artist/album/disc/track, so the filtered slice
  // keeps disc/track order within one album.
  const tracks = useMemo(
    () => allTracks.filter((track) => track.album_identity_key === key),
    [allTracks, key]
  );

  const totalDuration = tracks.reduce((sum, track) => sum + track.duration, 0);
  const [actionTrack, setActionTrack] = useState<DbTrack | null>(null);

  const playFrom = (index: number) => {
    void playTracks(tracks.map(dbTrackToTrack), index);
  };

  return (
    <Screen>
      <Pressable style={styles.back} onPress={() => router.back()} hitSlop={8}>
        <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
        <Text variant="body" color={colors.textSecondary}>
          Library
        </Text>
      </Pressable>

      <View style={styles.header}>
        <View style={styles.art}>
          {album && albumArtworkSource(album) ? (
            <Image
              source={{ uri: albumArtworkSource(album)! }}
              style={styles.artImage}
              contentFit="cover"
              transition={120}
            />
          ) : (
            <AstraLogo size={42} />
          )}
        </View>
        <View style={styles.headerMeta}>
          <Text variant="heading" numberOfLines={2}>
            {album?.album ?? 'Album'}
          </Text>
          <Text variant="body" color={colors.textSecondary} numberOfLines={1}>
            {album?.artist ?? ''}
          </Text>
          <Text variant="label">
            {[
              album?.year ? String(album.year) : null,
              `${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'}`,
              formatDuration(totalDuration),
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <View style={styles.buttons}>
            <Pressable style={styles.playButton} onPress={() => playFrom(0)} accessibilityRole="button">
              <Ionicons name="play" size={16} color={colors.bgPrimary} />
              <Text variant="body" style={styles.playLabel}>
                Play
              </Text>
            </Pressable>
            <Pressable
              style={styles.shuffleButton}
              onPress={() => void shuffleTracks(tracks.map(dbTrackToTrack))}
              accessibilityRole="button"
            >
              <Ionicons name="shuffle" size={16} color={colors.accent} />
              <Text variant="body" color={colors.accent}>
                Shuffle
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      <FlashList
        data={tracks}
        keyExtractor={(track) => String(track.id)}
        showsVerticalScrollIndicator={false}
        renderItem={({ item, index }) => (
          <TrackRow
            track={item}
            showArtist={false}
            active={item.path === currentPath}
            onPress={() => playFrom(index)}
            onLongPress={() => setActionTrack(item)}
          />
        )}
      />

      <TrackActionsSheet track={actionTrack} onClose={() => setActionTrack(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: spacing.md,
    marginBottom: spacing.md,
    alignSelf: 'flex-start',
  },
  header: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginBottom: spacing.lg,
  },
  art: {
    width: 128,
    height: 128,
    borderRadius: radius.md,
    backgroundColor: colors.bgTertiary,
    borderColor: colors.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  artImage: {
    width: '100%',
    height: '100%',
  },
  headerMeta: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.xs,
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  playButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  shuffleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderColor: colors.accent,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  playLabel: {
    color: colors.bgPrimary,
    fontWeight: '600',
  },
});
