import { useDeferredValue, useMemo, useState } from 'react';
import { View, Pressable, StyleSheet, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { TrackRow } from '@/components/library/TrackRow';
import { AlbumRow } from '@/components/library/AlbumRow';
import { ArtistRow } from '@/components/library/ArtistRow';
import { TrackActionsSheet } from '@/components/library/TrackActionsSheet';
import { colors, fonts, fontSize, radius, spacing } from '@/theme';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePlayerStore } from '@/stores/playerStore';
import { playTracks } from '@/audio/playbackController';
import { dbTrackToTrack } from '@/library/trackAdapter';
import type { Album, Artist, DbTrack } from '@/types/library';

const TRACK_CAP = 50;
const ALBUM_CAP = 12;
const ARTIST_CAP = 12;

type SearchItem =
  | { type: 'header'; key: string; label: string }
  | { type: 'album'; key: string; album: Album }
  | { type: 'artist'; key: string; artist: Artist }
  | { type: 'track'; key: string; track: DbTrack; index: number };

function filterCap<T>(items: T[], predicate: (item: T) => boolean, cap: number): T[] {
  const out: T[] = [];
  for (const item of items) {
    if (predicate(item)) {
      out.push(item);
      if (out.length >= cap) break;
    }
  }
  return out;
}

export default function SearchScreen() {
  const router = useRouter();
  const tracks = useLibraryStore((s) => s.tracks);
  const albums = useLibraryStore((s) => s.albums);
  const artists = useLibraryStore((s) => s.artists);
  const currentPath = usePlayerStore((s) => s.currentTrack?.path);

  const [query, setQuery] = useState('');
  const [actionTrack, setActionTrack] = useState<DbTrack | null>(null);
  const needle = useDeferredValue(query.trim().toLocaleLowerCase());

  const { items, trackResults } = useMemo(() => {
    if (!needle) return { items: [] as SearchItem[], trackResults: [] as DbTrack[] };

    // In-memory ≈ desktop searchTracks (LIKE %q% over title/artist/album).
    const albumResults = filterCap(
      albums,
      (album) =>
        album.album.toLocaleLowerCase().includes(needle) ||
        album.artist.toLocaleLowerCase().includes(needle),
      ALBUM_CAP
    );
    const artistResults = filterCap(
      artists,
      (artist) => artist.artist.toLocaleLowerCase().includes(needle),
      ARTIST_CAP
    );
    const trackResults = filterCap(
      tracks,
      (track) =>
        track.title.toLocaleLowerCase().includes(needle) ||
        track.artist.toLocaleLowerCase().includes(needle) ||
        track.album.toLocaleLowerCase().includes(needle),
      TRACK_CAP
    );

    const items: SearchItem[] = [];
    if (albumResults.length > 0) {
      items.push({ type: 'header', key: 'header-albums', label: 'Albums' });
      for (const album of albumResults) {
        items.push({ type: 'album', key: `album-${album.identity_key}`, album });
      }
    }
    if (artistResults.length > 0) {
      items.push({ type: 'header', key: 'header-artists', label: 'Artists' });
      for (const artist of artistResults) {
        items.push({ type: 'artist', key: `artist-${artist.artist}`, artist });
      }
    }
    if (trackResults.length > 0) {
      items.push({ type: 'header', key: 'header-tracks', label: 'Tracks' });
      trackResults.forEach((track, index) => {
        items.push({ type: 'track', key: `track-${track.id}`, track, index });
      });
    }
    return { items, trackResults };
  }, [needle, tracks, albums, artists]);

  const playFrom = (index: number) => {
    void playTracks(trackResults.map(dbTrackToTrack), index);
  };

  return (
    <Screen>
      <View style={styles.searchBar}>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button">
          <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
        </Pressable>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Search tracks, albums, artists"
          placeholderTextColor={colors.textTertiary}
          autoFocus
          returnKeyType="search"
          selectionColor={colors.accent}
        />
        {query.length > 0 ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button">
            <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
          </Pressable>
        ) : null}
      </View>

      {!needle ? (
        <View style={styles.empty}>
          <Text variant="caption">Search your library</Text>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Text variant="caption">No results for “{query.trim()}”</Text>
        </View>
      ) : (
        <FlashList
          data={items}
          keyExtractor={(item) => item.key}
          getItemType={(item) => item.type}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            switch (item.type) {
              case 'header':
                return (
                  <Text variant="label" style={styles.sectionHeader}>
                    {item.label.toUpperCase()}
                  </Text>
                );
              case 'album':
                return (
                  <AlbumRow
                    album={item.album}
                    onPress={() =>
                      router.push({
                        pathname: '/library/album/[key]',
                        params: { key: item.album.identity_key },
                      })
                    }
                  />
                );
              case 'artist':
                return (
                  <ArtistRow
                    artist={item.artist}
                    onPress={() =>
                      router.push({
                        pathname: '/library/artist/[name]',
                        params: { name: item.artist.artist },
                      })
                    }
                  />
                );
              case 'track':
                return (
                  <TrackRow
                    track={item.track}
                    active={item.track.path === currentPath}
                    onPress={() => playFrom(item.index)}
                    onLongPress={() => setActionTrack(item.track)}
                  />
                );
            }
          }}
        />
      )}

      <TrackActionsSheet track={actionTrack} onClose={() => setActionTrack(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  input: {
    flex: 1,
    fontFamily: fonts.sans.regular,
    fontSize: fontSize.base,
    color: colors.textPrimary,
    backgroundColor: colors.bgTertiary,
    borderColor: colors.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  empty: {
    alignItems: 'center',
    marginTop: spacing.xxl,
  },
  sectionHeader: {
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
    letterSpacing: 1,
  },
});
