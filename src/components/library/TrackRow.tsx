import { useState } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  type GestureResponderEvent
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { AstraLogo } from '@/components/AstraLogo';
import { FormatBadges } from '@/components/FormatBadge';
import { RemoteSourceBadge } from '@/components/RemoteSourceBadge';
import { SwipeableRow } from '@/components/SwipeableRow';
import {
  colors,
  radius,
  spacing
} from '@/theme';
import { formatDuration } from '@/lib/format';
import { trackArtworkThumbSource } from '@/library/artwork';
import { dbTrackToTrack } from '@/library/trackAdapter';
import { enqueueEnd, enqueueTop } from '@/audio/playbackController';
import type { DbTrack } from '@/types/library';

const ART_SIZE = 44;
const ROW_MIN_HEIGHT = ART_SIZE + (spacing.sm + 2) * 2;
const ACTIONS_BUTTON = 34;

export function TrackRow({
  track,
  onPress,
  onLongPress,
  onOpenActions,
  showArtist = true,
  subtitle,
  active = false,
  swipeToQueue = true,
  selectionMode = false,
  selected = false,
  onToggleSelect,
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
  /** Multi-select: press toggles selection, checkbox leads, swipes/actions off. */
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
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
      style={[styles.row, selectionMode && selected && styles.rowSelected]}
      onPress={selectionMode ? onToggleSelect : onPress}
      onLongPress={selectionMode ? onToggleSelect : (onLongPress ?? onOpenActions)}
      accessibilityRole="button"
      accessibilityState={selectionMode ? { selected } : undefined}
    >
      {selectionMode ? (
        <Ionicons
          name={selected ? 'checkmark-circle' : 'ellipse-outline'}
          size={22}
          color={selected ? colors.accent : colors.textTertiary}
          style={styles.checkbox}
        />
      ) : null}
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
            variant="plain"
            track={{
              format: track.format,
              bitDepth: track.bit_depth ?? undefined,
              sampleRate: track.sample_rate ?? undefined,
            }}
          />
        </View>
      </View>

      <Text variant="mono" style={[styles.duration, selectionMode && styles.durationSelection]}>
        {formatDuration(track.duration)}
      </Text>

      {onOpenActions && !selectionMode ? (
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

  if (!swipeToQueue || selectionMode) return row;

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
  rowSelected: {
    backgroundColor: colors.glassHighlight,
  },
  checkbox: {
    flexShrink: 0,
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
    width: 20,
    flexShrink: 0,
    // The row's uniform gap plus a right-aligned box leaves the number floating
    // too far off the artwork; pull it back in toward the cover.
    marginLeft: -spacing.sm,
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
  // Selection mode drops the actions button; reserve its footprint so the
  // duration holds its position instead of sliding to the row edge.
  durationSelection: {
    marginRight: ACTIONS_BUTTON + spacing.md,
  },
  actionsButton: {
    width: ACTIONS_BUTTON,
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
