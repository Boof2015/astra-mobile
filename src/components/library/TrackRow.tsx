import { useState } from 'react';
import { View, Pressable, StyleSheet, type GestureResponderEvent } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { AstraLogo } from '@/components/AstraLogo';
import { FormatBadges } from '@/components/FormatBadge';
import { RemoteSourceBadge } from '@/components/RemoteSourceBadge';
import { SwipeableRow } from '@/components/SwipeableRow';
import { colors, radius, spacing } from '@/theme';
import { formatDuration } from '@/lib/format';
import { trackArtworkThumbSource } from '@/library/artwork';
import { dbTrackToTrack } from '@/library/trackAdapter';
import { enqueueEnd, enqueueTop } from '@/audio/playbackController';
import type { DbTrack } from '@/types/library';

const ART_SIZE = 44;
const ROW_MIN_HEIGHT = ART_SIZE + (spacing.sm + 2) * 2;

export function TrackRow({
  track,
  onPress,
  onLongPress,
  onOpenActions,
  showArtist = true,
  subtitle,
  active = false,
  swipeToQueue = true,
}: {
  track: DbTrack;
  onPress: () => void;
  /** Opens the track actions sheet where wired. */
  onLongPress?: () => void;
  /** Visible trailing affordance for the track actions sheet. */
  onOpenActions?: () => void;
  /** Hide on album detail where every row shares the artist. */
  showArtist?: boolean;
  /** Overrides the secondary line; useful for artist pages that need album context. */
  subtitle?: string;
  active?: boolean;
  /** Swipe right → play next, swipe left → add to queue. Off in queue-like lists. */
  swipeToQueue?: boolean;
}) {
  // Key the artwork by hash (local) or identity path (remote) so the error fallback
  // and FlashList recycling work for both.
  const artKey = track.source_type !== 'local' ? track.path : track.artwork_hash;
  const [failedArtKey, setFailedArtKey] = useState<string | null>(null);

  const thumbUri = failedArtKey !== artKey ? trackArtworkThumbSource(track) : null;
  const secondaryText = subtitle ?? (showArtist ? track.artist : null);
  const openActions = (event: GestureResponderEvent) => {
    event.stopPropagation();
    onOpenActions?.();
  };

  const row = (
    <Pressable
      style={styles.row}
      onPress={onPress}
      onLongPress={onLongPress ?? onOpenActions}
      accessibilityRole="button"
    >
      <View style={styles.art}>
        {thumbUri ? (
          <Image
            source={{ uri: thumbUri }}
            style={styles.artImage}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={artKey ?? undefined}
            transition={null}
            allowDownscaling
            onError={() => setFailedArtKey(artKey)}
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
        {secondaryText ? (
          <Text variant="label" numberOfLines={1}>
            {secondaryText}
          </Text>
        ) : null}
        <View style={styles.badges}>
          <RemoteSourceBadge sourceType={track.source_type} />
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

      {onOpenActions ? (
        <Pressable
          style={({ pressed }) => [styles.actionsButton, pressed && styles.actionsButtonPressed]}
          onPress={openActions}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`More actions for ${track.title}`}
        >
          <Ionicons name="ellipsis-horizontal" size={18} color={colors.textTertiary} />
        </Pressable>
      ) : null}
    </Pressable>
  );

  if (!swipeToQueue) return row;

  return (
    <SwipeableRow
      swipeRight={{
        icon: 'play',
        color: colors.accent,
        onCommit: () => void enqueueTop(dbTrackToTrack(track)),
      }}
      swipeLeft={{
        icon: 'list',
        color: colors.bgTertiary,
        iconColor: colors.accentText,
        onCommit: () => void enqueueEnd(dbTrackToTrack(track)),
      }}
    >
      {row}
    </SwipeableRow>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: ROW_MIN_HEIGHT,
    paddingVertical: spacing.sm + 2,
    gap: spacing.md,
    // Opaque so the swipe action lane only shows where the row has slid away.
    backgroundColor: colors.bgPrimary,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 2,
  },
  duration: {
    minWidth: 42,
    flexShrink: 0,
    fontSize: 12,
    color: colors.textTertiary,
    textAlign: 'right',
  },
  actionsButton: {
    width: 34,
    height: 34,
    flexShrink: 0,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionsButtonPressed: {
    backgroundColor: colors.glassBg,
  },
});
