import {
  useEffect,
  useMemo,
  useState
} from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  Alert
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { TrackRow } from '@/components/library/TrackRow';
import { TrackActionsSheet, type TrackActionSheetItem } from '@/components/library/TrackActionsSheet';
import {
  AppSheet,
  AppSheetItem,
  AppSheetTitle
} from '@/components/sheets/AppSheet';
import { TextPromptModal } from '@/components/sheets/TextPromptModal';
import { CollapsingHeader, useDetailCollapse } from '@/components/library/CollapsingDetail';
import { spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { SCROLL_PRESS_DELAY, useRipple } from '@/theme/ripple';
import { usePlaylistStore } from '@/stores/playlistStore';
import { usePlayerStore } from '@/stores/playerStore';
import { playTracks, shuffleTracks } from '@/audio/playbackController';
import { dbTrackToTrack } from '@/library/trackAdapter';
import { artworkThumbUri, artworkUri } from '@/library/artwork';
import { formatDuration } from '@/lib/format';
import { playHaptic } from '@/lib/haptics';
import { useLibraryDetailBack } from '@/navigation/useLibraryDetailBack';
import type { DbTrack } from '@/types/library';
import type { Playlist, PlaylistTrackEntry } from '@/types/playlist';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** "content://…/Test.m3u8" -> "Test.m3u8" for the export confirmation. */
function fileDisplayName(fileUri: string): string {
  const decoded = decodeURIComponent(fileUri.split('/').pop() ?? fileUri);
  return decoded.split(/[/:]/).pop() || fileUri;
}

function basename(path: string): string {
  const decoded = decodeURIComponent(path.split('/').pop() ?? path);
  return decoded.split(/[/:]/).pop() || path;
}

function MissingRow({ entry, onLongPress }: { entry: PlaylistTrackEntry; onLongPress: () => void }) {
  const styles = useStyles();
  const ripple = useRipple();
  const colors = useColors();
  return (
    <Pressable
      android_ripple={ripple.bounded}
      unstable_pressDelay={SCROLL_PRESS_DELAY}
      style={styles.missingRow}
      onLongPress={() => {
        playHaptic('holdAccepted');
        onLongPress();
      }}
      accessibilityRole="button"
    >
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

type Prompt = { kind: 'rename'; playlist: Playlist } | null;

export default function PlaylistScreen() {
  const styles = useStyles();
  const ripple = useRipple();
  const colors = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const handleBack = useLibraryDetailBack();
  const isFavorites = id === 'favorites';
  const playlistId = isFavorites ? null : Number(id);

  const playlists = usePlaylistStore((s) => s.playlists);
  const favoriteTracks = usePlaylistStore((s) => s.favoriteTracks);
  const activeEntries = usePlaylistStore((s) => s.activeEntries);
  const openPlaylist = usePlaylistStore((s) => s.openPlaylist);
  const closePlaylist = usePlaylistStore((s) => s.closePlaylist);
  const moveTrack = usePlaylistStore((s) => s.moveTrack);
  const removeFromPlaylist = usePlaylistStore((s) => s.removeFromPlaylist);
  const renamePlaylist = usePlaylistStore((s) => s.renamePlaylist);
  const deletePlaylist = usePlaylistStore((s) => s.deletePlaylist);
  const exportM3u = usePlaylistStore((s) => s.exportM3u);
  const markPlayed = usePlaylistStore((s) => s.markPlayed);
  const currentPath = usePlayerStore((s) => s.currentTrack?.path);
  const insets = useSafeAreaInsets();
  const { scrollY, heroFaded, collapsed, onScroll, scrollEventThrottle, expandedHeight, onHeroBlockLayout } =
    useDetailCollapse();

  const [actionEntry, setActionEntry] = useState<PlaylistTrackEntry | null>(null);
  const [missingEntry, setMissingEntry] = useState<PlaylistTrackEntry | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [prompt, setPrompt] = useState<Prompt>(null);

  useEffect(() => {
    if (playlistId == null || Number.isNaN(playlistId)) return;
    void openPlaylist(playlistId);
    return () => closePlaylist();
  }, [playlistId, openPlaylist, closePlaylist]);

  const playlist = isFavorites ? null : playlists.find((entry) => entry.id === playlistId);
  const name = isFavorites ? 'Favorites' : (playlist?.name ?? 'Playlist');
  const coverHash = playlist?.auto_cover_hash ?? null;
  const isDynamic = playlist?.kind === 'dynamic';

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

  const handleExport = async (target: number | 'favorites') => {
    try {
      const result = await exportM3u(target);
      if (result) {
        Alert.alert(
          'Playlist exported',
          `Wrote ${result.entryCount} ${result.entryCount === 1 ? 'entry' : 'entries'} to "${fileDisplayName(result.fileUri)}".`
        );
      }
    } catch (err) {
      Alert.alert('Export failed', errorMessage(err));
    }
  };

  const confirmDelete = (target: Playlist) => {
    Alert.alert('Delete playlist?', `"${target.name}" will be deleted. Tracks are not touched.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deletePlaylist(target.id);
              handleBack();
            } catch (err) {
              Alert.alert('Delete failed', errorMessage(err));
            }
          })();
        },
      },
    ]);
  };

  // Move/remove only exist on real playlists; favorites rows use the standard
  // sheet (its favorite toggle is the "remove" affordance there).
  const extraItems: TrackActionSheetItem[] =
    playlistId != null && actionEntry && !isDynamic
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

  const meta = [
    `${playable.length} ${playable.length === 1 ? 'track' : 'tracks'}`,
    entries.length > playable.length ? `${entries.length - playable.length} missing` : null,
    formatDuration(totalDuration),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Screen padded={false} style={styles.screen}>
      <FlashList
        data={entries}
        keyExtractor={(entry) => String(entry.id)}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={scrollEventThrottle}
        contentContainerStyle={{
          paddingTop: insets.top + expandedHeight,
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.xxl,
        }}
        renderItem={({ item }) =>
          item.track ? (
            <TrackRow
              track={item.track}
              active={item.track.path === currentPath}
              onPress={() => startPlayback(playableIndexByEntryId.get(item.id) ?? 0)}
              onLongPress={() => setActionEntry(item)}
              onOpenActions={() => setActionEntry(item)}
            />
          ) : (
            <MissingRow entry={item} onLongPress={() => setMissingEntry(item)} />
          )
        }
      />
      <CollapsingHeader
        artwork={
          coverHash ? (
            <Image source={{ uri: artworkUri(coverHash) }} style={styles.artFill} contentFit="cover" transition={150} />
          ) : (
            <Ionicons
              name={isFavorites ? 'heart' : 'musical-notes-outline'}
              size={56}
              color={isFavorites ? colors.accent : colors.textTertiary}
            />
          )
        }
        backdropUri={coverHash ? artworkThumbUri(coverHash) : null}
        title={name}
        heroMeta={<Text variant="label">{meta}</Text>}
        heroExtra={
          isDynamic && playlistId != null ? (
            <Pressable android_ripple={ripple.bounded} unstable_pressDelay={SCROLL_PRESS_DELAY}
              style={styles.editRules}
              onPress={() =>
                router.push({
                  pathname: '/library/playlist/edit-dynamic' as never,
                  params: { id: String(playlistId) },
                })
              }
              accessibilityRole="button"
              accessibilityLabel="Edit dynamic playlist rules"
            >
              <Ionicons name="sparkles" size={14} color={colors.accent} />
              <Text variant="label" color={colors.accent}>
                Rules
              </Text>
            </Pressable>
          ) : null
        }
        disabled={playable.length === 0}
        onBack={handleBack}
        onMore={() => setOptionsOpen(true)}
        onPlay={() => startPlayback(0)}
        onShuffle={startShuffle}
        scrollY={scrollY}
        heroFaded={heroFaded}
        collapsed={collapsed}
        expandedHeight={expandedHeight}
        onHeroBlockLayout={onHeroBlockLayout}
      />

      <TrackActionsSheet
        track={actionEntry?.track ?? null}
        onClose={() => setActionEntry(null)}
        extraItems={extraItems}
      />
      {missingEntry !== null ? (
        <AppSheet onClose={() => setMissingEntry(null)}>
          <AppSheetTitle
            title={missingEntry.fallback_title ?? 'Missing track'}
            subtitle={missingEntry.fallback_artist ?? 'Track not in library'}
          />
          {playlistId != null && !isDynamic ? (
            <AppSheetItem
              label="Remove from playlist"
              icon="remove-circle-outline"
              destructive
              onPress={() => {
                void removeFromPlaylist(playlistId, missingEntry.track_path);
                setMissingEntry(null);
              }}
            />
          ) : null}
        </AppSheet>
      ) : null}
      {optionsOpen ? (
        <AppSheet onClose={() => setOptionsOpen(false)}>
          <AppSheetTitle title={name} />
          {isFavorites ? (
            <AppSheetItem
              label="Export M3U"
              icon="download-outline"
              onPress={() => {
                setOptionsOpen(false);
                void handleExport('favorites');
              }}
            />
          ) : playlist && playlistId != null ? (
            <>
              {isDynamic ? (
                <AppSheetItem
                  label="Edit rules"
                  icon="options-outline"
                  onPress={() => {
                    setOptionsOpen(false);
                    router.push({
                      pathname: '/library/playlist/edit-dynamic' as never,
                      params: { id: String(playlistId) },
                    });
                  }}
                />
              ) : null}
              <AppSheetItem
                label="Rename…"
                icon="pencil-outline"
                onPress={() => {
                  setOptionsOpen(false);
                  setPrompt({ kind: 'rename', playlist });
                }}
              />
              <AppSheetItem
                label="Export M3U"
                icon="download-outline"
                onPress={() => {
                  setOptionsOpen(false);
                  void handleExport(playlistId);
                }}
              />
              <AppSheetItem
                label="Delete…"
                icon="trash-outline"
                destructive
                onPress={() => {
                  setOptionsOpen(false);
                  confirmDelete(playlist);
                }}
              />
            </>
          ) : null}
        </AppSheet>
      ) : null}
      <TextPromptModal
        visible={prompt !== null}
        title="Rename playlist"
        placeholder="Playlist name"
        initialValue={prompt?.playlist.name ?? ''}
        submitLabel="Rename"
        onSubmit={(nextName) => {
          if (prompt) void renamePlaylist(prompt.playlist.id, nextName);
          setPrompt(null);
        }}
        onClose={() => setPrompt(null)}
      />
    </Screen>
  );
}

const useStyles = createThemedStyles((colors) => ({
  // The backdrop runs behind the status bar; content pads itself instead.
  screen: {
    paddingTop: 0,
  },
  artFill: {
    width: '100%',
    height: '100%',
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
  editRules: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderColor: colors.accent,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginTop: spacing.sm,
  },
}));
