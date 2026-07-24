import {
  Pressable,
  StyleSheet,
  View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { AlbumGridItem } from '@/components/library/AlbumGridItem';
import { spacing } from '@/theme';
import { useColors } from '@/theme/themed';
import { SCROLL_PRESS_DELAY, useRipple } from '@/theme/ripple';
import { useSettingsStore } from '@/stores/settingsStore';
import { useNativeArtistAlbums } from '@/library/nativePages';

export default function ArtistAlbumsScreen() {
  const colors = useColors();
  const ripple = useRipple();
  const router = useRouter();
  const { name = 'Artist', credit } = useLocalSearchParams<{
    name: string;
    credit?: string;
  }>();
  const groupingMode = useSettingsStore((s) => s.artistGroupingMode);
  const detailGroupingMode = credit === '1' ? 'astra' : groupingMode;
  const page = useNativeArtistAlbums(name, detailGroupingMode);

  return (
    <Screen>
      <Pressable android_ripple={ripple.bounded} unstable_pressDelay={SCROLL_PRESS_DELAY} style={styles.back} onPress={() => router.back()} hitSlop={8}>
        <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
        <Text variant="body" color={colors.textSecondary} numberOfLines={1}>
          {name}
        </Text>
      </Pressable>

      <View style={styles.heading}>
        <Text variant="title" numberOfLines={1}>
          Albums
        </Text>
        <Text variant="label">
          {formatCount(page.totalCount, 'album')}
        </Text>
      </View>

      <FlashList
        data={page.items}
        numColumns={2}
        keyExtractor={(album) => album.identity_key}
        showsVerticalScrollIndicator={false}
        onEndReached={() => void page.loadMore()}
        onEndReachedThreshold={0.6}
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
  const colors = useColors();
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
