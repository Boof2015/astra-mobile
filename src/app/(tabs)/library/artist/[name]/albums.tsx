import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { AlbumGridItem } from '@/components/library/AlbumGridItem';
import { colors, spacing } from '@/theme';
import { useLibraryStore } from '@/stores/libraryStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { buildArtistDetail } from '@/library/artistDetail';

export default function ArtistAlbumsScreen() {
  const router = useRouter();
  const { name = 'Artist' } = useLocalSearchParams<{ name: string }>();
  const allTracks = useLibraryStore((s) => s.tracks);
  const groupingMode = useSettingsStore((s) => s.artistGroupingMode);

  const detail = useMemo(
    () => buildArtistDetail(allTracks, name, groupingMode),
    [allTracks, name, groupingMode]
  );

  return (
    <Screen>
      <Pressable style={styles.back} onPress={() => router.back()} hitSlop={8}>
        <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
        <Text variant="body" color={colors.textSecondary} numberOfLines={1}>
          {name}
        </Text>
      </Pressable>

      <View style={styles.heading}>
        <Text variant="title" numberOfLines={1}>
          Albums
        </Text>
        <Text variant="label">{formatCount(detail.albums.length, 'album')}</Text>
      </View>

      <FlashList
        data={detail.albums}
        numColumns={2}
        keyExtractor={(album) => album.identity_key}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <View style={styles.gridCell}>
            <AlbumGridItem
              album={item}
              onPress={() =>
                router.push({
                  pathname: '/library/album/[key]',
                  params: { key: item.identity_key },
                })
              }
            />
          </View>
        )}
        ListEmptyComponent={<EmptyList label="No albums found for this artist." />}
        contentContainerStyle={styles.listContent}
      />
    </Screen>
  );
}

function EmptyList({ label }: { label: string }) {
  return (
    <View style={styles.emptyState}>
      <Ionicons name="albums-outline" size={24} color={colors.textTertiary} />
      <Text variant="body" color={colors.textSecondary} style={styles.emptyText}>
        {label}
      </Text>
    </View>
  );
}

function formatCount(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

const styles = StyleSheet.create({
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: spacing.md,
    marginBottom: spacing.lg,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  heading: {
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  gridCell: {
    flex: 1,
    paddingHorizontal: spacing.xs,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxl,
  },
  emptyText: {
    textAlign: 'center',
  },
});
