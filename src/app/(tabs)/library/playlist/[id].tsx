import { useEffect, useMemo, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { TrackRow } from '@/components/library/TrackRow';
import { TrackActionsSheet } from '@/components/library/TrackActionsSheet';
import { ActionSheet, type ActionSheetItem } from '@/components/sheets/ActionSheet';
import { colors, radius, spacing } from '@/theme';
import { usePlaylistStore } from '@/stores/playlistStore';
import { usePlayerStore } from '@/stores/playerStore';
import { playTracks, shuffleTracks } from '@/audio/playbackController';
import { dbTrackToTrack } from '@/library/trackAdapter';
import { artworkUri } from '@/library/artwork';
import { formatDuration } from '@/lib/format';
import { useLibraryDetailBack } from '@/navigation/useLibraryDetailBack';
import type { DbTrack } from '@/types/library';
import type { PlaylistTrackEntry } from '@/types/playlist';

function basename(path: string): string {
  const decoded = decodeURIComponent(path.split('/').pop() ?? path);
  return decoded.split(/[/:]/).pop() || path;
}

function MissingRow({ entry, onLongPress }: { entry: PlaylistTrackEntry; onLongPress: () => void }) {
  return (
    <Pressable style={styles.missingRow} onLongPress={onLongPress} accessibilityRole="button">
      <View style={styles.missingMeta}>
        <Text variant="body" numberOfLines={1} color={colors.textTertiary}>
          {entry.fallback_title ?? basename(entry.track_path)}
        </Text>
        <Text variant="label" numberOfLines={1} color={colors.textTertiary}>
          {entry.fallback_artist ?? 'Track not in library'}
        </Text>
      </View>
      <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
    </Pressable>
  );
}

export default function PlaylistScreen() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const handleBack = useLibraryDetailBack(from);
  const isFavorites = id === 'favorites';
  const playlistId = isFavorites ? null : Number(id);

  const playlists = usePlaylistStore((s) => s.playlists);
  const favoriteTracks = usePlaylistStore((s) => s.favoriteTracks);
  const activeEntries = usePlaylistStore((s) => s.activeEntries);
  const openPlaylist = usePlaylistStore((s) => s.openPlaylist);
  const closePlaylist = usePlaylistStore((s) => s.closePlaylist);
  const moveTrack = usePlaylistStore((s) => s.moveTrack);
  const removeFromPlaylist = usePlaylistStore((s) => s.removeFromPlaylist);
  const markPlayed = usePlaylistStore((s) => s.markPlayed);
  const currentPath = usePlayerStore((s) => s.currentTrack?.path);

  const [actionEntry, setActionEntry] = useState<PlaylistTrackEntry | null>(null);
  const [missingEntry, setMissingEntry] = useState<PlaylistTrackEntry | null>(null);

  useEffect(() => {
    if (playlistId == null || Number.isNaN(playlistId)) return;
    void openPlaylist(playlistId);
    return () => closePlaylist();
  }, [playlistId, openPlaylist, closePlaylist]);

  const playlist = isFavorites ? null : playlists.find((entry) => entry.id === playlistId);
  const name = isFavorites ? 'Favorites' : (playlist?.name ?? 'Playlist');
  const coverHash = playlist?.auto_cover_hash ?? null;

  const entries: PlaylistTrackEntry[] = useMemo(
    () =>
      isFavorites
        ? favoriteTracks.map((track, index) => ({
            id: track.id,
            track_path: track.path,
            position: index,
            added_at: track.added_at,
            missing: false,
            fallback_title: null,
            fallback_artist: null,
            fallback_album: null,
            track,
          }))
        : activeEntries,
    [isFavorites, favoriteTracks, activeEntries]
  );

  const playable = useMemo(
    () => entries.filter((entry) => entry.track !== null).map((entry) => entry.track as DbTrack),
    [entries]
  );
  const playableIndexByEntryId = useMemo(() => {
    const map = new Map<number, number>();
    let index = 0;
    for (const entry of entries) {
      if (entry.track) {
        map.set(entry.id, index);
        index += 1;
      }
    }
    return map;
  }, [entries]);

  const totalDuration = playable.reduce((sum, track) => sum + track.duration, 0);

  const startPlayback = (index: number) => {
    if (playable.length === 0) return;
    void playTracks(playable.map(dbTrackToTrack), index);
    if (playlistId != null && !Number.isNaN(playlistId)) void markPlayed(playlistId);
  };

  const startShuffle = () => {
    if (playable.length === 0) return;
    void shuffleTracks(playable.map(dbTrackToTrack));
    if (playlistId != null && !Number.isNaN(playlistId)) void markPlayed(playlistId);
  };

  // Move/remove only exist on real playlists; favorites rows use the standard
  // sheet (its favorite toggle is the "remove" affordance there).
  const extraItems: ActionSheetItem[] =
    playlistId != null && actionEntry
      ? [
          {
            key: 'move-up',
            label: 'Move up',
            icon: 'arrow-up',
            onPress: () => {
              void moveTrack(playlistId, actionEntry.track_path, -1);
              setActionEntry(null);
            },
          },
          {
            key: 'move-down',
            label: 'Move down',
            icon: 'arrow-down',
            onPress: () => {
              void moveTrack(playlistId, actionEntry.track_path, 1);
              setActionEntry(null);
            },
          },
          {
            key: 'remove',
            label: 'Remove from playlist',
            icon: 'remove-circle-outline',
            destructive: true,
            onPress: () => {
              void removeFromPlaylist(playlistId, actionEntry.track_path);
              setActionEntry(null);
            },
          },
        ]
      : [];

  return (
    <Screen>
      <Pressable style={styles.back} onPress={handleBack} hitSlop={8}>
        <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
        <Text variant="body" color={colors.textSecondary}>
          Library
        </Text>
      </Pressable>

      <View style={styles.header}>
        <View style={styles.art}>
          {coverHash ? (
            <Image
              source={{ uri: artworkUri(coverHash) }}
              style={styles.artImage}
              contentFit="cover"
              transition={120}
            />
          ) : (
            <Ionicons
              name={isFavorites ? 'heart' : 'musical-notes-outline'}
              size={36}
              color={isFavorites ? colors.accent : colors.textTertiary}
            />
          )}
        </View>
        <View style={styles.headerMeta}>
          <Text variant="heading" numberOfLines={2}>
            {name}
          </Text>
          <Text variant="label">
            {[
              `${playable.length} ${playable.length === 1 ? 'track' : 'tracks'}`,
              entries.length > playable.length ? `${entries.length - playable.length} missing` : null,
              formatDuration(totalDuration),
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <View style={styles.buttons}>
            <Pressable
              style={[styles.playButton, playable.length === 0 && styles.buttonDisabled]}
              disabled={playable.length === 0}
              onPress={() => startPlayback(0)}
              accessibilityRole="button"
            >
              <Ionicons name="play" size={16} color={colors.bgPrimary} />
              <Text variant="body" style={styles.playLabel}>
                Play
              </Text>
            </Pressable>
            <Pressable
              style={[styles.shuffleButton, playable.length === 0 && styles.buttonDisabled]}
              disabled={playable.length === 0}
              onPress={startShuffle}
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
        data={entries}
        keyExtractor={(entry) => String(entry.id)}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) =>
          item.track ? (
            <TrackRow
              track={item.track}
              active={item.track.path === currentPath}
              onPress={() => startPlayback(playableIndexByEntryId.get(item.id) ?? 0)}
              onLongPress={() => setActionEntry(item)}
            />
          ) : (
            <MissingRow entry={item} onLongPress={() => setMissingEntry(item)} />
          )
        }
      />

      <TrackActionsSheet
        track={actionEntry?.track ?? null}
        onClose={() => setActionEntry(null)}
        extraItems={extraItems}
      />
      <ActionSheet
        visible={missingEntry !== null}
        title={missingEntry?.fallback_title ?? 'Missing track'}
        items={
          playlistId != null && missingEntry
            ? [
                {
                  key: 'remove',
                  label: 'Remove from playlist',
                  icon: 'remove-circle-outline',
                  destructive: true,
                  onPress: () => {
                    void removeFromPlaylist(playlistId, missingEntry.track_path);
                    setMissingEntry(null);
                  },
                },
              ]
            : []
        }
        onClose={() => setMissingEntry(null)}
      />
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
  buttonDisabled: {
    opacity: 0.4,
  },
  playLabel: {
    color: colors.bgPrimary,
    fontWeight: '600',
  },
  missingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomColor: colors.glassBorder,
    borderBottomWidth: StyleSheet.hairlineWidth,
    opacity: 0.7,
  },
  missingMeta: {
    flex: 1,
    gap: 2,
  },
});
