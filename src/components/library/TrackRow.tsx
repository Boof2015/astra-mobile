import { useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Text } from '@/components/Text';
import { AstraLogo } from '@/components/AstraLogo';
import { FormatBadges } from '@/components/FormatBadge';
import { colors, radius, spacing } from '@/theme';
import { formatDuration } from '@/lib/format';
import { artworkThumbUri } from '@/library/artwork';
import type { DbTrack } from '@/types/library';

const ART_SIZE = 44;
const ROW_MIN_HEIGHT = ART_SIZE + (spacing.sm + 2) * 2;

export function TrackRow({
  track,
  onPress,
  onLongPress,
  showArtist = true,
  active = false,
}: {
  track: DbTrack;
  onPress: () => void;
  /** Opens the track actions sheet where wired. */
  onLongPress?: () => void;
  /** Hide on album detail where every row shares the artist. */
  showArtist?: boolean;
  active?: boolean;
}) {
  const artworkHash = track.artwork_hash;
  const [failedArtworkHash, setFailedArtworkHash] = useState<string | null>(null);

  const thumbUri =
    artworkHash && failedArtworkHash !== artworkHash ? artworkThumbUri(artworkHash) : null;

  return (
    <Pressable
      style={styles.row}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
    >
      <View style={styles.art}>
        {thumbUri ? (
          <Image
            source={{ uri: thumbUri }}
            style={styles.artImage}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={artworkHash}
            transition={null}
            allowDownscaling
            onError={() => setFailedArtworkHash(artworkHash)}
          />
        ) : (
          <AstraLogo size={18} />
        )}
      </View>

      {!showArtist ? (
        <Text variant="mono" style={styles.trackNumber}>
          {track.track_number ?? ''}
        </Text>
      ) : null}

      <View style={styles.meta}>
        <Text
          variant="body"
          numberOfLines={1}
          style={[styles.title, active && styles.titleActive]}
        >
          {track.title}
        </Text>
        {showArtist ? (
          <Text variant="label" numberOfLines={1}>
            {track.artist}
          </Text>
        ) : null}
        <View style={styles.badges}>
          <FormatBadges
            track={{
              format: track.format,
              bitDepth: track.bit_depth ?? undefined,
              sampleRate: track.sample_rate ?? undefined,
            }}
          />
        </View>
      </View>

      <Text variant="mono" style={styles.duration}>
        {formatDuration(track.duration)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: ROW_MIN_HEIGHT,
    paddingVertical: spacing.sm + 2,
    gap: spacing.md,
    borderBottomColor: colors.glassBorder,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  art: {
    width: ART_SIZE,
    height: ART_SIZE,
    flexShrink: 0,
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
  trackNumber: {
    width: 24,
    flexShrink: 0,
    fontSize: 12,
    color: colors.textTertiary,
    textAlign: 'right',
  },
  meta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: 15,
  },
  titleActive: {
    color: colors.accent,
  },
  badges: {
    marginTop: 2,
  },
  duration: {
    minWidth: 42,
    flexShrink: 0,
    fontSize: 12,
    color: colors.textTertiary,
    textAlign: 'right',
  },
});
