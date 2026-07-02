import { useMemo, useState, type ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { AstraLogo } from '@/components/AstraLogo';
import { TrackRow } from '@/components/library/TrackRow';
import { TrackActionsSheet } from '@/components/library/TrackActionsSheet';
import { colors, fontSize, radius, spacing } from '@/theme';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { playTracks, shuffleTracks } from '@/audio/playbackController';
import { dbTrackToTrack } from '@/library/trackAdapter';
import { artworkUri } from '@/library/artwork';
import { buildArtistDetail, type ArtistAlbum, type ArtistDetail } from '@/library/artistDetail';
import { useLibraryDetailBack } from '@/navigation/useLibraryDetailBack';
import type { DbTrack } from '@/types/library';

type IconName = ComponentProps<typeof Ionicons>['name'];
type ArtistSectionTarget = 'songs' | 'albums' | 'appearances';

const SONG_PREVIEW_LIMIT = 5;
const ALBUM_PREVIEW_LIMIT = 8;
const APPEARANCE_PREVIEW_LIMIT = 5;

type ArtistPageItem =
  | { key: 'hero'; type: 'hero' }
  | {
      key: string;
      type: 'section';
      title: string;
      trailing: string;
      target?: ArtistSectionTarget;
    }
  | { key: 'albums'; type: 'albums' }
  | { key: string; type: 'track'; track: DbTrack; section: 'appearances' | 'songs'; index: number }
  | { key: 'empty'; type: 'empty' };

export default function ArtistScreen() {
  const router = useRouter();
  const { name = 'Artist', from } = useLocalSearchParams<{ name: string; from?: string }>();
  const handleBack = useLibraryDetailBack(from);
  const { width } = useWindowDimensions();
  const allTracks = useLibraryStore((s) => s.tracks);
  const groupingMode = useSettingsStore((s) => s.artistGroupingMode);
  const currentPath = usePlayerStore((s) => s.currentTrack?.path);
  const [actionTrack, setActionTrack] = useState<DbTrack | null>(null);

  const detail = useMemo(
    () => buildArtistDetail(allTracks, name, groupingMode),
    [allTracks, name, groupingMode]
  );

  const listItems = useMemo(() => buildListItems(detail), [detail]);

  const playTrackListFrom = (tracks: readonly DbTrack[], index: number) => {
    if (tracks.length === 0) return;
    void playTracks(tracks.map(dbTrackToTrack), index);
  };

  const playArtist = () => playTrackListFrom(detail.playbackTracks, 0);
  const shuffleArtist = () => {
    if (detail.playbackTracks.length === 0) return;
    void shuffleTracks(detail.playbackTracks.map(dbTrackToTrack));
  };

  const openSection = (target: ArtistSectionTarget) => {
    router.push({
      pathname: `/library/artist/[name]/${target}`,
      params: { name },
    });
  };

  const renderItem = ({ item }: { item: ArtistPageItem }) => {
    switch (item.type) {
      case 'hero':
        return (
          <ArtistHero
            artistName={name}
            detail={detail}
            compact={width < 380}
            onPlay={playArtist}
            onShuffle={shuffleArtist}
          />
        );
      case 'section': {
        const target = item.target;
        return (
          <SectionHeader
            title={item.title}
            trailing={item.trailing}
            onPress={target ? () => openSection(target) : undefined}
          />
        );
      }
      case 'albums':
        return (
          <AlbumRail
            albums={detail.albums.slice(0, ALBUM_PREVIEW_LIMIT)}
            onAlbumPress={(album) =>
              router.push({
                pathname: '/library/album/[key]',
                params: { key: album.identity_key },
              })
            }
          />
        );
      case 'track': {
        const sourceTracks =
          item.section === 'appearances' ? detail.appearanceTracks : detail.songTracks;
        return (
          <TrackRow
            track={item.track}
            subtitle={trackSubtitle(item.track, item.section)}
            active={item.track.path === currentPath}
            onPress={() => playTrackListFrom(sourceTracks, item.index)}
            onLongPress={() => setActionTrack(item.track)}
          />
        );
      }
      case 'empty':
        return (
          <View style={styles.emptyState}>
            <Ionicons name="musical-notes" size={24} color={colors.textTertiary} />
            <Text variant="body" color={colors.textSecondary} style={styles.emptyText}>
              No tracks found for this artist.
            </Text>
          </View>
        );
    }
  };

  return (
    <Screen>
      <Pressable style={styles.back} onPress={handleBack} hitSlop={8}>
        <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
        <Text variant="body" color={colors.textSecondary}>
          Library
        </Text>
      </Pressable>

      <FlashList
        data={listItems}
        keyExtractor={(item) => item.key}
        showsVerticalScrollIndicator={false}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
      />

      <TrackActionsSheet track={actionTrack} onClose={() => setActionTrack(null)} />
    </Screen>
  );
}

function buildListItems(detail: ArtistDetail): ArtistPageItem[] {
  const items: ArtistPageItem[] = [{ key: 'hero', type: 'hero' }];

  if (detail.tracks.length === 0) {
    items.push({ key: 'empty', type: 'empty' });
    return items;
  }

  items.push({
    key: 'section-songs',
    type: 'section',
    title: 'Songs',
    trailing: formatCount(detail.songTracks.length, 'track'),
    target: 'songs',
  });
  detail.songTracks.slice(0, SONG_PREVIEW_LIMIT).forEach((track, index) => {
    items.push({ key: `song-${track.id}`, type: 'track', track, section: 'songs', index });
  });

  if (detail.albums.length > 0) {
    items.push({
      key: 'section-albums',
      type: 'section',
      title: 'Albums',
      trailing: formatCount(detail.albums.length, 'album'),
      target: 'albums',
    });
    items.push({ key: 'albums', type: 'albums' });
  }

  if (detail.showAppearances) {
    items.push({
      key: 'section-appearances',
      type: 'section',
      title: 'Appears On',
      trailing: formatCount(detail.appearanceTracks.length, 'track'),
      target: 'appearances',
    });
    detail.appearanceTracks.slice(0, APPEARANCE_PREVIEW_LIMIT).forEach((track, index) => {
      items.push({
        key: `appearance-${track.id}`,
        type: 'track',
        track,
        section: 'appearances',
        index,
      });
    });
  }

  return items;
}

function ArtistHero({
  artistName,
  detail,
  compact,
  onPlay,
  onShuffle,
}: {
  artistName: string;
  detail: ArtistDetail;
  compact: boolean;
  onPlay: () => void;
  onShuffle: () => void;
}) {
  const disabled = detail.playbackTracks.length === 0;

  return (
    <View style={styles.hero}>
      <ArtistArtwork hashes={detail.artworkHashes} compact={compact} />
      <View style={styles.heroMeta}>
        <Text
          variant="title"
          numberOfLines={3}
          adjustsFontSizeToFit
          minimumFontScale={0.78}
          style={styles.artistName}
        >
          {artistName}
        </Text>
        <View style={styles.stats}>
          {detail.albums.length > 0 ? (
            <StatChip icon="albums-outline" label={formatCount(detail.albums.length, 'album')} />
          ) : null}
          <StatChip icon="musical-notes-outline" label={formatCount(detail.tracks.length, 'track')} />
          {detail.totalDuration > 0 ? (
            <StatChip icon="time-outline" label={formatRuntime(detail.totalDuration)} />
          ) : null}
        </View>
      </View>

      <View style={styles.actionRow}>
        <Pressable
          style={[styles.actionButton, styles.primaryAction, disabled && styles.disabledAction]}
          onPress={onPlay}
          disabled={disabled}
          accessibilityRole="button"
        >
          <Ionicons name="play" size={17} color={colors.bgPrimary} />
          <Text variant="body" style={styles.primaryActionText}>
            Play
          </Text>
        </Pressable>
        <Pressable
          style={[styles.actionButton, styles.secondaryAction, disabled && styles.disabledAction]}
          onPress={onShuffle}
          disabled={disabled}
          accessibilityRole="button"
        >
          <Ionicons name="shuffle" size={17} color={colors.accent} />
          <Text variant="body" color={colors.accent} style={styles.secondaryActionText}>
            Shuffle
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function ArtistArtwork({ hashes, compact }: { hashes: string[]; compact: boolean }) {
  const useMosaic = hashes.length >= 4;
  const displayHashes = useMosaic ? hashes.slice(0, 4) : hashes.slice(0, 1);

  return (
    <View style={[styles.heroArt, compact && styles.heroArtCompact]}>
      {displayHashes.length === 0 ? (
        <Ionicons name="person" size={compact ? 42 : 52} color={colors.textTertiary} />
      ) : useMosaic ? (
        displayHashes.map((hash) => (
          <Image
            key={hash}
            source={{ uri: artworkUri(hash) }}
            style={styles.mosaicTile}
            contentFit="cover"
            transition={120}
          />
        ))
      ) : (
        <Image
          source={{ uri: artworkUri(displayHashes[0]) }}
          style={styles.heroArtImage}
          contentFit="cover"
          transition={120}
        />
      )}
    </View>
  );
}

function SectionHeader({
  title,
  trailing,
  onPress,
}: {
  title: string;
  trailing: string;
  onPress?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionTitleGroup}>
        <Text variant="heading" style={styles.sectionTitle}>
          {title}
        </Text>
        <Text variant="label" numberOfLines={1}>
          {trailing}
        </Text>
      </View>
      {onPress ? (
        <Pressable style={styles.seeAllButton} onPress={onPress} accessibilityRole="button">
          <Text variant="label" color={colors.accentText}>
            See all
          </Text>
          <Ionicons name="chevron-forward" size={14} color={colors.accentText} />
        </Pressable>
      ) : null}
    </View>
  );
}

function AlbumRail({
  albums,
  onAlbumPress,
}: {
  albums: ArtistAlbum[];
  onAlbumPress: (album: ArtistAlbum) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.albumRail}
    >
      {albums.map((album) => (
        <Pressable
          key={album.identity_key}
          style={styles.albumCard}
          onPress={() => onAlbumPress(album)}
          accessibilityRole="button"
        >
          <View style={styles.albumArt}>
            {album.artwork_hash ? (
              <Image
                source={{ uri: artworkUri(album.artwork_hash) }}
                style={styles.albumArtImage}
                contentFit="cover"
                transition={120}
              />
            ) : (
              <AstraLogo size={34} />
            )}
          </View>
          <Text variant="body" numberOfLines={2} style={styles.albumTitle}>
            {album.album}
          </Text>
          <Text variant="label" numberOfLines={1}>
            {[album.year ? String(album.year) : null, formatCount(album.track_count, 'track')]
              .filter(Boolean)
              .join(' - ')}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function StatChip({ icon, label }: { icon: IconName; label: string }) {
  return (
    <View style={styles.statChip}>
      <Ionicons name={icon} size={13} color={colors.accentText} />
      <Text variant="caption" color={colors.accentText} numberOfLines={1} style={styles.statLabel}>
        {label}
      </Text>
    </View>
  );
}

function formatCount(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

function formatRuntime(seconds: number): string {
  const totalMinutes = seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : 0;
  if (totalMinutes < 60) return `${totalMinutes}m`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function trackSubtitle(track: DbTrack, section: 'appearances' | 'songs'): string {
  if (section === 'appearances') return `${track.artist} - ${track.album}`;
  return track.album;
}

const styles = StyleSheet.create({
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    alignSelf: 'flex-start',
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  hero: {
    alignItems: 'center',
    gap: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  heroArt: {
    width: 168,
    height: 168,
    borderRadius: radius.lg,
    backgroundColor: colors.bgTertiary,
    borderColor: colors.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  heroArtCompact: {
    width: 144,
    height: 144,
  },
  heroArtImage: {
    width: '100%',
    height: '100%',
  },
  mosaicTile: {
    width: '50%',
    height: '50%',
  },
  heroMeta: {
    width: '100%',
    alignItems: 'center',
    gap: spacing.md,
  },
  artistName: {
    maxWidth: '100%',
    textAlign: 'center',
    lineHeight: fontSize.xxl * 1.08,
  },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  statChip: {
    minHeight: 28,
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.glassHighlight,
    borderColor: colors.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
  },
  statLabel: {
    maxWidth: 180,
  },
  actionRow: {
    width: '100%',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
  },
  primaryAction: {
    backgroundColor: colors.accent,
  },
  secondaryAction: {
    borderColor: colors.accent,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.glassBg,
  },
  disabledAction: {
    opacity: 0.45,
  },
  primaryActionText: {
    color: colors.bgPrimary,
    fontWeight: '600',
  },
  secondaryActionText: {
    fontWeight: '600',
  },
  sectionHeader: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionTitleGroup: {
    flex: 1,
    minWidth: 0,
  },
  sectionTitle: {
    fontSize: fontSize.md,
  },
  seeAllButton: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingLeft: spacing.sm,
  },
  albumRail: {
    gap: spacing.md,
    paddingRight: spacing.lg,
    paddingBottom: spacing.sm,
  },
  albumCard: {
    width: 132,
  },
  albumArt: {
    width: 132,
    height: 132,
    borderRadius: radius.md,
    backgroundColor: colors.bgTertiary,
    borderColor: colors.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  albumArtImage: {
    width: '100%',
    height: '100%',
  },
  albumTitle: {
    minHeight: 38,
    fontSize: 14,
    lineHeight: 19,
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
