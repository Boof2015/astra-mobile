import {
  StyleSheet,
  View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { ScreenHeader, useScreenHeader } from '@/components/ScreenHeader';
import { Text } from '@/components/Text';
import { AlbumGridItem } from '@/components/library/AlbumGridItem';
import { spacing } from '@/theme';
import { useColors } from '@/theme/themed';
import { useSettingsStore } from '@/stores/settingsStore';
import { useNativeArtistAlbums } from '@/library/nativePages';
import { useSceneBottomInset } from '@/navigation/useShellLayout';

export default function ArtistAlbumsScreen() {
  const sceneBottomInset = useSceneBottomInset();
  const header = useScreenHeader({ hasSubtitle: true });
  const router = useRouter();
  const { name = 'Artist', credit } = useLocalSearchParams<{
    name: string;
    credit?: string;
  }>();
  const groupingMode = useSettingsStore((s) => s.artistGroupingMode);
  const detailGroupingMode = credit === '1' ? 'astra' : groupingMode;
  const page = useNativeArtistAlbums(name, detailGroupingMode);

  return (
    // The header is an overlay the grid scrolls under, so the screen keeps
    // neither the top inset nor the gutter — both move into the grid itself.
    <Screen padded={false} style={styles.screen}>
      <FlashList
        data={page.items}
        numColumns={2}
        keyExtractor={(album) => album.identity_key}
        showsVerticalScrollIndicator={false}
        onScroll={header.onScroll}
        scrollEventThrottle={header.scrollEventThrottle}
        onEndReached={() => void page.loadMore()}
        onEndReachedThreshold={2}
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
        contentContainerStyle={{
          paddingTop: header.contentPaddingTop,
          paddingHorizontal: spacing.lg,
          paddingBottom: sceneBottomInset,
        }}
      />

      <ScreenHeader
        header={header}
        title="Albums"
        subtitle={formatCount(page.totalCount, 'album')}
        backLabel={name}
        onBack={() => router.back()}
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
  // The header draws behind the status bar; the grid pays the inset instead.
  screen: {
    paddingTop: 0,
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
