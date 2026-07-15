import { useEffect, useMemo, useState } from 'react';
import {
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { AstraLogo } from '@/components/AstraLogo';
import { TrackRow } from '@/components/library/TrackRow';
import { TrackActionsSheet } from '@/components/library/TrackActionsSheet';
import { PlaylistRow } from '@/components/library/PlaylistRow';
import { ScanProgress } from '@/components/library/ScanProgress';
import {
  PullSearchGesture,
  PullSearchScrollView,
  useScrollTopGate
} from '@/components/search/PullSearchGesture';
import {
  fonts,
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { SCROLL_PRESS_DELAY, useRipple } from '@/theme/ripple';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useSearchStore } from '@/stores/searchStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { playTracks, shuffleTracks } from '@/audio/playbackController';
import { compareTracksByDiscTrackTitle } from '@/library/albumIdentity';
import { buildArtistDetail } from '@/library/artistDetail';
import { filterArtistBrowseList } from '@/library/artistGrouping';
import { dbTrackToTrack } from '@/library/trackAdapter';
import { albumArtworkSource, artworkUri } from '@/library/artwork';
import {
  chooseHomeGreeting,
  HOME_GREETING_ROTATION_MS,
  type HomeGreetingTextMode,
} from '@/home/homeGreeting';
import type { Album, Artist, DbTrack } from '@/types/library';

const RECENT_ALBUM_LIMIT = 8;
const RECENT_TRACK_LIMIT = 3;
const PLAYLIST_LIMIT = 4;

type RandomSpotlight =
  | { kind: 'album'; key: string }
  | { kind: 'artist'; name: string };

function chooseRandomSpotlight(
  albums: Album[],
  artists: Artist[],
  current: RandomSpotlight | null = null,
  random: () => number = Math.random
): RandomSpotlight | null {
  const kinds: RandomSpotlight['kind'][] = [];
  if (albums.length > 0) kinds.push('album');
  if (artists.length > 0) kinds.push('artist');
  if (kinds.length === 0) return null;

  let kind = kinds[Math.floor(random() * kinds.length)];
  const currentPoolSize = kind === 'album' ? albums.length : artists.length;
  if (current?.kind === kind && currentPoolSize === 1 && kinds.length > 1) {
    kind = kind === 'album' ? 'artist' : 'album';
  }

  if (kind === 'album') {
    const candidates =
      current?.kind === 'album' && albums.length > 1
        ? albums.filter((album) => album.identity_key !== current.key)
        : albums;
    const album = candidates[Math.floor(random() * candidates.length)];
    return album ? { kind: 'album', key: album.identity_key } : null;
  }

  const candidates =
    current?.kind === 'artist' && artists.length > 1
      ? artists.filter((artist) => artist.artist !== current.name)
      : artists;
  const artist = candidates[Math.floor(random() * candidates.length)];
  return artist ? { kind: 'artist', name: artist.artist } : null;
}

function compactAlbumMeta(album: Album): string {
  return [
    album.artist,
    album.year ? String(album.year) : null,
    `${album.track_count} ${album.track_count === 1 ? 'track' : 'tracks'}`,
  ]
    .filter(Boolean)
    .join(' / ');
}

function compactArtistMeta(artist: Artist): string {
  return [
    `${artist.album_count} ${artist.album_count === 1 ? 'album' : 'albums'}`,
    `${artist.track_count} ${artist.track_count === 1 ? 'track' : 'tracks'}`,
  ].join(' / ');
}

function formatHomeClockTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatHomeClockDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

function HomeMasthead({
  mode,
  onSearch,
  onScan,
}: {
  mode: HomeGreetingTextMode;
  onSearch: () => void;
  onScan: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  const [clockNow, setClockNow] = useState(() => new Date());
  const [greeting, setGreeting] = useState(() => chooseHomeGreeting(null, new Date()));

  useEffect(() => {
    if (mode !== 'messages') return;
    const rotateGreeting = () => {
      setGreeting((current) => chooseHomeGreeting(current.id, new Date()));
    };
    const interval = setInterval(rotateGreeting, HOME_GREETING_ROTATION_MS);
    return () => clearInterval(interval);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'clock') return;

    let interval: ReturnType<typeof setInterval> | null = null;
    const updateClock = () => setClockNow(new Date());
    updateClock();

    const now = new Date();
    const delay = 60_000 - (now.getSeconds() * 1_000 + now.getMilliseconds());
    const timeout = setTimeout(() => {
      updateClock();
      interval = setInterval(updateClock, 60_000);
    }, Math.max(100, delay));

    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, [mode]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const now = new Date();
      setClockNow(now);
      if (mode === 'messages') {
        setGreeting((current) => chooseHomeGreeting(current.id, now));
      }
    });
    return () => subscription.remove();
  }, [mode]);

  const searchButton = (
    <Pressable
      style={styles.mastheadSearch}
      android_ripple={ripple.icon(22)}
      unstable_pressDelay={SCROLL_PRESS_DELAY}
      onPress={onSearch}
      accessibilityRole="button"
      accessibilityLabel="Search music"
      hitSlop={4}
    >
      <Ionicons name="search" size={22} color={colors.textPrimary} />
    </Pressable>
  );

  const scanButton = (
    <Pressable
      style={styles.mastheadSearch}
      android_ripple={ripple.icon(22)}
      unstable_pressDelay={SCROLL_PRESS_DELAY}
      onPress={onScan}
      accessibilityRole="button"
      accessibilityLabel="Scan an Astra Signal"
      hitSlop={4}
    >
      <Ionicons name="scan-outline" size={22} color={colors.textPrimary} />
    </Pressable>
  );

  const utilityButtons = (
    <View style={styles.mastheadActions}>
      {scanButton}
      {searchButton}
    </View>
  );

  if (mode === 'off') {
    return <View style={styles.mastheadUtility}>{utilityButtons}</View>;
  }

  const primary = mode === 'clock' ? formatHomeClockTime(clockNow) : greeting.primary;
  const subline = mode === 'clock' ? formatHomeClockDate(clockNow) : greeting.subline;

  return (
    <View style={styles.masthead}>
      <View style={styles.mastheadCopy}>
        <Text variant="heading" style={styles.mastheadPrimary} numberOfLines={2}>
          {primary}
        </Text>
        {subline ? (
          <Text variant="body" color={colors.textSecondary} numberOfLines={2}>
            {subline}
          </Text>
        ) : null}
      </View>
      {utilityButtons}
    </View>
  );
}

function formatCount(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

function SectionHeader({
  title,
  trailing,
  actionLabel,
  onActionPress,
}: {
  title: string;
  trailing?: string;
  actionLabel?: string;
  onActionPress?: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionTitleGroup}>
        <Text variant="heading" style={styles.sectionTitle}>
          {title}
        </Text>
        {trailing ? (
          <Text variant="label" numberOfLines={1}>
            {trailing}
          </Text>
        ) : null}
      </View>
      {onActionPress && actionLabel ? (
        <Pressable style={styles.seeAllButton} android_ripple={ripple.bounded} unstable_pressDelay={SCROLL_PRESS_DELAY} onPress={onActionPress} accessibilityRole="button">
          <Text variant="label" color={colors.accentText}>
            {actionLabel}
          </Text>
          <Ionicons name="chevron-forward" size={14} color={colors.accentText} />
        </Pressable>
      ) : null}
    </View>
  );
}

function AlbumCover({ album, size }: { album: Album; size: number }) {
  const styles = useStyles();
  const artUri = albumArtworkSource(album);
  return (
    <View style={[styles.albumArt, { width: size, height: size }]}>
      {artUri ? (
        <Image
          source={{ uri: artUri }}
          style={styles.image}
          contentFit="cover"
          transition={120}
        />
      ) : (
        <AstraLogo size={Math.round(size * 0.36)} />
      )}
    </View>
  );
}

function ArtistCover({ artist, size }: { artist: Artist; size: number }) {
  const styles = useStyles();
  const colors = useColors();
  const useMosaic = artist.artwork_hashes.length >= 4;
  const hashes = useMosaic
    ? artist.artwork_hashes.slice(0, 4)
    : artist.artwork_hashes.slice(0, 1);

  return (
    <View style={[styles.albumArt, styles.artistArt, { width: size, height: size }]}>
      {hashes.length === 0 ? (
        <Ionicons name="person" size={Math.round(size * 0.4)} color={colors.textTertiary} />
      ) : useMosaic ? (
        hashes.map((hash) => (
          <Image
            key={hash}
            source={{ uri: artworkUri(hash) }}
            style={styles.artistMosaicTile}
            contentFit="cover"
            recyclingKey={hash}
            transition={null}
          />
        ))
      ) : (
        <Image
          source={{ uri: artworkUri(hashes[0]) }}
          style={styles.image}
          contentFit="cover"
          recyclingKey={hashes[0]}
          transition={null}
        />
      )}
    </View>
  );
}

function RecentlyAddedAlbum({
  album,
  onPress,
}: {
  album: Album;
  onPress: () => void;
}) {
  const styles = useStyles();
  const ripple = useRipple();
  return (
    <Pressable style={styles.recentAlbum} android_ripple={ripple.tile} unstable_pressDelay={SCROLL_PRESS_DELAY} onPress={onPress} accessibilityRole="button">
      <AlbumCover album={album} size={112} />
      <Text variant="body" numberOfLines={1} style={styles.recentAlbumTitle}>
        {album.album}
      </Text>
      <Text variant="label" numberOfLines={1}>
        {album.artist}
      </Text>
    </Pressable>
  );
}

function RandomSpotlightCard({
  spotlight,
  tracks,
  onPlay,
  onShuffle,
  onReroll,
  onOpen,
}: {
  spotlight: { kind: 'album'; album: Album } | { kind: 'artist'; artist: Artist };
  tracks: DbTrack[];
  onPlay: () => void;
  onShuffle: () => void;
  onReroll: () => void;
  onOpen: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  const disabled = tracks.length === 0;
  const title = spotlight.kind === 'album' ? spotlight.album.album : spotlight.artist.artist;
  const label = spotlight.kind === 'album' ? 'RANDOM ALBUM' : 'RANDOM ARTIST';
  const meta = spotlight.kind === 'album'
    ? compactAlbumMeta(spotlight.album)
    : compactArtistMeta(spotlight.artist);
  const runAction = (event: GestureResponderEvent, action: () => void) => {
    event.stopPropagation();
    action();
  };

  return (
    <Pressable
      style={styles.randomCard}
      android_ripple={ripple.tile}
      unstable_pressDelay={SCROLL_PRESS_DELAY}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Open ${title}`}
    >
      <View style={styles.randomMain}>
        {spotlight.kind === 'album' ? (
          <AlbumCover album={spotlight.album} size={88} />
        ) : (
          <ArtistCover artist={spotlight.artist} size={88} />
        )}
        <View style={styles.randomMeta}>
          <Text variant="label" color={colors.textTertiary}>
            {label}
          </Text>
          <Text variant="heading" numberOfLines={1}>
            {title}
          </Text>
          <Text variant="label" color={colors.textSecondary} numberOfLines={1}>
            {meta}
          </Text>
          <View style={styles.randomActions}>
            <Pressable
              android_ripple={ripple.onAccent()}
              unstable_pressDelay={SCROLL_PRESS_DELAY}
              style={[styles.randomPrimaryAction, disabled && styles.buttonDisabled]}
              disabled={disabled}
              onPress={(event) => runAction(event, onPlay)}
              hitSlop={{ top: 7, right: 4, bottom: 7, left: 4 }}
              accessibilityRole="button"
              accessibilityLabel={`Play ${title}`}
            >
              <Ionicons name="play" size={16} color={colors.bgPrimary} />
            </Pressable>
            <Pressable
              android_ripple={ripple.icon(18)}
              unstable_pressDelay={SCROLL_PRESS_DELAY}
              style={[styles.randomAction, disabled && styles.buttonDisabled]}
              disabled={disabled}
              onPress={(event) => runAction(event, onShuffle)}
              hitSlop={{ top: 7, right: 4, bottom: 7, left: 4 }}
              accessibilityRole="button"
              accessibilityLabel={`Shuffle ${title}`}
            >
              <Ionicons name="shuffle" size={17} color={colors.accent} />
            </Pressable>
            <Pressable
              android_ripple={ripple.icon(18)}
              unstable_pressDelay={SCROLL_PRESS_DELAY}
              style={styles.randomAction}
              onPress={(event) => runAction(event, onReroll)}
              hitSlop={{ top: 7, right: 4, bottom: 7, left: 4 }}
              accessibilityRole="button"
              accessibilityLabel="Pick another random album or artist"
            >
              <Ionicons name="refresh" size={17} color={colors.textSecondary} />
            </Pressable>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function EmptyHomeCard({
  scanError,
  onManageFolders,
}: {
  scanError: string | null;
  onManageFolders: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  return (
    <View style={styles.emptyCard}>
      <Ionicons name="folder-open-outline" size={34} color={colors.textTertiary} />
      <View style={styles.emptyCopy}>
        <Text variant="heading">No music yet</Text>
        <Text variant="body" color={colors.textSecondary}>
          Add a local folder to fill Home with albums, history, favorites, and playlists.
        </Text>
        {scanError ? (
          <Text variant="caption" color={colors.warning} numberOfLines={2}>
            Scan problem: {scanError}
          </Text>
        ) : null}
      </View>
      <Pressable
        android_ripple={ripple.onAccent()} unstable_pressDelay={SCROLL_PRESS_DELAY}
        style={styles.primaryButton}
        onPress={onManageFolders}
        accessibilityRole="button"
      >
        <Ionicons name="folder-open-outline" size={18} color={colors.bgPrimary} />
        <Text variant="body" style={styles.primaryButtonText}>
          Folder settings
        </Text>
      </Pressable>
    </View>
  );
}

export default function HomeScreen() {
  const styles = useStyles();
  const router = useRouter();
  const tracks = useLibraryStore((s) => s.tracks);
  const albums = useLibraryStore((s) => s.albums);
  const artists = useLibraryStore((s) => s.artists);
  const includeCollabArtists = useLibraryStore((s) => s.includeCollabArtists);
  const recentlyPlayedTracks = useLibraryStore((s) => s.recentlyPlayedTracks);
  const scanError = useLibraryStore((s) => s.scanError);
  const playlists = usePlaylistStore((s) => s.playlists);
  const favoriteTracks = usePlaylistStore((s) => s.favoriteTracks);
  const currentPath = usePlayerStore((s) => s.currentTrack?.path);
  const openQuickSearch = useSearchStore((s) => s.openQuickSearch);
  const homeGreetingTextMode = useSettingsStore((s) => s.homeGreetingTextMode);
  const artistGroupingMode = useSettingsStore((s) => s.artistGroupingMode);

  const [spotlightOverride, setSpotlightOverride] = useState<RandomSpotlight | null>(null);
  const [randomSeeds] = useState(() => [Math.random(), Math.random()] as const);
  const [actionTrack, setActionTrack] = useState<DbTrack | null>(null);
  const scrollTop = useScrollTopGate();
  const hasLibrary = tracks.length > 0;

  const recentlyAddedAlbums = useMemo(
    () => [...albums].sort((a, b) => b.latest_added_at - a.latest_added_at).slice(0, RECENT_ALBUM_LIMIT),
    [albums]
  );

  const visibleArtists = useMemo(
    () => filterArtistBrowseList(artists, artistGroupingMode, includeCollabArtists),
    [artistGroupingMode, artists, includeCollabArtists]
  );

  const homePlaylists = useMemo(
    () =>
      [...playlists]
        .sort(
          (a, b) =>
            (b.last_played_at ?? b.updated_at ?? b.created_at) -
            (a.last_played_at ?? a.updated_at ?? a.created_at)
        )
        .slice(0, PLAYLIST_LIMIT),
    [playlists]
  );

  const randomSpotlight = useMemo(() => {
    const overrideValid = spotlightOverride?.kind === 'album'
      ? albums.some((album) => album.identity_key === spotlightOverride.key)
      : spotlightOverride?.kind === 'artist'
        ? visibleArtists.some((artist) => artist.artist === spotlightOverride.name)
        : false;
    if (spotlightOverride && overrideValid) return spotlightOverride;

    let seedIndex = 0;
    return chooseRandomSpotlight(
      albums,
      visibleArtists,
      null,
      () => randomSeeds[seedIndex++] ?? randomSeeds[0]
    );
  }, [albums, randomSeeds, spotlightOverride, visibleArtists]);

  const randomAlbum = randomSpotlight?.kind === 'album'
    ? albums.find((album) => album.identity_key === randomSpotlight.key) ?? null
    : null;
  const randomArtist = randomSpotlight?.kind === 'artist'
    ? visibleArtists.find((artist) => artist.artist === randomSpotlight.name) ?? null
    : null;
  const spotlightContent = randomAlbum
    ? ({ kind: 'album', album: randomAlbum } as const)
    : randomArtist
      ? ({ kind: 'artist', artist: randomArtist } as const)
      : null;

  const randomAlbumNeedsTracks = hasLibrary && randomAlbum != null;
  const tracksByAlbum = useMemo(() => {
    if (!randomAlbumNeedsTracks) return null;
    const map = new Map<string, DbTrack[]>();
    for (const track of tracks) {
      const list = map.get(track.album_identity_key) ?? [];
      list.push(track);
      map.set(track.album_identity_key, list);
    }
    // Store tracks are artist-ordered; a multi-artist compilation would play
    // blocked by artist without an explicit album-order sort.
    for (const list of map.values()) list.sort(compareTracksByDiscTrackTitle);
    return map;
  }, [randomAlbumNeedsTracks, tracks]);
  const randomTracks =
    randomAlbum && tracksByAlbum ? (tracksByAlbum.get(randomAlbum.identity_key) ?? []) : [];
  const randomArtistDetail = useMemo(
    () => randomArtist
      ? buildArtistDetail(tracks, randomArtist.artist, artistGroupingMode)
      : null,
    [artistGroupingMode, randomArtist, tracks]
  );
  const spotlightTracks = randomAlbum ? randomTracks : randomArtistDetail?.playbackTracks ?? [];
  const recentTracks = recentlyPlayedTracks.slice(0, RECENT_TRACK_LIMIT);
  const canExpandRecentTracks = recentlyPlayedTracks.length > RECENT_TRACK_LIMIT;

  const openAlbum = (album: Album) => {
    router.push({
      pathname: '/library/album/[key]',
      params: { key: album.identity_key },
    });
  };

  const openArtist = (artist: Artist) => {
    router.push({
      pathname: '/library/artist/[name]',
      params: { name: artist.artist },
    });
  };

  const playTrackList = (list: DbTrack[], index = 0) => {
    if (list.length === 0) return;
    void playTracks(list.map(dbTrackToTrack), index);
  };

  const playSpotlight = (shuffled = false) => {
    if (spotlightTracks.length === 0) return;
    if (shuffled) {
      void shuffleTracks(spotlightTracks.map(dbTrackToTrack));
    } else {
      void playTracks(spotlightTracks.map(dbTrackToTrack), 0);
    }
  };

  const rerollSpotlight = () => {
    setSpotlightOverride(chooseRandomSpotlight(albums, visibleArtists, randomSpotlight));
  };

  const openSearch = () => openQuickSearch();
  const openSignalScanner = () => router.push('/signal/scan' as never);

  return (
    <Screen>
      <PullSearchGesture atTop={scrollTop.atTop} onOpen={openSearch}>
        <PullSearchScrollView
          showsVerticalScrollIndicator={false}
          overScrollMode="never"
          contentContainerStyle={styles.content}
          onScroll={scrollTop.onScroll}
          scrollEventThrottle={scrollTop.scrollEventThrottle}
        >
          <HomeMasthead
            mode={homeGreetingTextMode}
            onSearch={openSearch}
            onScan={openSignalScanner}
          />

          <ScanProgress />

          {!hasLibrary ? (
            <EmptyHomeCard
              scanError={scanError}
              onManageFolders={() => router.push('/settings')}
            />
          ) : (
            <>
            {spotlightContent ? (
              <View style={styles.topFeature}>
                <RandomSpotlightCard
                  spotlight={spotlightContent}
                  tracks={spotlightTracks}
                  onOpen={() => spotlightContent.kind === 'album'
                    ? openAlbum(spotlightContent.album)
                    : openArtist(spotlightContent.artist)}
                  onPlay={() => playSpotlight()}
                  onShuffle={() => playSpotlight(true)}
                  onReroll={rerollSpotlight}
                />
              </View>
            ) : null}

            {recentTracks.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader
                  title="Recently Played"
                  trailing={formatCount(recentlyPlayedTracks.length, 'track')}
                  actionLabel={canExpandRecentTracks ? 'See all' : undefined}
                  onActionPress={
                    canExpandRecentTracks ? () => router.push('/recently-played') : undefined
                  }
                />
                <View style={styles.listBlock}>
                  {recentTracks.map((track, index) => (
                    <TrackRow
                      key={track.path}
                      track={track}
                      active={track.path === currentPath}
                      swipeToQueue={false}
                      onPress={() => playTrackList(recentTracks, index)}
                      onLongPress={() => setActionTrack(track)}
                      onOpenActions={() => setActionTrack(track)}
                    />
                  ))}
                </View>
              </View>
            ) : null}

            {recentlyAddedAlbums.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader title="Recently Added" />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.albumRail}
                >
                  {recentlyAddedAlbums.map((album) => (
                    <RecentlyAddedAlbum
                      key={album.identity_key}
                      album={album}
                      onPress={() => openAlbum(album)}
                    />
                  ))}
                </ScrollView>
              </View>
            ) : null}

            {favoriteTracks.length > 0 || homePlaylists.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader title="Favorites & Playlists" />
                <View style={styles.listBlock}>
                  {favoriteTracks.length > 0 ? (
                    <PlaylistRow
                      name="Favorites"
                      trackCount={favoriteTracks.length}
                      coverHash={favoriteTracks[0]?.artwork_hash ?? null}
                      pinned
                      onPress={() => router.push('/library/playlist/favorites')}
                    />
                  ) : null}
                  {homePlaylists.map((playlist) => (
                    <PlaylistRow
                      key={playlist.id}
                      name={playlist.name}
                      trackCount={playlist.track_count}
                      missingCount={playlist.missing_track_count}
                      coverHash={playlist.auto_cover_hash}
                      onPress={() => router.push(`/library/playlist/${playlist.id}`)}
                    />
                  ))}
                </View>
              </View>
            ) : null}
            </>
          )}
        </PullSearchScrollView>
      </PullSearchGesture>
      <TrackActionsSheet track={actionTrack} onClose={() => setActionTrack(null)} />
    </Screen>
  );
}

const useStyles = createThemedStyles((colors) => ({
  content: {
    paddingBottom: spacing.xxl,
  },
  masthead: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xl,
    paddingVertical: spacing.sm,
  },
  mastheadUtility: {
    height: 44,
    marginTop: spacing.xl,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  mastheadCopy: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    gap: spacing.xs,
  },
  mastheadActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  mastheadPrimary: {
    fontSize: 28,
    lineHeight: 32,
  },
  mastheadSearch: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glassHighlight,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  topFeature: {
    marginTop: spacing.xl,
  },
  section: {
    marginTop: spacing.xl,
  },
  sectionHeader: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  sectionTitleGroup: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  sectionTitle: {
    flex: 1,
  },
  seeAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.xs,
    paddingLeft: spacing.sm,
  },
  albumRail: {
    gap: spacing.md,
    paddingRight: spacing.lg,
  },
  recentAlbum: {
    width: 112,
  },
  recentAlbumTitle: {
    marginTop: spacing.sm,
    fontSize: 14,
  },
  albumArt: {
    borderRadius: radius.md,
    backgroundColor: colors.bgTertiary,
    borderColor: colors.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  artistArt: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  artistMosaicTile: {
    width: '50%',
    height: '50%',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  randomCard: {
    minHeight: 112,
    borderRadius: radius.md,
    backgroundColor: colors.glassBg,
    borderColor: colors.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  randomMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  randomMeta: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'stretch',
    justifyContent: 'space-between',
    gap: 2,
  },
  randomActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  randomPrimaryAction: {
    width: 36,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  randomAction: {
    width: 36,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glassHighlight,
  },
  primaryButton: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  primaryButtonText: {
    color: colors.bgPrimary,
    fontFamily: fonts.sans.semibold,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  listBlock: {
    backgroundColor: colors.bgPrimary,
  },
  emptyCard: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.glassBg,
    borderColor: colors.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.md,
  },
  emptyCopy: {
    gap: spacing.xs,
  },
}));
