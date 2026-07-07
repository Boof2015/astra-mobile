import {
  View,
  Pressable,
  StyleSheet
} from 'react-native';
import { Image } from 'expo-image';
import { Text } from '@/components/Text';
import { AstraLogo } from '@/components/AstraLogo';
import {
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles } from '@/theme/themed';
import { albumArtworkSource } from '@/library/artwork';
import type { Album } from '@/types/library';

export function AlbumGridItem({ album, onPress }: { album: Album; onPress: () => void }) {
  const styles = useStyles();
  const artUri = albumArtworkSource(album);
  return (
    <Pressable style={styles.item} onPress={onPress} accessibilityRole="button">
      <View style={styles.art}>
        {artUri ? (
          <Image
            source={{ uri: artUri }}
            style={styles.artImage}
            contentFit="cover"
            recyclingKey={album.identity_key}
            transition={null}
          />
        ) : (
          <AstraLogo size={36} />
        )}
      </View>
      <Text variant="body" numberOfLines={1} style={styles.title}>
        {album.album}
      </Text>
      <Text variant="label" numberOfLines={1}>
        {album.artist}
      </Text>
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  item: {
    flex: 1,
    marginBottom: spacing.lg,
  },
  art: {
    aspectRatio: 1,
    borderRadius: radius.md,
    backgroundColor: colors.bgTertiary,
    borderColor: colors.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  artImage: {
    width: '100%',
    height: '100%',
  },
  title: {
    fontSize: 14,
  },
}));
