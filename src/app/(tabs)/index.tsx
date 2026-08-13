import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AppState,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { useTopBleedInset } from '@/components/screenTopBleed';
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
import { AppPressable, SCROLL_PRESS_DELAY } from '@/components/AppPressable';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useSearchStore } from '@/stores/searchStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { playLibraryQuery } from '@/audio/playbackController';
import { filterArtistBrowseList } from '@/library/artistGrouping';
import { albumArtworkSource, artworkUri } from '@/library/artwork';
import {
  chooseHomeGreeting,
  HOME_GREETING_ROTATION_MS,
  type HomeGreetingTextMode,
} from '@/home/homeGreeting';
import { getHomeLayout, HOME_COLUMN_GAP } from '@/home/homeLayout';
import { useHomeLibraryNavigation } from '@/navigation/useHomeLibraryNavigation';
import type { Album, Artist, DbTrack } from '@/types/library';
import {
  hasListeningPreview,
  ListeningPreviewCard,
} from '@/components/listening/ListeningPreviewCard';
import { useListeningStatsStore } from '@/stores/listeningStatsStore';
import { subscribeToListeningHistory } from '@/listeningStats/events';
import { useSceneBottomInset } from '@/navigation/useShellLayout';
import { useTabReselect } from '@/navigation/useTabReselect';
import { shouldAnimateScrollToTop } from '@/navigation/scrollToTopBehavior';

const RECENT_ALBUM_LIMIT = 8;
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
    <AppPressable
      style={styles.mastheadSearch}
      feedback="control"
      unstable_pressDelay={SCROLL_PRESS_DELAY}
      onPress={onSearch}
      accessibilityRole="button"
      accessibilityLabel="Search music"
      hitSlop={4}
    >
      <Ionicons name="search" size={22} color={colors.textPrimary} />
    </AppPressable>
  );

  const scanButton = (
    <AppPressable
      style={styles.mastheadSearch}
      feedback="control"
      unstable_pressDelay={SCROLL_PRESS_DELAY}
      onPress={onScan}
      accessibilityRole="button"
      accessibilityLabel="Scan an Astra Signal"
      hitSlop={4}
    >
      <Ionicons name="scan-outline" size={22} color={colors.textPrimary} />
    </AppPressable>
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
        <AppPressable feedback="control" style={styles.seeAllButton}  unstable_pressDelay={SCROLL_PRESS_DELAY} onPress={onActionPress} accessibilityRole="button">
          <Text variant="label" color={colors.accentText}>
            {actionLabel}
          </Text>
          <Ionicons name="chevron-forward" size={14} color={colors.accentText} />
        </AppPressable>
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
  size,
  onPress,
}: {
  album: Album;
  size: number;
  onPress: () => void;
}) {
  const styles = useStyles();
  return (
    <AppPressable style={[styles.recentAlbum, { width: size }]} feedback="tile" unstable_pressDelay={SCROLL_PRESS_DELAY} onPress={onPress} accessibilityRole="button">
      <AlbumCover album={album} size={size} />
      <Text variant="body" numberOfLines={1} style={styles.recentAlbumTitle}>
        {album.album}
      </Text>
      <Text variant="label" numberOfLines={1}>
        {album.artist}
      </Text>
    </AppPressable>
  );
}

function RandomSpotlightCard({
  spotlight,
  hasTracks,
  coverSize,
  style,
  onPlay,
  onShuffle,
  onReroll,
  onOpen,
}: {
  spotlight: { kind: 'album'; album: Album } | { kind: 'artist'; artist: Artist };
  hasTracks: boolean;
  coverSize: number;
  style?: StyleProp<ViewStyle>;
  onPlay: () => void;
  onShuffle: () => void;
  onReroll: () => void;
  onOpen: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const disabled = !hasTracks;
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
    <AppPressable
      style={[styles.randomCard, style]}
      feedback="tile"
      unstable_pressDelay={SCROLL_PRESS_DELAY}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Open ${title}`}
    >
      <View style={styles.randomMain}>
        {spotlight.kind === 'album' ? (
          <AlbumCover album={spotlight.album} size={coverSize} />
        ) : (
          <ArtistCover artist={spotlight.artist} size={coverSize} />
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
            <AppPressable
              feedback="accent"
              unstable_pressDelay={SCROLL_PRESS_DELAY}
              style={[styles.randomPrimaryAction, disabled && styles.buttonDisabled]}
              disabled={disabled}
              onPress={(event) => runAction(event, onPlay)}
              hitSlop={{ top: 7, right: 4, bottom: 7, left: 4 }}
              accessibilityRole="button"
              accessibilityLabel={`Play ${title}`}
            >
              <Ionicons name="play" size={16} color={colors.bgPrimary} />
            </AppPressable>
            <AppPressable
              feedback="control"
              unstable_pressDelay={SCROLL_PRESS_DELAY}
              style={[styles.randomAction, disabled && styles.buttonDisabled]}
              disabled={disabled}
              onPress={(event) => runAction(event, onShuffle)}
              hitSlop={{ top: 7, right: 4, bottom: 7, left: 4 }}
              accessibilityRole="button"
              accessibilityLabel={`Shuffle ${title}`}
            >
              <Ionicons name="shuffle" size={17} color={colors.accent} />
            </AppPressable>
            <AppPressable
              feedback="control"
              unstable_pressDelay={SCROLL_PRESS_DELAY}
              style={styles.randomAction}
              onPress={(event) => runAction(event, onReroll)}
              hitSlop={{ top: 7, right: 4, bottom: 7, left: 4 }}
              accessibilityRole="button"
              accessibilityLabel="Pick another random album or artist"
            >
              <Ionicons name="refresh" size={17} color={colors.textSecondary} />
            </AppPressable>
          </View>
        </View>
      </View>
    </AppPressable>
  );
}

function EmptyHomeCard({
  scanError,
  status,
  onManageFolders,
}: {
  scanError: string | null;
  status: 'initializing' | 'empty' | 'ready' | 'scanning' | 'rebuilding' | 'degraded' | 'fatalUserData';
  onManageFolders: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const fatal = status === 'fatalUserData';
  const rebuilding = status === 'rebuilding';
  const degraded = status === 'degraded';
  return (
    <View style={styles.emptyCard}>
      <Ionicons
        name={fatal || degraded ? 'warning-outline' : rebuilding ? 'construct-outline' : 'folder-open-outline'}
        size={34}
        color={fatal || degraded ? colors.warning : colors.textTertiary}
      />
      <View style={styles.emptyCopy}>
        <Text variant="heading">
          {fatal
            ? 'Library data unavailable'
            : rebuilding
              ? 'Rebuilding your library'
              : degraded
                ? 'Library temporarily unavailable'
                : 'No music yet'}
        </Text>
        <Text variant="body" color={colors.textSecondary}>
          {fatal
            ? 'Astra could not restore your playlists, favorites, and settings from either safety snapshot. Your music files were not changed.'
            : rebuilding
              ? 'The damaged catalog was quarantined. Astra is rebuilding from available folders and remote sources.'
              : degraded
                ? 'Astra cannot currently read the catalog, so it will not treat your library as empty.'
                : 'Add a local folder to fill Home with albums, history, favorites, and playlists.'}
        </Text>
        {scanError ? (
          <Text variant="caption" color={colors.warning} numberOfLines={2}>
            Scan problem: {scanError}
          </Text>
        ) : null}
      </View>
      <AppPressable
        feedback="accent" unstable_pressDelay={SCROLL_PRESS_DELAY}
        style={styles.primaryButton}
        onPress={onManageFolders}
        accessibilityRole="button"
      >
        <Ionicons name={fatal ? 'build-outline' : 'folder-open-outline'} size={18} color={colors.bgPrimary} />
        <Text variant="body" style={styles.primaryButtonText}>
          {fatal ? 'Troubleshooting' : 'Folder settings'}
        </Text>
      </AppPressable>
    </View>
  );
}

/**
 * One Home section and the space above it. Sections carry no margin of their
 * own so the same section can be stacked or seated in a band without either
 * shape double-paying for it.
 */
function HomeSection({ children }: { children: ReactNode }) {
  const styles = useStyles();
  if (!children) return null;
  return <View style={styles.section}>{children}</View>;
}

/**
 * Two Home sections of similar weight, seated side by side when the scene is
 * wide enough and stacked when it isn't.
 *
 * Collapses to a single full-width section whenever one half has nothing to
 * show — otherwise the survivor sits in half a row beside an empty column.
 */
function HomeBand({
  paired,
  stretch = false,
  primary,
  secondary,
}: {
  paired: boolean;
  /** Match the two columns to the taller one. For cards; wrong for row lists. */
  stretch?: boolean;
  primary: ReactNode;
  secondary: ReactNode;
}) {
  const styles = useStyles();
  if (!paired || !primary || !secondary) {
    return (
      <>
        <HomeSection>{primary}</HomeSection>
        <HomeSection>{secondary}</HomeSection>
      </>
    );
  }
  return (
    <View style={[styles.section, styles.band, stretch && styles.bandStretch]}>
      <View style={styles.bandColumn}>{primary}</View>
      <View style={styles.bandColumn}>{secondary}</View>
    </View>
  );
}

export default function HomeScreen() {
  const sceneBottomInset = useSceneBottomInset();
  // `<Screen bleedTop>` hands this back to the content: the scroll frame runs
  // to the top of the window so the masthead can travel behind the status bar,
  // and the content container re-pays the inset so it still starts below it.
  // Zero in a window too short to bleed, where `Screen` keeps paying it.
  const topBleed = useTopBleedInset();
  const styles = useStyles();
  const router = useRouter();
  const openLibrary = useHomeLibraryNavigation();
  const totalTrackCount = useLibraryStore((s) => s.totalTrackCount);
  const albums = useLibraryStore((s) => s.homeAlbums);
  const artists = useLibraryStore((s) => s.homeArtists);
  const includeCollabArtists = useLibraryStore((s) => s.includeCollabArtists);
  const recentlyPlayedTracks = useLibraryStore((s) => s.recentlyPlayedTracks);
  const scanError = useLibraryStore((s) => s.scanError);
  const libraryStatus = useLibraryStore((s) => s.status);
  const playlists = usePlaylistStore((s) => s.playlists);
  const favoriteTracks = usePlaylistStore((s) => s.favoriteTracks);
  const currentPath = usePlayerStore((s) => s.currentTrack?.path);
  const openQuickSearch = useSearchStore((s) => s.openQuickSearch);
  const homeGreetingTextMode = useSettingsStore((s) => s.homeGreetingTextMode);
  const artistGroupingMode = useSettingsStore((s) => s.artistGroupingMode);
  const listeningPreview = useListeningStatsStore((s) => s.homePreview);
  const loadListeningPreview = useListeningStatsStore((s) => s.loadHomePreview);

  const [spotlightOverride, setSpotlightOverride] = useState<RandomSpotlight | null>(null);
  const [randomSeeds] = useState(() => [Math.random(), Math.random()] as const);
  const [actionTrack, setActionTrack] = useState<DbTrack | null>(null);
  const scrollTop = useScrollTopGate();
  const hasLibrary = totalTrackCount > 0;
  const { height: windowHeight } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  // Stable members of the gate; the object itself is rebuilt on every `atTop` flip.
  const { offsetRef: scrollOffsetRef, setScrollAtTop } = scrollTop;

  // Re-tapping Home while already on it returns to the top, matching Library.
  const scrollHomeToTop = useCallback(() => {
    scrollRef.current?.scrollTo({
      y: 0,
      animated: shouldAnimateScrollToTop(scrollOffsetRef.current, windowHeight),
    });
    // A programmatic scroll gives the pull-to-search gate no onScroll it can
    // rely on, so arm it directly.
    setScrollAtTop(true);
  }, [scrollOffsetRef, setScrollAtTop, windowHeight]);

  useTabReselect('index', scrollHomeToTop);

  // Measured, not derived from the window: the player dock takes a column out
  // of the scene, so a tablet with the dock open has a phone's worth of content
  // width and has to lay out like one.
  const [contentWidth, setContentWidth] = useState(0);
  const measureContent = useCallback((event: LayoutChangeEvent) => {
    setContentWidth(event.nativeEvent.layout.width);
  }, []);
  const home = getHomeLayout(contentWidth);

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

  const recentTracks = recentlyPlayedTracks.slice(0, home.recentTrackCount);
  const canExpandRecentTracks = recentlyPlayedTracks.length > home.recentTrackCount;

  const openAlbum = (album: Album) => {
    openLibrary({ kind: 'album', key: album.identity_key });
  };

  const openArtist = (artist: Artist) => {
    openLibrary({ kind: 'artist', name: artist.artist });
  };

  const playRecentlyPlayed = (list: DbTrack[], index = 0) => {
    if (list.length === 0) return;
    void playLibraryQuery({ kind: 'recent' }, {
      anchorPath: list[index]?.path,
      source: { kind: 'recently-played', label: 'Recently Played' },
    });
  };

  const playSpotlight = (shuffled = false) => {
    if (!spotlightContent) return;
    const source = spotlightContent?.kind === 'album'
      ? { kind: 'album' as const, label: spotlightContent.album.album }
      : { kind: 'artist' as const, label: spotlightContent?.artist.artist ?? 'Artist' };
    const query = spotlightContent.kind === 'album'
      ? { kind: 'album' as const, albumKey: spotlightContent.album.identity_key }
      : {
          kind: 'artist' as const,
          artistKey: spotlightContent.artist.artist,
          groupingMode: artistGroupingMode,
          section: 'all' as const,
        };
    void playLibraryQuery(query, { shuffle: shuffled, source });
  };

  const rerollSpotlight = () => {
    setSpotlightOverride(chooseRandomSpotlight(albums, visibleArtists, randomSpotlight));
  };

  const openSearch = () => openQuickSearch();
  const openSignalScanner = () => router.push('/signal/scan' as never);

  useFocusEffect(
    useCallback(() => {
      void loadListeningPreview();
      const unsubscribe = subscribeToListeningHistory(() => void loadListeningPreview());
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') void loadListeningPreview();
      });
      return () => {
        unsubscribe();
        subscription.remove();
      };
    }, [loadListeningPreview]),
  );

  const spotlightCard = spotlightContent ? (
    <RandomSpotlightCard
      spotlight={spotlightContent}
      hasTracks={
        spotlightContent.kind === 'album'
          ? spotlightContent.album.track_count > 0
          : spotlightContent.artist.track_count > 0
      }
      coverSize={home.spotlightCoverSize}
      style={home.paired ? styles.bandCard : undefined}
      onOpen={() => spotlightContent.kind === 'album'
        ? openAlbum(spotlightContent.album)
        : openArtist(spotlightContent.artist)}
      onPlay={() => playSpotlight()}
      onShuffle={() => playSpotlight(true)}
      onReroll={rerollSpotlight}
    />
  ) : null;

  // Asked before rendering rather than after: the card returns null on its own
  // when there is no history, which inside a band would leave an empty column.
  const listeningCard = hasListeningPreview(listeningPreview) ? (
    <ListeningPreviewCard
      dashboard={listeningPreview}
      style={home.paired ? styles.bandCard : undefined}
      onPress={() => router.push('/stats' as never)}
    />
  ) : null;

  const recentlyPlayedSection = recentTracks.length > 0 ? (
    <>
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
            onPress={() => playRecentlyPlayed(recentTracks, index)}
            onLongPress={() => setActionTrack(track)}
            onOpenActions={() => setActionTrack(track)}
          />
        ))}
      </View>
    </>
  ) : null;

  const recentlyAddedSection = recentlyAddedAlbums.length > 0 ? (
    <>
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
            size={home.railCoverSize}
            onPress={() => openAlbum(album)}
          />
        ))}
      </ScrollView>
    </>
  ) : null;

  const playlistsSection = favoriteTracks.length > 0 || homePlaylists.length > 0 ? (
    <>
      <SectionHeader title="Favorites & Playlists" />
      <View style={styles.listBlock}>
        {favoriteTracks.length > 0 ? (
          <PlaylistRow
            name="Favorites"
            trackCount={favoriteTracks.length}
            coverHash={favoriteTracks[0]?.artwork_hash ?? null}
            pinned
            onPress={() => openLibrary({ kind: 'playlist', id: 'favorites' })}
          />
        ) : null}
        {homePlaylists.map((playlist) => (
          <PlaylistRow
            key={playlist.id}
            name={playlist.name}
            trackCount={playlist.track_count}
            missingCount={playlist.missing_track_count}
            coverHash={playlist.auto_cover_hash}
            onPress={() => openLibrary({ kind: 'playlist', id: playlist.id })}
          />
        ))}
      </View>
    </>
  ) : null;

  return (
    <Screen bleedTop>
      <PullSearchGesture atTop={scrollTop.atTop} onOpen={openSearch}>
        <PullSearchScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          overScrollMode="never"
          contentContainerStyle={{ paddingTop: topBleed, paddingBottom: sceneBottomInset }}
          onLayout={measureContent}
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
            <HomeBand
              paired={home.paired}
              primary={
                <EmptyHomeCard
                  scanError={scanError}
                  status={libraryStatus}
                  onManageFolders={() => router.push(
                    libraryStatus === 'fatalUserData' ? '/settings/troubleshooting' : '/settings'
                  )}
                />
              }
              secondary={listeningCard}
            />
          ) : home.paired ? (
            // Wide: two bands of paired sections around the one section that
            // genuinely wants the full width. Recently Added moves above
            // Recently Played here and only here — a rail is the natural break
            // between two bands, and it has nothing to pair with.
            <>
              <HomeBand paired stretch primary={spotlightCard} secondary={listeningCard} />
              <HomeSection>{recentlyAddedSection}</HomeSection>
              <HomeBand
                paired
                primary={recentlyPlayedSection}
                secondary={playlistsSection}
              />
            </>
          ) : (
            <>
              <HomeSection>{spotlightCard}</HomeSection>
              <HomeSection>{listeningCard}</HomeSection>
              <HomeSection>{recentlyPlayedSection}</HomeSection>
              <HomeSection>{recentlyAddedSection}</HomeSection>
              <HomeSection>{playlistsSection}</HomeSection>
            </>
          )}
        </PullSearchScrollView>
      </PullSearchGesture>
      <TrackActionsSheet track={actionTrack} onClose={() => setActionTrack(null)} />
    </Screen>
  );
}

const useStyles = createThemedStyles((colors) => ({
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
  section: {
    marginTop: spacing.xl,
  },
  band: {
    flexDirection: 'row',
    // Row lists end where their content ends; only cards are matched.
    alignItems: 'flex-start',
    gap: HOME_COLUMN_GAP,
  },
  bandStretch: {
    alignItems: 'stretch',
  },
  bandColumn: {
    flex: 1,
    minWidth: 0,
  },
  /** Fills the height a stretched column hands down. */
  bandCard: {
    flex: 1,
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
    // Width comes from the layout — the rail keeps the full scene width, so its
    // tiles are what grows when the scene does.
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
    // Centres the cover and meta in whatever height a stretched band hands
    // down; a no-op when the card is sizing itself.
    justifyContent: 'center',
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
