import { ActionButton } from '@/components/ActionButton';
import {
  useEffect,
  useState
} from 'react';
import {
  View,
  StyleSheet
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen } from '@/components/Screen';
import { ReanimatedFlashList } from '@/components/ReanimatedFlashList';
import { Text } from '@/components/Text';
import { TrackRow } from '@/components/library/TrackRow';
import { TrackActionsSheet, type TrackActionSheetItem } from '@/components/library/TrackActionsSheet';
import {
  AppSheet,
  AppSheetItem,
  AppSheetTitle
} from '@/components/sheets/AppSheet';
import { TextPromptModal } from '@/components/sheets/TextPromptModal';
import { showAppDialog } from '@/components/dialogs/AppDialog';
import { CollapsingHeader, useDetailCollapse } from '@/components/library/CollapsingDetail';
import { spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { AppPressable, SCROLL_PRESS_DELAY } from '@/components/AppPressable';
import { usePlaylistStore } from '@/stores/playlistStore';
import { usePlayerStore } from '@/stores/playerStore';
import { playLibraryQuery } from '@/audio/playbackController';
import { artworkThumbUri, artworkUri } from '@/library/artwork';
import { formatCollectionDuration } from '@/lib/format';
import { playHaptic } from '@/lib/haptics';
import { useLibraryDetailBack } from '@/navigation/useLibraryDetailBack';
import type { Playlist, PlaylistTrackEntry } from '@/types/playlist';
import { useSceneBottomInset } from '@/navigation/useShellLayout';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** "content://…/Test.m3u8" -> "Test.m3u8" for the export confirmation. */
function fileDisplayName(fileUri: string): string {
  const decoded = decodeURIComponent(fileUri.split('/').pop() ?? fileUri);
  return decoded.split(/[/:]/).pop() || fileUri;
}

function basename(path: string): string {
  const last = path.split('/').pop() || path;
  try {
    return decodeURIComponent(last).split(/[/:]/).pop() || last;
  } catch {
    return last;
  }
}

function MissingRow({ entry, onLongPress }: { entry: PlaylistTrackEntry; onLongPress: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <AppPressable

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
    </AppPressable>
  );
}

type Prompt = { kind: 'rename'; playlist: Playlist } | null;

export default function PlaylistScreen() {
  const sceneBottomInset = useSceneBottomInset();
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { goBack, backLabel } = useLibraryDetailBack();
  const isFavorites = id === 'favorites';
  const playlistId = isFavorites ? null : Number(id);

  const playlists = usePlaylistStore((s) => s.playlists);
  const removeFavorite = usePlaylistStore((s) => s.removeFavorite);
  const favoriteSummary = usePlaylistStore((s) => s.favoriteSummary);
  const entries = usePlaylistStore((s) => s.activeEntries);
  const openPlaylist = usePlaylistStore((s) => s.openPlaylist);
  const loadNextEntries = usePlaylistStore((s) => s.loadNextEntries);
  const closePlaylist = usePlaylistStore((s) => s.closePlaylist);
  const moveTrack = usePlaylistStore((s) => s.moveTrack);
  const removeFromPlaylist = usePlaylistStore((s) => s.removeFromPlaylist);
  const renamePlaylist = usePlaylistStore((s) => s.renamePlaylist);
  const deletePlaylist = usePlaylistStore((s) => s.deletePlaylist);
  const exportM3u = usePlaylistStore((s) => s.exportM3u);
  const markPlayed = usePlaylistStore((s) => s.markPlayed);
  const currentPath = usePlayerStore((s) => s.currentTrack?.path);
  const insets = useSafeAreaInsets();
  const {
    scrollY, heroFaded, collapsed, onScroll, scrollEventThrottle,
    expandedHeight, onHeroBlockLayout, onListLayout, minContentHeight,
    onListRef, onListContentLayout, onListTouchStart, onListTouchEnd, artTapRef,
  } = useDetailCollapse(sceneBottomInset);

  const [actionEntry, setActionEntry] = useState<PlaylistTrackEntry | null>(null);
  const [missingEntry, setMissingEntry] = useState<PlaylistTrackEntry | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [prompt, setPrompt] = useState<Prompt>(null);

  useEffect(() => {
    const collectionId = isFavorites ? 'favorites' : playlistId;
    if (collectionId == null || Number.isNaN(collectionId)) return;
    let canceled = false;
    void openPlaylist(collectionId).catch((error) => {
      if (!canceled) showAppDialog({ title: 'Playlist unavailable', message: error instanceof Error ? error.message : 'Playlist could not be loaded.' });
    });
    return () => { canceled = true; closePlaylist(); };
  }, [isFavorites, playlistId, openPlaylist, closePlaylist]);

  const playlist = isFavorites ? null : playlists.find((entry) => entry.id === playlistId);
  const name = isFavorites ? 'Favorites' : (playlist?.name ?? 'Playlist');
  const coverHash = playlist?.auto_cover_hash ?? null;
  const isDynamic = playlist?.kind === 'dynamic';

  const firstPlayable = entries.find((entry) => entry.track)?.track_path;
  const canPlay = firstPlayable != null || (isFavorites && (favoriteSummary?.track_count ?? 0) > 0);
  const startPlayback = (anchorPath = firstPlayable) => {
    if (!canPlay) return;
    const query = isFavorites
      ? { kind: 'favorites' as const }
      : {
          kind: isDynamic ? 'dynamicPlaylist' as const : 'playlist' as const,
          playlistId: playlistId!,
        };
    void playLibraryQuery(query, {
      anchorPath,
      source: { kind: isFavorites ? 'favorites' : 'playlist', label: name },
    });
    if (playlistId != null && !Number.isNaN(playlistId)) void markPlayed(playlistId);
  };

  const startShuffle = () => {
    if (!canPlay) return;
    const query = isFavorites
      ? { kind: 'favorites' as const }
      : {
          kind: isDynamic ? 'dynamicPlaylist' as const : 'playlist' as const,
          playlistId: playlistId!,
        };
    void playLibraryQuery(query, {
      shuffle: true,
      source: {
        kind: isFavorites ? 'favorites' : 'playlist',
        label: name,
      },
    });
    if (playlistId != null && !Number.isNaN(playlistId)) void markPlayed(playlistId);
  };

  const handleExport = async (target: number | 'favorites') => {
    try {
      const result = await exportM3u(target);
      if (result) {
        showAppDialog({
          title: 'Playlist exported',
          message: `Wrote ${result.entryCount} ${result.entryCount === 1 ? 'entry' : 'entries'} to "${fileDisplayName(result.fileUri)}".`,
        });
      }
    } catch (err) {
      showAppDialog({ title: 'Export failed', message: errorMessage(err) });
    }
  };

  const confirmDelete = (target: Playlist) => {
    showAppDialog({
      title: 'Delete playlist?',
      message: `"${target.name}" will be deleted. Tracks are not touched.`,
      actions: [
        { label: 'Cancel', role: 'cancel' },
        {
          label: 'Delete',
          role: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deletePlaylist(target.id);
                goBack();
              } catch (err) {
                showAppDialog({ title: 'Delete failed', message: errorMessage(err) });
              }
            })();
          },
        },
      ],
    });
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

  const summary = isFavorites ? favoriteSummary : playlist;
  const meta = summary ? [
    `${summary.track_count} ${summary.track_count === 1 ? 'track' : 'tracks'}`,
    summary.missing_track_count > 0 ? `${summary.missing_track_count} missing` : null,
    formatCollectionDuration(summary.total_duration),
  ]
    .filter(Boolean)
    .join(' · ') : null;

  return (
    <Screen padded={false} style={styles.screen}>
      <ReanimatedFlashList
        ref={onListRef}
        onLoad={onListContentLayout}
        onCommitLayoutEffect={onListContentLayout}
        data={entries}
        keyExtractor={(entry) => isFavorites ? entry.track_path : String(entry.id)}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        onLayout={onListLayout}
        onTouchStart={onListTouchStart}
        onTouchEnd={onListTouchEnd}
        scrollEventThrottle={scrollEventThrottle}
        onEndReached={() => {
          void loadNextEntries();
        }}
        onEndReachedThreshold={2}
        contentContainerStyle={{
          minHeight: minContentHeight,
          paddingTop: insets.top + expandedHeight,
          paddingHorizontal: spacing.lg,
          paddingBottom: sceneBottomInset,
        }}
        renderItem={({ item }) =>
          item.track ? (
            <TrackRow
              track={item.track}
              showFormat={false}
              active={item.track.path === currentPath}
              onPress={() => startPlayback(item.track_path)}
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
        artworkViewerUri={coverHash ? artworkUri(coverHash) : null}
        artTapRef={artTapRef}
        title={name}
        heroMeta={meta == null ? null : <Text variant="label">{meta}</Text>}
        heroExtra={
          isDynamic && playlistId != null ? (
            <ActionButton
              unstable_pressDelay={SCROLL_PRESS_DELAY}
              onPress={() =>
                router.push({
                  pathname: '/library/playlist/edit-dynamic' as never,
                  params: { id: String(playlistId) },
                })
              }
              accessibilityLabel="Edit dynamic playlist rules"
              variant="secondary"
              label="Rules"
              style={{ alignSelf: 'flex-start', marginTop: spacing.sm }}
              icon="sparkles"
              iconSize={14}
            />
          ) : null
        }
        disabled={!canPlay}
        onBack={goBack}
        backLabel={backLabel}
        onMore={() => setOptionsOpen(true)}
        onPlay={() => startPlayback()}
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
        <AppSheet onClose={() => setMissingEntry(null)} scrollable>
          <AppSheetTitle
            title={missingEntry.fallback_title ?? (isFavorites ? basename(missingEntry.track_path) : 'Missing track')}
            subtitle={isFavorites ? [missingEntry.fallback_artist, missingEntry.track_path].filter(Boolean).join('\n') : (missingEntry.fallback_artist ?? 'Track not in library')}
          />
          {isFavorites || (playlistId != null && !isDynamic) ? (
            <AppSheetItem
              label={isFavorites ? 'Remove from Favorites' : 'Remove from playlist'}
              icon="remove-circle-outline"
              destructive
              onPress={() => {
                if (isFavorites) {
                  void removeFavorite(missingEntry.track_path).catch((error) => {
                    showAppDialog({ title: 'Could not update Favorites', message: errorMessage(error) });
                  });
                } else if (playlistId != null) {
                  void removeFromPlaylist(playlistId, missingEntry.track_path);
                }
                setMissingEntry(null);
              }}
            />
          ) : null}
        </AppSheet>
      ) : null}
      {optionsOpen ? (
        <AppSheet onClose={() => setOptionsOpen(false)} scrollable>
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
}));
