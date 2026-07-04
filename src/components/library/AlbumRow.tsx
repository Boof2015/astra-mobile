import {
  View,
  Pressable,
  StyleSheet
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import {
  colors,
  radius,
  spacing
} from '@/theme';
import { albumArtworkSource } from '@/library/artwork';
import type { Album } from '@/types/library';

/** Compact album list row (search results) — the grid uses AlbumGridItem. */
export function AlbumRow({ album, onPress }: { album: Album; onPress: () => void }) {
  const artUri = albumArtworkSource(album);
  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button">
      <View style={styles.art}>
        {artUri ? (
          <Image
            source={{ uri: artUri }}
            style={styles.artImage}
            contentFit="cover"
          />
        ) : (
          <Ionicons name="disc-outline" size={20} color={colors.textTertiary} />
        )}
      </View>
      <View style={styles.meta}>
        <Text variant="body" numberOfLines={1}>
          {album.album}
        </Text>
        <Text variant="label" numberOfLines={1}>
          {album.artist}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    gap: spacing.md,
    borderBottomColor: colors.glassBorder,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  art: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
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
  meta: {
    flex: 1,
    gap: 2,
  },
});
