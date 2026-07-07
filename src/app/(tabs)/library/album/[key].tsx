import { useMemo, useState } from 'react';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { AstraLogo } from '@/components/AstraLogo';
import { TrackRow } from '@/components/library/TrackRow';
import { TrackActionsSheet } from '@/components/library/TrackActionsSheet';
import { CollapsingHeader, useDetailCollapse } from '@/components/library/CollapsingDetail';
import { spacing } from '@/theme';
import { useColors } from '@/theme/themed';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePlayerStore } from '@/stores/playerStore';
import { playTracks, shuffleTracks } from '@/audio/playbackController';
import { compareTracksByDiscTrackTitle } from '@/library/albumIdentity';
import { dbTrackToTrack } from '@/library/trackAdapter';
import { albumArtworkSource, artworkThumbUri, artworkUri } from '@/library/artwork';
import { formatDuration } from '@/lib/format';
import { useLibraryDetailBack } from '@/navigation/useLibraryDetailBack';
import type { DbTrack } from '@/types/library';

type AlbumRow =
  | { kind: 'track'; track: DbTrack; index: number }
  | { kind: 'disc'; disc: number };

function DiscHeader({ disc }: { disc: number }) {
  const colors = useColors();
  return (
    <View style={styles.discHeader}>
      <Ionicons name="disc-outline" size={16} color={colors.textSecondary} />
      <Text variant="heading">Disc {disc}</Text>
    </View>
  );
}

export default function AlbumScreen() {
  const colors = useColors();
  const { key, from } = useLocalSearchParams<{ key: string; from?: string }>();
  const albums = useLibraryStore((s) => s.albums);
  const allTracks = useLibraryStore((s) => s.tracks);
  const currentPath = usePlayerStore((s) => s.currentTrack?.path);
  const handleBack = useLibraryDetailBack(from);
  const insets = useSafeAreaInsets();
  const { scrollY, heroFaded, collapsed, onScroll, scrollEventThrottle, expandedHeight, onHeroBlockLayout } =
    useDetailCollapse();

  const album = albums.find((entry) => entry.identity_key === key);
  // Store tracks are artist-ordered, so a multi-artist group (Various Artists
  // compilation) would come out blocked by artist — re-sort into album order.
  const tracks = useMemo(
    () =>
      allTracks
        .filter((track) => track.album_identity_key === key)
        .sort(compareTracksByDiscTrackTitle),
    [allTracks, key]
  );

  const totalDuration = tracks.reduce((sum, track) => sum + track.duration, 0);
  const [actionTrack, setActionTrack] = useState<DbTrack | null>(null);

  // Interleave "Disc N" headers only when the album spans multiple discs;
  // untagged tracks fall back to disc 1. Track rows keep their index into the
  // flat `tracks` array so tap-to-play stays correct.
  const albumItems = useMemo<AlbumRow[]>(() => {
    const maxDisc = tracks.reduce((m, track) => Math.max(m, track.disc_number ?? 1), 1);
    if (maxDisc <= 1) {
      return tracks.map((track, index) => ({ kind: 'track', track, index }));
    }
    const rows: AlbumRow[] = [];
    let lastDisc: number | null = null;
    tracks.forEach((track, index) => {
      const disc = track.disc_number ?? 1;
      if (disc !== lastDisc) {
        rows.push({ kind: 'disc', disc });
        lastDisc = disc;
      }
      rows.push({ kind: 'track', track, index });
    });
    return rows;
  }, [tracks]);

  const playFrom = (index: number) => {
    void playTracks(tracks.map(dbTrackToTrack), index);
  };

  // Eligibility can filter an album out of the store list (a single reached via
  // "go to album") — fall back to the filtered tracks' own metadata.
  const fallbackTrack = tracks[0];
  const headerArtist =
    album?.artist ??
    fallbackTrack?.album_display_artist ??
    fallbackTrack?.album_artist ??
    fallbackTrack?.artist;
  const headerArtworkHash = album?.artwork_hash ?? fallbackTrack?.artwork_hash ?? null;
  const artSource = album
    ? albumArtworkSource(album)
    : headerArtworkHash
      ? artworkUri(headerArtworkHash)
      : null;
  // Blur the cached thumbnail, not the full-res cover (remote albums have no
  // local thumb — their server URL is already sized reasonably).
  const backdropUri = headerArtworkHash ? artworkThumbUri(headerArtworkHash) : artSource;
  const meta = [
    (album?.year ?? fallbackTrack?.year) ? String(album?.year ?? fallbackTrack?.year) : null,
    `${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'}`,
    formatDuration(totalDuration),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Screen padded={false} style={styles.screen}>
      <FlashList
        data={albumItems}
        keyExtractor={(item) => (item.kind === 'disc' ? `disc-${item.disc}` : String(item.track.id))}
        getItemType={(item) => item.kind}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={scrollEventThrottle}
        contentContainerStyle={{
          paddingTop: insets.top + expandedHeight,
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.xxl,
        }}
        renderItem={({ item }) =>
          item.kind === 'disc' ? (
            <DiscHeader disc={item.disc} />
          ) : (
            <TrackRow
              track={item.track}
              showArtist={false}
              active={item.track.path === currentPath}
              onPress={() => playFrom(item.index)}
              onLongPress={() => setActionTrack(item.track)}
              onOpenActions={() => setActionTrack(item.track)}
            />
          )
        }
      />
      <CollapsingHeader
        artwork={
          artSource ? (
            <Image source={{ uri: artSource }} style={styles.artFill} contentFit="cover" transition={150} />
          ) : (
            <AstraLogo size={56} />
          )
        }
        backdropUri={backdropUri}
        title={album?.album ?? tracks[0]?.album ?? 'Album'}
        heroMeta={
          <>
            {headerArtist ? (
              <Text variant="body" color={colors.textSecondary} numberOfLines={1}>
                {headerArtist}
              </Text>
            ) : null}
            <Text variant="label">{meta}</Text>
          </>
        }
        disabled={tracks.length === 0}
        onBack={handleBack}
        onPlay={() => playFrom(0)}
        onShuffle={() => void shuffleTracks(tracks.map(dbTrackToTrack))}
        scrollY={scrollY}
        heroFaded={heroFaded}
        collapsed={collapsed}
        expandedHeight={expandedHeight}
        onHeroBlockLayout={onHeroBlockLayout}
      />
      <TrackActionsSheet track={actionTrack} onClose={() => setActionTrack(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // The backdrop runs behind the status bar; content pads itself instead.
  screen: {
    paddingTop: 0,
  },
  artFill: {
    width: '100%',
    height: '100%',
  },
  discHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
});
