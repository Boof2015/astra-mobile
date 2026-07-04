import { useState } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  Alert,
  type NativeScrollEvent,
  type NativeSyntheticEvent
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import {
  AppSheet,
  AppSheetItem,
  AppSheetTitle
} from '@/components/sheets/AppSheet';
import { TextPromptModal } from '@/components/sheets/TextPromptModal';
import { PlaylistRow } from '@/components/library/PlaylistRow';
import { PullSearchScrollView } from '@/components/search/PullSearchGesture';
import {
  colors,
  radius,
  spacing
} from '@/theme';
import { usePlaylistStore } from '@/stores/playlistStore';
import type { Playlist } from '@/types/playlist';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** "content://…/Test.m3u8" -> "Test.m3u8" for the export confirmation. */
function fileDisplayName(fileUri: string): string {
  const decoded = decodeURIComponent(fileUri.split('/').pop() ?? fileUri);
  return decoded.split(/[/:]/).pop() || fileUri;
}

type Prompt = { kind: 'create' } | { kind: 'rename'; playlist: Playlist } | null;

export function PlaylistsView({
  onScroll,
  scrollEventThrottle,
}: {
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  scrollEventThrottle?: number;
}) {
  const router = useRouter();
  const playlists = usePlaylistStore((s) => s.playlists);
  const favoriteCount = usePlaylistStore((s) => s.favoriteTracks.length);
  const createPlaylist = usePlaylistStore((s) => s.createPlaylist);
  const renamePlaylist = usePlaylistStore((s) => s.renamePlaylist);
  const deletePlaylist = usePlaylistStore((s) => s.deletePlaylist);
  const importM3u = usePlaylistStore((s) => s.importM3u);
  const exportM3u = usePlaylistStore((s) => s.exportM3u);

  const [prompt, setPrompt] = useState<Prompt>(null);
  const [menuFor, setMenuFor] = useState<Playlist | 'favorites' | null>(null);

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

  const handleImport = async () => {
    try {
      const summary = await importM3u();
      if (!summary) return;
      const matched = summary.matchedByPath + summary.matchedByMetadata;
      const parts = [`${matched} of ${summary.total} entries matched the library`];
      if (summary.missing > 0) parts.push(`${summary.missing} kept as missing`);
      if (summary.ambiguous > 0) parts.push(`${summary.ambiguous} ambiguous`);
      Alert.alert(`Imported "${summary.name}"`, `${parts.join(', ')}.`);
    } catch (err) {
      Alert.alert('Import failed', errorMessage(err));
    }
  };

  const confirmDelete = (playlist: Playlist) => {
    Alert.alert('Delete playlist?', `"${playlist.name}" will be deleted. Tracks are not touched.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void deletePlaylist(playlist.id) },
    ]);
  };

  const menuItems =
    menuFor === 'favorites'
      ? [
          {
            key: 'export',
            label: 'Export M3U',
            icon: 'download-outline' as const,
            onPress: () => {
              setMenuFor(null);
              void handleExport('favorites');
            },
          },
        ]
      : menuFor
        ? [
            ...(menuFor.kind === 'dynamic'
              ? [
                  {
                    key: 'edit-rules',
                    label: 'Edit rules',
                    icon: 'options-outline' as const,
                    onPress: () => {
                      const id = menuFor.id;
                      setMenuFor(null);
                      router.push({
                        pathname: '/library/playlist/edit-dynamic' as never,
                        params: { id: String(id) },
                      });
                    },
                  },
                ]
              : []),
            {
              key: 'rename',
              label: 'Rename…',
              icon: 'pencil-outline' as const,
              onPress: () => {
                setPrompt({ kind: 'rename', playlist: menuFor });
                setMenuFor(null);
              },
            },
            {
              key: 'export',
              label: 'Export M3U',
              icon: 'download-outline' as const,
              onPress: () => {
                const id = menuFor.id;
                setMenuFor(null);
                void handleExport(id);
              },
            },
            {
              key: 'delete',
              label: 'Delete…',
              icon: 'trash-outline' as const,
              destructive: true,
              onPress: () => {
                const playlist = menuFor;
                setMenuFor(null);
                confirmDelete(playlist);
              },
            },
          ]
        : [];

  return (
    <View style={styles.container}>
      <FlashList
        data={playlists}
        keyExtractor={(playlist) => String(playlist.id)}
        showsVerticalScrollIndicator={false}
        overScrollMode="never"
        renderScrollComponent={PullSearchScrollView}
        onScroll={onScroll}
        scrollEventThrottle={scrollEventThrottle}
        ListHeaderComponent={
          <PlaylistRow
            name="Favorites"
            trackCount={favoriteCount}
            coverHash={null}
            pinned
            onPress={() => router.push('/library/playlist/favorites')}
            onLongPress={() => setMenuFor('favorites')}
          />
        }
        renderItem={({ item }) => (
          <PlaylistRow
            name={item.name}
            trackCount={item.track_count}
            missingCount={item.missing_track_count}
            coverHash={item.auto_cover_hash}
            remote={item.remote_source_id != null}
            dynamic={item.kind === 'dynamic'}
            onPress={() => router.push(`/library/playlist/${item.id}`)}
            onLongPress={() => setMenuFor(item)}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="musical-notes-outline" size={28} color={colors.textTertiary} />
            <Text variant="body" color={colors.textSecondary} style={styles.emptyText}>
              No playlists yet. Create one or import an M3U below.
            </Text>
          </View>
        }
        ListFooterComponent={
          <View style={styles.actions}>
            <Pressable
              style={styles.action}
              onPress={() => setPrompt({ kind: 'create' })}
              accessibilityRole="button"
            >
              <Ionicons name="add" size={18} color={colors.accent} />
              <Text variant="body" color={colors.accent}>
                New playlist
              </Text>
            </Pressable>
            <Pressable
              style={styles.action}
              onPress={() => router.push('/library/playlist/edit-dynamic' as never)}
              accessibilityRole="button"
            >
              <Ionicons name="sparkles-outline" size={16} color={colors.accent} />
              <Text variant="body" color={colors.accent}>
                New dynamic
              </Text>
            </Pressable>
            <Pressable
              style={styles.action}
              onPress={() => void handleImport()}
              accessibilityRole="button"
            >
              <Ionicons name="document-text-outline" size={16} color={colors.textSecondary} />
              <Text variant="body" color={colors.textSecondary}>
                Import M3U
              </Text>
            </Pressable>
          </View>
        }
      />

      {menuFor !== null ? (
        <AppSheet onClose={() => setMenuFor(null)}>
          <AppSheetTitle title={menuFor === 'favorites' ? 'Favorites' : menuFor.name} />
          {menuItems.map(({ key, ...item }) => (
            <AppSheetItem key={key} {...item} />
          ))}
        </AppSheet>
      ) : null}
      <TextPromptModal
        visible={prompt !== null}
        title={prompt?.kind === 'rename' ? 'Rename playlist' : 'New playlist'}
        placeholder="Playlist name"
        initialValue={prompt?.kind === 'rename' ? prompt.playlist.name : ''}
        submitLabel={prompt?.kind === 'rename' ? 'Rename' : 'Create'}
        onSubmit={(name) => {
          if (prompt?.kind === 'rename') {
            void renamePlaylist(prompt.playlist.id, name);
          } else {
            void createPlaylist(name);
          }
          setPrompt(null);
        }}
        onClose={() => setPrompt(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  emptyText: {
    textAlign: 'center',
    maxWidth: 260,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderColor: colors.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
});
