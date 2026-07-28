import {
  View,
  Pressable,
  StyleSheet
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import {
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { SCROLL_PRESS_DELAY, useRipple } from '@/theme/ripple';
import { artworkUri } from '@/library/artwork';
import type { Artist } from '@/types/library';

export function ArtistRow({ artist, onPress }: { artist: Artist; onPress: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  const albums = `${artist.album_count} ${artist.album_count === 1 ? 'album' : 'albums'}`;
  const tracks = `${artist.track_count} ${artist.track_count === 1 ? 'track' : 'tracks'}`;
  return (
    <Pressable android_ripple={ripple.bounded} unstable_pressDelay={SCROLL_PRESS_DELAY} style={styles.row} onPress={onPress} accessibilityRole="button">
      <View style={styles.art}>
        {artist.artwork_hash ? (
          <Image
            source={{ uri: artworkUri(artist.artwork_hash) }}
            style={styles.artImage}
            contentFit="cover"
            recyclingKey={artist.artist}
            transition={null}
          />
        ) : (
          <Ionicons name="person" size={20} color={colors.textTertiary} />
        )}
      </View>
      <View style={styles.meta}>
        <Text variant="body" numberOfLines={1}>
          {artist.artist}
        </Text>
        <Text variant="label" numberOfLines={1}>
          {albums} · {tracks}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
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
    borderRadius: radius.pill,
    backgroundColor: colors.bgTertiary,
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
  },
}));
