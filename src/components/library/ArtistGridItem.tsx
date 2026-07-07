import {
  View,
  Pressable,
  StyleSheet
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import {
  spacing,
  radius,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { artworkUri } from '@/library/artwork';
import type { Artist } from '@/types/library';

/** 2-column grid cell: square art (2x2 album mosaic when available) + counts, matching the album grid. */
export function ArtistGridItem({ artist, onPress }: { artist: Artist; onPress: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  const useMosaic = artist.artwork_hashes.length >= 4;
  const hashes = useMosaic ? artist.artwork_hashes.slice(0, 4) : artist.artwork_hashes.slice(0, 1);

  const albums = `${artist.album_count} ${artist.album_count === 1 ? 'album' : 'albums'}`;
  const tracks = `${artist.track_count} ${artist.track_count === 1 ? 'track' : 'tracks'}`;

  return (
    <Pressable style={styles.item} onPress={onPress} accessibilityRole="button">
      <View style={styles.art}>
        {hashes.length === 0 ? (
          <Ionicons name="person" size={44} color={colors.textTertiary} />
        ) : useMosaic ? (
          hashes.map((hash) => (
            <Image
              key={hash}
              source={{ uri: artworkUri(hash) }}
              style={styles.mosaicTile}
              contentFit="cover"
              recyclingKey={hash}
              transition={null}
            />
          ))
        ) : (
          <Image
            source={{ uri: artworkUri(hashes[0]) }}
            style={styles.artImage}
            contentFit="cover"
            recyclingKey={hashes[0]}
            transition={null}
          />
        )}
      </View>
      <Text variant="body" numberOfLines={1} style={styles.name}>
        {artist.artist}
      </Text>
      <Text variant="label" numberOfLines={1}>
        {albums} · {tracks}
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
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  artImage: {
    width: '100%',
    height: '100%',
  },
  mosaicTile: {
    width: '50%',
    height: '50%',
  },
  name: {
    fontSize: 14,
  },
}));
