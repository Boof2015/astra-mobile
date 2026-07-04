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
import { artworkUri } from '@/library/artwork';

export function PlaylistRow({
  name,
  trackCount,
  missingCount = 0,
  coverHash,
  pinned = false,
  remote = false,
  onPress,
  onLongPress,
}: {
  name: string;
  trackCount: number;
  missingCount?: number;
  coverHash: string | null;
  /** Favorites pseudo-playlist: heart cover instead of artwork/logo. */
  pinned?: boolean;
  /** Synced from a remote server — shows a cloud marker. */
  remote?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  return (
    <Pressable
      style={styles.row}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
    >
      <View style={styles.cover}>
        {coverHash ? (
          <Image
            source={{ uri: artworkUri(coverHash) }}
            style={styles.coverImage}
            contentFit="cover"
            transition={120}
          />
        ) : (
          <Ionicons
            name={pinned ? 'heart' : 'musical-notes-outline'}
            size={20}
            color={pinned ? colors.accent : colors.textTertiary}
          />
        )}
      </View>
      <View style={styles.meta}>
        <View style={styles.titleRow}>
          <Text variant="body" numberOfLines={1} style={styles.title}>
            {name}
          </Text>
          {remote ? <Ionicons name="cloud" size={12} color={colors.accent} /> : null}
        </View>
        <Text variant="label" numberOfLines={1}>
          {`${trackCount} ${trackCount === 1 ? 'track' : 'tracks'}`}
          {missingCount > 0 ? (
            <Text variant="label" color={colors.warning}>
              {`  ·  ${missingCount} missing`}
            </Text>
          ) : null}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomColor: colors.glassBorder,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cover: {
    width: 48,
    height: 48,
    borderRadius: radius.sm,
    backgroundColor: colors.bgTertiary,
    borderColor: colors.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
  meta: {
    flex: 1,
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  title: {
    flexShrink: 1,
  },
});
