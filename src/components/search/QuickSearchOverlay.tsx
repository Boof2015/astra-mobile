import {
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
  type GestureResponderEvent
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/Text';
import { AstraLogo } from '@/components/AstraLogo';
import {
  fonts,
  fontSize,
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { SCROLL_PRESS_DELAY, useRipple } from '@/theme/ripple';
import { rgbaFromHex } from '@/theme/colorUtils';
import { enqueueTop, playTracks } from '@/audio/playbackController';
import { dbTrackToTrack } from '@/library/trackAdapter';
import {
  albumArtworkSource,
  artworkUri,
  trackArtworkThumbSource
} from '@/library/artwork';
import { multiFieldScore, MIN_SCORE_THRESHOLD } from '@/lib/fuzzySearch';
import { formatDuration } from '@/lib/format';
import { playHaptic } from '@/lib/haptics';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useSearchStore } from '@/stores/searchStore';
import type {
  Album,
  Artist,
  DbTrack
} from '@/types/library';
import type { Playlist } from '@/types/playlist';
import { SETTINGS_SEARCH_ROUTES } from '@/components/search/settingsSearchRoutes';

type IconName = keyof typeof Ionicons.glyphMap;
type RouteHref =
  | '/'
  | '/library'
  | '/eq'
  | '/settings'
  | '/settings/appearance'
  | '/settings/library'
  | '/settings/audio'
  | '/settings/playback'
  | '/settings/services'
  | '/settings/lyrics'
  | '/settings/experimental'
  | '/settings/troubleshooting'
  | '/settings/info'
  | '/sources'
  | '/lastfm';
type LibraryViewMode = 'tracks' | 'albums' | 'artists' | 'playlists' | 'folders';

const NAV_RESULT_LIMIT = 3;
const SETTINGS_RESULT_LIMIT = 4;
const TRACK_RESULT_LIMIT = 5;
const ALBUM_RESULT_LIMIT = 4;
const ARTIST_RESULT_LIMIT = 4;
const PLAYLIST_RESULT_LIMIT = 4;
const EMPTY_RECENT_TRACKS_LIMIT = 3;
const ALL_TRACK_RESULT_LIMIT = 120;
const ALL_ENTITY_RESULT_LIMIT = 80;
const QUEUED_FEEDBACK_MS = 1000;

const NAV_ENTRIES: {
  id: string;
  label: string;
  href: RouteHref;
  icon: IconName;
  keywords: string[];
  libraryViewMode?: LibraryViewMode;
}[] = [
  {
    id: 'nav:home',
    label: 'Home',
    href: '/',
    icon: 'home',
    keywords: ['home', 'dashboard', 'main'],
  },
  {
    id: 'nav:library',
    label: 'Library',
    href: '/library',
    icon: 'musical-notes',
    keywords: ['library', 'tracks', 'songs', 'browse', 'collection'],
  },
  {
    id: 'nav:library-folders',
    label: 'Browse folders',
    href: '/library',
    icon: 'folder-open-outline',
    keywords: ['folders', 'folder explorer', 'browse folders', 'library folders'],
    libraryViewMode: 'folders',
  },
  {
    id: 'nav:eq',
    label: 'Equalizer',
    href: '/eq',
    icon: 'options',
    keywords: ['eq', 'equalizer', 'bands', 'frequency', 'bass', 'treble'],
  },
  {
    id: 'nav:settings',
    label: 'Settings',
    href: '/settings',
    icon: 'settings',
    keywords: ['settings', 'preferences'],
  },
];

const SETTING_ENTRIES: {
  id: string;
  label: string;
  subtitle: string;
  href: RouteHref;
  icon: IconName;
  keywords: string[];
  libraryViewMode?: LibraryViewMode;
}[] = [
  {
    id: 'setting:appearance',
    label: 'Appearance settings',
    subtitle: 'Theme / dark style / accent',
    href: '/settings/appearance',
    icon: 'color-palette-outline',
    keywords: ['appearance', 'theme', 'dark mode', 'amoled', 'material you', 'accent', 'color'],
  },
  {
    id: 'setting:audio',
    label: 'Audio settings',
    subtitle: 'Normalization / ReplayGain',
    href: '/settings/audio',
    icon: 'volume-high',
    keywords: ['audio', 'normalization', 'replaygain', 'loudness', 'gain', 'target lufs'],
  },
  {
    id: 'setting:playback',
    label: 'Playback settings',
    subtitle: 'Sleep timer / end of track',
    href: SETTINGS_SEARCH_ROUTES.playback,
    icon: 'play-circle-outline',
    keywords: ['playback', 'sleep timer', 'timer', 'end of track', 'pause after track'],
  },
  {
    id: 'setting:library',
    label: 'Library settings',
    subtitle: 'Folders / artist grouping / albums',
    href: '/settings/library',
    icon: 'people',
    keywords: ['library', 'artist grouping', 'collaborators', 'file tags', 'singles', 'albums'],
  },
  {
    id: 'setting:folders',
    label: 'Manage folders',
    subtitle: 'Add / rescan / remove folders',
    href: '/settings/library',
    icon: 'folder-open-outline',
    keywords: ['folders', 'scan', 'rescan', 'add folder', 'remove folder', 'local files', 'storage'],
  },
  {
    id: 'setting:services',
    label: 'Services settings',
    subtitle: 'Remote sources / scrobbling',
    href: '/settings/services',
    icon: 'server-outline',
    keywords: ['services', 'integrations', 'remote sources', 'scrobbling'],
  },
  {
    id: 'setting:lyrics',
    label: 'Lyrics settings',
    subtitle: 'XLRC / furigana / translations',
    href: SETTINGS_SEARCH_ROUTES.lyrics,
    icon: 'musical-notes-outline',
    keywords: ['lyrics', 'xlrc', 'word timing', 'furigana', 'translations', 'voice labels', 'lrclib', 'xlrcdb'],
  },
  {
    id: 'setting:sources',
    label: 'Remote sources',
    subtitle: 'Subsonic / Jellyfin servers',
    href: '/settings/services',
    icon: 'server-outline',
    keywords: ['subsonic', 'jellyfin', 'server', 'streaming', 'remote'],
  },
  {
    id: 'setting:lastfm',
    label: 'Scrobbling',
    subtitle: 'Last.fm / ListenBrainz',
    href: '/settings/services',
    icon: 'radio-outline',
    keywords: ['lastfm', 'last.fm', 'listenbrainz', 'scrobble', 'audioscrobbler'],
  },
  {
    id: 'setting:experimental',
    label: 'Experimental settings',
    subtitle: 'Desktop Remote / Desktop Sync',
    href: '/settings/experimental',
    icon: 'flask-outline',
    keywords: ['experimental', 'desktop remote', 'desktop sync', 'pairing', 'phone remote'],
  },
  {
    id: 'setting:info',
    label: 'Info',
    subtitle: 'Version / attribution / license',
    href: '/settings/info',
    icon: 'information-circle-outline',
    keywords: ['info', 'about', 'version', 'license', 'attribution', 'github', 'repo', 'repository', 'discord', 'kofi', 'ko-fi', 'support', 'gpl'],
  },
  {
    id: 'setting:troubleshooting',
    label: 'Troubleshooting',
    subtitle: 'Rescan / rebuild / clear caches',
    href: SETTINGS_SEARCH_ROUTES.troubleshooting,
    icon: 'build-outline',
    keywords: ['troubleshooting', 'support', 'rescan', 'rebuild index', 'clear lyrics cache', 'clear waveform cache', 'onboarding'],
  },
];

const EMPTY_SHORTCUT_IDS = ['nav:library', 'nav:eq', 'setting:sources', 'setting:lastfm'];

interface ResultGroup {
  id: string;
  label: string;
  results: SearchResult[];
}

interface SearchBaseResult {
  id: string;
  score: number;
}

interface TrackResult extends SearchBaseResult {
  kind: 'track';
  track: DbTrack;
}

interface AlbumResult extends SearchBaseResult {
  kind: 'album';
  album: Album;
}

interface ArtistResult extends SearchBaseResult {
  kind: 'artist';
  artist: Artist;
}

interface SearchPlaylist {
  id: number | 'favorites';
  name: string;
  trackCount: number;
  coverHash: string | null;
  pinned?: boolean;
  remote?: boolean;
}

interface PlaylistResult extends SearchBaseResult {
  kind: 'playlist';
  playlist: SearchPlaylist;
}

interface NavResult extends SearchBaseResult {
  kind: 'nav';
  label: string;
  subtitle: string;
  href: RouteHref;
  icon: IconName;
  libraryViewMode?: LibraryViewMode;
}

interface SettingResult extends SearchBaseResult {
  kind: 'setting';
  label: string;
  subtitle: string;
  href: RouteHref;
  icon: IconName;
  libraryViewMode?: LibraryViewMode;
}

interface ShowAllResult {
  kind: 'show-all';
  id: 'show-all-library';
  query: string;
  total: number;
}

interface ShowTopResult {
  kind: 'show-top';
  id: 'show-top-results';
}

type SearchResult =
  | TrackResult
  | AlbumResult
  | ArtistResult
  | PlaylistResult
  | NavResult
  | SettingResult
  | ShowAllResult
  | ShowTopResult;

type SearchListItem =
  | { type: 'header'; key: string; label: string }
  | { type: 'result'; key: string; result: SearchResult };

function compareScoredResults<T extends { score: number; id: string }>(a: T, b: T): number {
  if (a.score !== b.score) return b.score - a.score;
  return a.id.localeCompare(b.id);
}

function plural(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

function scoreOrNull(score: number | null): score is number {
  return score !== null && score >= MIN_SCORE_THRESHOLD;
}

function playlistFromRow(playlist: Playlist): SearchPlaylist {
  return {
    id: playlist.id,
    name: playlist.name,
    trackCount: playlist.track_count,
    coverHash: playlist.auto_cover_hash,
    remote: playlist.remote_source_id != null,
  };
}

function resultLabel(result: SearchResult): string {
  switch (result.kind) {
    case 'track':
      return result.track.title;
    case 'album':
      return result.album.album;
    case 'artist':
      return result.artist.artist;
    case 'playlist':
      return result.playlist.name;
    case 'nav':
    case 'setting':
      return result.label;
    case 'show-all':
      return 'Show all library matches';
    case 'show-top':
      return 'Back to top matches';
  }
}

function resultSubtitle(result: SearchResult): string {
  switch (result.kind) {
    case 'track':
      return [result.track.artist, result.track.album, formatDuration(result.track.duration)]
        .filter(Boolean)
        .join(' / ');
    case 'album':
      return [`by ${result.album.artist}`, plural(result.album.track_count, 'track')]
        .filter(Boolean)
        .join(' / ');
    case 'artist':
      return plural(result.artist.track_count, 'track');
    case 'playlist':
      return result.playlist.pinned
        ? plural(result.playlist.trackCount, 'favorite')
        : plural(result.playlist.trackCount, 'track');
    case 'nav':
    case 'setting':
      return result.subtitle;
    case 'show-all':
      return `${plural(result.total, 'match')} for "${result.query}"`;
    case 'show-top':
      return 'Navigation and settings shortcuts return';
  }
}

function resultIcon(result: SearchResult): IconName {
  switch (result.kind) {
    case 'track':
      return 'musical-note';
    case 'album':
      return 'disc-outline';
    case 'artist':
      return 'person';
    case 'playlist':
      return result.playlist.pinned ? 'heart' : 'musical-notes-outline';
    case 'nav':
    case 'setting':
      return result.icon;
    case 'show-all':
      return 'list';
    case 'show-top':
      return 'arrow-up';
  }
}

function HighlightedLabel({ text, query }: { text: string; query: string }) {
  const styles = useStyles();
  const normalizedText = text.toLocaleLowerCase();
  const normalizedQuery = query.toLocaleLowerCase().trim();

  if (!normalizedQuery) {
    return <>{text}</>;
  }

  const substringIndex = normalizedText.indexOf(normalizedQuery);
  if (substringIndex >= 0) {
    return (
      <>
        {text.slice(0, substringIndex)}
        <Text variant="body" style={styles.highlight}>
          {text.slice(substringIndex, substringIndex + normalizedQuery.length)}
        </Text>
        {text.slice(substringIndex + normalizedQuery.length)}
      </>
    );
  }

  const parts: { text: string; highlighted: boolean; key: string }[] = [];
  let queryIndex = 0;
  let lastPushed = 0;

  for (let i = 0; i < text.length && queryIndex < normalizedQuery.length; i += 1) {
    if (text[i].toLocaleLowerCase() !== normalizedQuery[queryIndex]) continue;
    if (i > lastPushed) {
      parts.push({ text: text.slice(lastPushed, i), highlighted: false, key: `plain-${i}` });
    }
    parts.push({ text: text[i], highlighted: true, key: `mark-${i}` });
    queryIndex += 1;
    lastPushed = i + 1;
  }

  if (lastPushed < text.length) {
    parts.push({ text: text.slice(lastPushed), highlighted: false, key: 'tail' });
  }

  return (
    <>
      {parts.map((part) =>
        part.highlighted ? (
          <Text key={part.key} variant="body" style={styles.highlight}>
            {part.text}
          </Text>
        ) : (
          part.text
        )
      )}
    </>
  );
}

function ResultThumb({ result }: { result: SearchResult }) {
  const styles = useStyles();
  const colors = useColors();
  const uri =
    result.kind === 'track'
      ? trackArtworkThumbSource(result.track)
      : result.kind === 'album'
        ? albumArtworkSource(result.album)
        : result.kind === 'artist' && result.artist.artwork_hash
          ? artworkUri(result.artist.artwork_hash)
          : result.kind === 'playlist' && result.playlist.coverHash
            ? artworkUri(result.playlist.coverHash)
            : null;

  const icon = resultIcon(result);
  const round = result.kind === 'artist';
  const accented = result.kind === 'playlist' && result.playlist.pinned;

  return (
    <View style={[styles.thumb, round && styles.thumbRound]}>
      {uri ? (
        <Image source={{ uri }} style={styles.thumbImage} contentFit="cover" cachePolicy="memory-disk" />
      ) : result.kind === 'track' ? (
        <AstraLogo size={18} />
      ) : (
        <Ionicons name={icon} size={20} color={accented ? colors.accent : colors.textTertiary} />
      )}
    </View>
  );
}

function ResultRow({
  result,
  query,
  active,
  queued,
  onPress,
  onQueueTrack,
}: {
  result: SearchResult;
  query: string;
  active: boolean;
  queued: boolean;
  onPress: () => void;
  onQueueTrack: (track: DbTrack) => void;
}) {
  const styles = useStyles();
  const ripple = useRipple();
  const colors = useColors();
  const isTrack = result.kind === 'track';
  const isShowMode = result.kind === 'show-all' || result.kind === 'show-top';

  const queueTrack = (event: GestureResponderEvent) => {
    event.stopPropagation();
    if (result.kind !== 'track') return;
    onQueueTrack(result.track);
  };

  return (
    <Pressable android_ripple={ripple.bounded} unstable_pressDelay={SCROLL_PRESS_DELAY}
      style={[styles.resultRow, active && styles.resultRowActive, isShowMode && styles.showModeRow]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <ResultThumb result={result} />
      <View style={styles.resultText}>
        <Text variant="body" numberOfLines={1} style={[styles.resultLabel, active && styles.activeLabel]}>
          <HighlightedLabel text={resultLabel(result)} query={query} />
        </Text>
        <Text variant="label" numberOfLines={1} style={styles.resultSubtitle}>
          {resultSubtitle(result)}
        </Text>
      </View>
      {isTrack ? (
        <Pressable android_ripple={ripple.bounded} unstable_pressDelay={SCROLL_PRESS_DELAY}
          style={styles.queueButton}
          onPress={queueTrack}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Play ${result.track.title} next`}
        >
          <Ionicons name={queued ? 'checkmark' : 'add'} size={18} color={colors.accentTextStrong} />
        </Pressable>
      ) : result.kind === 'playlist' && result.playlist.remote ? (
        <Ionicons name="cloud" size={14} color={colors.accent} />
      ) : (
        <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
      )}
    </Pressable>
  );
}

function QuickSearchPanel({
  initialQuery,
  onClose,
}: {
  initialQuery: string;
  onClose: () => void;
}) {
  const styles = useStyles();
  const ripple = useRipple();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const inputRef = useRef<TextInput | null>(null);

  const tracks = useLibraryStore((s) => s.tracks);
  const albums = useLibraryStore((s) => s.albums);
  const artists = useLibraryStore((s) => s.artists);
  const recentlyPlayedTracks = useLibraryStore((s) => s.recentlyPlayedTracks);
  const setViewMode = useLibraryStore((s) => s.setViewMode);

  const playlists = usePlaylistStore((s) => s.playlists);
  const favoriteTracks = usePlaylistStore((s) => s.favoriteTracks);
  const currentPath = usePlayerStore((s) => s.currentTrack?.path);

  const [query, setQuery] = useState(initialQuery);
  const [showAllLibrary, setShowAllLibrary] = useState(false);
  const [queuedTrackPaths, setQueuedTrackPaths] = useState<Set<string>>(() => new Set());
  const queuedFeedbackTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, []);

  useEffect(
    () => () => {
      queuedFeedbackTimers.current.forEach(clearTimeout);
      queuedFeedbackTimers.current.clear();
    },
    []
  );

  const updateQuery = (value: string) => {
    setQuery(value);
    setShowAllLibrary(false);
  };

  const navResults = useMemo(() => {
    if (!hasQuery || showAllLibrary) return [] as NavResult[];
    const results: NavResult[] = [];
    for (const entry of NAV_ENTRIES) {
      const score = multiFieldScore(trimmedQuery, [
        { value: entry.label, weight: 1.5 },
        { value: entry.keywords.join(' '), weight: 1 },
      ]);
      if (!scoreOrNull(score)) continue;
      results.push({
        kind: 'nav' as const,
        id: entry.id,
        score,
        label: entry.label,
        subtitle: 'Navigate',
        href: entry.href,
        icon: entry.icon,
        libraryViewMode: entry.libraryViewMode,
      });
    }
    return results.sort(compareScoredResults).slice(0, NAV_RESULT_LIMIT);
  }, [hasQuery, showAllLibrary, trimmedQuery]);

  const settingResults = useMemo(() => {
    if (!hasQuery || showAllLibrary) return [] as SettingResult[];
    const results: SettingResult[] = [];
    for (const entry of SETTING_ENTRIES) {
      const score = multiFieldScore(trimmedQuery, [
        { value: entry.label, weight: 1.4 },
        { value: entry.subtitle, weight: 1.1 },
        { value: entry.keywords.join(' '), weight: 1 },
      ]);
      if (!scoreOrNull(score)) continue;
      results.push({
        kind: 'setting' as const,
        id: entry.id,
        score,
        label: entry.label,
        subtitle: entry.subtitle,
        href: entry.href,
        icon: entry.icon,
        libraryViewMode: entry.libraryViewMode,
      });
    }
    return results.sort(compareScoredResults).slice(0, SETTINGS_RESULT_LIMIT);
  }, [hasQuery, showAllLibrary, trimmedQuery]);

  const allTrackResults = useMemo(() => {
    if (!hasQuery) return [] as TrackResult[];
    return tracks
      .map((track) => {
        const score = multiFieldScore(trimmedQuery, [
          { value: track.title, weight: 1.5 },
          { value: track.artist, weight: 1.2 },
          { value: track.album_artist, weight: 1 },
          { value: track.album, weight: 1 },
          { value: track.file_name, weight: 0.8 },
          { value: track.genre, weight: 0.5 },
        ]);
        if (!scoreOrNull(score)) return null;
        return {
          kind: 'track' as const,
          id: `track:${track.id}`,
          score,
          track,
        };
      })
      .filter((result): result is TrackResult => result !== null)
      .sort(compareScoredResults);
  }, [hasQuery, tracks, trimmedQuery]);

  const allAlbumResults = useMemo(() => {
    if (!hasQuery) return [] as AlbumResult[];
    return albums
      .map((album) => {
        const score = multiFieldScore(trimmedQuery, [
          { value: album.album, weight: 1.4 },
          { value: album.artist, weight: 1.1 },
          { value: album.year == null ? null : String(album.year), weight: 0.4 },
        ]);
        if (!scoreOrNull(score)) return null;
        return {
          kind: 'album' as const,
          id: `album:${album.identity_key}`,
          score,
          album,
        };
      })
      .filter((result): result is AlbumResult => result !== null)
      .sort(compareScoredResults);
  }, [albums, hasQuery, trimmedQuery]);

  const allArtistResults = useMemo(() => {
    if (!hasQuery) return [] as ArtistResult[];
    return artists
      .map((artist) => {
        const score = multiFieldScore(trimmedQuery, [{ value: artist.artist, weight: 1.5 }]);
        if (!scoreOrNull(score)) return null;
        return {
          kind: 'artist' as const,
          id: `artist:${artist.artist}`,
          score,
          artist,
        };
      })
      .filter((result): result is ArtistResult => result !== null)
      .sort(compareScoredResults);
  }, [artists, hasQuery, trimmedQuery]);

  const allPlaylistResults = useMemo(() => {
    if (!hasQuery) return [] as PlaylistResult[];
    const candidates: SearchPlaylist[] = [
      {
        id: 'favorites',
        name: 'Favorites',
        trackCount: favoriteTracks.length,
        coverHash: null,
        pinned: true,
      },
      ...playlists.map(playlistFromRow),
    ];
    return candidates
      .map((playlist) => {
      const score = multiFieldScore(trimmedQuery, [
        { value: playlist.name, weight: 1.5 },
      ]);
        if (!scoreOrNull(score)) return null;
        return {
          kind: 'playlist' as const,
          id: `playlist:${playlist.id}`,
          score,
          playlist,
        };
      })
      .filter((result): result is PlaylistResult => result !== null)
      .sort(compareScoredResults);
  }, [favoriteTracks.length, hasQuery, playlists, trimmedQuery]);

  const trackResults = showAllLibrary
    ? allTrackResults.slice(0, ALL_TRACK_RESULT_LIMIT)
    : allTrackResults.slice(0, TRACK_RESULT_LIMIT);
  const albumResults = showAllLibrary
    ? allAlbumResults.slice(0, ALL_ENTITY_RESULT_LIMIT)
    : allAlbumResults.slice(0, ALBUM_RESULT_LIMIT);
  const artistResults = showAllLibrary
    ? allArtistResults.slice(0, ALL_ENTITY_RESULT_LIMIT)
    : allArtistResults.slice(0, ARTIST_RESULT_LIMIT);
  const playlistResults = showAllLibrary
    ? allPlaylistResults.slice(0, ALL_ENTITY_RESULT_LIMIT)
    : allPlaylistResults.slice(0, PLAYLIST_RESULT_LIMIT);

  const recentTrackResults = useMemo(() => {
    if (hasQuery) return [] as TrackResult[];
    return recentlyPlayedTracks.slice(0, EMPTY_RECENT_TRACKS_LIMIT).map((track) => ({
      kind: 'track' as const,
      id: `recent:${track.id}`,
      score: 0,
      track,
    }));
  }, [hasQuery, recentlyPlayedTracks]);

  const quickShortcutResults = useMemo(() => {
    if (hasQuery) return [] as (NavResult | SettingResult)[];

    const results: (NavResult | SettingResult)[] = [];
    for (const id of EMPTY_SHORTCUT_IDS) {
      const nav = NAV_ENTRIES.find((entry) => entry.id === id);
      if (nav) {
        results.push({
          kind: 'nav' as const,
          id: nav.id,
          score: 0,
          label: nav.label,
          subtitle: 'Navigate',
          href: nav.href,
          icon: nav.icon,
          libraryViewMode: nav.libraryViewMode,
        });
        continue;
      }
      const setting = SETTING_ENTRIES.find((entry) => entry.id === id);
      if (!setting) continue;
      results.push({
        kind: 'setting' as const,
        id: setting.id,
        score: 0,
        label: setting.label,
        subtitle: setting.subtitle,
        href: setting.href,
        icon: setting.icon,
        libraryViewMode: setting.libraryViewMode,
      });
    }
    return results;
  }, [hasQuery]);

  const libraryMatchTotal =
    allTrackResults.length + allAlbumResults.length + allArtistResults.length + allPlaylistResults.length;
  const visibleLibraryTotal =
    trackResults.length + albumResults.length + artistResults.length + playlistResults.length;
  const showAllResult = useMemo<ShowAllResult | null>(
    () =>
      hasQuery && !showAllLibrary && libraryMatchTotal > visibleLibraryTotal
        ? {
            kind: 'show-all',
            id: 'show-all-library',
            query: trimmedQuery,
            total: libraryMatchTotal,
          }
        : null,
    [hasQuery, libraryMatchTotal, showAllLibrary, trimmedQuery, visibleLibraryTotal]
  );

  const resultGroups = useMemo<ResultGroup[]>(() => {
    if (!hasQuery) {
      const groups: ResultGroup[] = [];
      if (recentTrackResults.length > 0) {
        groups.push({ id: 'recent', label: 'Recently Played', results: recentTrackResults });
      }
      groups.push({ id: 'shortcuts', label: 'Shortcuts', results: quickShortcutResults });
      return groups;
    }

    if (showAllLibrary) {
      const groups: ResultGroup[] = [];
      if (trackResults.length > 0) groups.push({ id: 'tracks', label: 'Tracks', results: trackResults });
      if (albumResults.length > 0) groups.push({ id: 'albums', label: 'Albums', results: albumResults });
      if (artistResults.length > 0) groups.push({ id: 'artists', label: 'Artists', results: artistResults });
      if (playlistResults.length > 0) {
        groups.push({ id: 'playlists', label: 'Playlists', results: playlistResults });
      }
      return groups;
    }

    const pinned: ResultGroup[] = [];
    if (navResults.length > 0) {
      pinned.push({ id: 'nav', label: 'Go To', results: navResults });
    }

    const scoredGroups: { group: ResultGroup; topScore: number }[] = [];
    if (trackResults.length > 0) {
      scoredGroups.push({
        group: { id: 'tracks', label: 'Tracks', results: trackResults },
        topScore: trackResults[0].score,
      });
    }
    if (albumResults.length > 0) {
      scoredGroups.push({
        group: { id: 'albums', label: 'Albums', results: albumResults },
        topScore: albumResults[0].score,
      });
    }
    if (artistResults.length > 0) {
      scoredGroups.push({
        group: { id: 'artists', label: 'Artists', results: artistResults },
        topScore: artistResults[0].score,
      });
    }
    if (playlistResults.length > 0) {
      scoredGroups.push({
        group: { id: 'playlists', label: 'Playlists', results: playlistResults },
        topScore: playlistResults[0].score,
      });
    }
    if (settingResults.length > 0) {
      scoredGroups.push({
        group: { id: 'settings', label: 'Settings', results: settingResults },
        topScore: settingResults[0].score,
      });
    }

    scoredGroups.sort((a, b) => b.topScore - a.topScore);
    return [...pinned, ...scoredGroups.map((entry) => entry.group)];
  }, [
    albumResults,
    artistResults,
    hasQuery,
    navResults,
    playlistResults,
    quickShortcutResults,
    recentTrackResults,
    settingResults,
    showAllLibrary,
    trackResults,
  ]);

  const listItems = useMemo<SearchListItem[]>(() => {
    const items: SearchListItem[] = [];
    for (const group of resultGroups) {
      items.push({ type: 'header', key: `header:${group.id}`, label: group.label });
      for (const result of group.results) {
        items.push({ type: 'result', key: result.id, result });
      }
    }
    if (showAllResult) {
      items.push({ type: 'result', key: showAllResult.id, result: showAllResult });
    } else if (showAllLibrary) {
      items.push({ type: 'result', key: 'show-top-results', result: { kind: 'show-top', id: 'show-top-results' } });
    }
    return items;
  }, [resultGroups, showAllLibrary, showAllResult]);

  const firstActionableResult = listItems.find((item) => item.type === 'result')?.result ?? null;

  const close = () => {
    Keyboard.dismiss();
    onClose();
  };

  const navigateTo = (href: RouteHref) => {
    router.push(href as never);
  };

  const executeResult = (result: SearchResult) => {
    if (result.kind === 'show-all') {
      setShowAllLibrary(true);
      return;
    }
    if (result.kind === 'show-top') {
      setShowAllLibrary(false);
      return;
    }

    close();

    if (result.kind === 'track') {
      const context = hasQuery ? allTrackResults.map((entry) => entry.track) : recentTrackResults.map((entry) => entry.track);
      const index = Math.max(
        0,
        context.findIndex((track) => track.path === result.track.path)
      );
      void playTracks(context.map(dbTrackToTrack), {
        startIndex: index,
        source: hasQuery
          ? { kind: 'search', label: `Search: ${trimmedQuery}` }
          : { kind: 'recently-played', label: 'Recently Played' },
      });
      return;
    }

    if (result.kind === 'album') {
      router.push({
        pathname: '/library/album/[key]',
        params: { key: result.album.identity_key },
      });
      return;
    }

    if (result.kind === 'artist') {
      router.push({
        pathname: '/library/artist/[name]',
        params: { name: result.artist.artist },
      });
      return;
    }

    if (result.kind === 'playlist') {
      router.push({
        pathname: '/library/playlist/[id]',
        params: { id: result.playlist.id },
      });
      return;
    }

    if (result.libraryViewMode) {
      setViewMode(result.libraryViewMode);
    }
    navigateTo(result.href);
  };

  const queueTrack = (track: DbTrack) => {
    playHaptic('confirm');
    const existingTimer = queuedFeedbackTimers.current.get(track.path);
    if (existingTimer) clearTimeout(existingTimer);

    setQueuedTrackPaths((current) => {
      if (current.has(track.path)) return current;
      const next = new Set(current);
      next.add(track.path);
      return next;
    });

    const feedbackTimer = setTimeout(() => {
      queuedFeedbackTimers.current.delete(track.path);
      setQueuedTrackPaths((current) => {
        if (!current.has(track.path)) return current;
        const next = new Set(current);
        next.delete(track.path);
        return next;
      });
    }, QUEUED_FEEDBACK_MS);
    queuedFeedbackTimers.current.set(track.path, feedbackTimer);

    void enqueueTop(dbTrackToTrack(track));
  };

  const submitFirstResult = () => {
    if (firstActionableResult) executeResult(firstActionableResult);
  };

  const panelMaxHeight = Math.max(320, height - insets.top - insets.bottom - spacing.xxl * 2);
  const emptyText = hasQuery
    ? showAllLibrary
      ? `No library results for "${trimmedQuery}"`
      : `No results for "${trimmedQuery}"`
    : 'Type to search tracks, albums, artists, playlists, and settings';

  return (
    <View
      style={[
        styles.panel,
        {
          marginTop: insets.top + spacing.lg,
          marginBottom: insets.bottom + spacing.lg,
          height: panelMaxHeight,
        },
      ]}
    >
      <View style={styles.inputWrap}>
        <Ionicons name="search" size={20} color={colors.textTertiary} />
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={updateQuery}
          onSubmitEditing={submitFirstResult}
          placeholder="Search tracks, albums, artists, playlists, settings"
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.accent}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={styles.input}
        />
        {query.length > 0 ? (
          <Pressable android_ripple={ripple.bounded} unstable_pressDelay={SCROLL_PRESS_DELAY}
            onPress={() => updateQuery('')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
          </Pressable>
        ) : null}
        <Pressable android_ripple={ripple.bounded} unstable_pressDelay={SCROLL_PRESS_DELAY} onPress={close} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close search">
          <Ionicons name="close" size={20} color={colors.textSecondary} />
        </Pressable>
      </View>

      {showAllLibrary ? (
        <View style={styles.modeBanner}>
          <Text variant="caption" numberOfLines={1}>
            {`All library matches for "${trimmedQuery}"`}
          </Text>
        </View>
      ) : null}

      {listItems.length === 0 ? (
        <View style={styles.empty}>
          <Text variant="caption" style={styles.emptyText}>
            {emptyText}
          </Text>
        </View>
      ) : (
        <FlashList
          style={styles.resultsList}
          data={listItems}
          keyExtractor={(item) => item.key}
          getItemType={(item) => item.type}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.resultsContent}
          renderItem={({ item }) =>
            item.type === 'header' ? (
              <Text variant="mono" style={styles.groupLabel}>
                {item.label.toUpperCase()}
              </Text>
            ) : (
              <ResultRow
                result={item.result}
                query={trimmedQuery}
                active={item.result.kind === 'track' && item.result.track.path === currentPath}
                queued={item.result.kind === 'track' && queuedTrackPaths.has(item.result.track.path)}
                onPress={() => executeResult(item.result)}
                onQueueTrack={queueTrack}
              />
            )
          }
        />
      )}
    </View>
  );
}

export function QuickSearchOverlay() {
  const styles = useStyles();
  const ripple = useRipple();
  const isOpen = useSearchStore((s) => s.isQuickSearchOpen);
  const initialQuery = useSearchStore((s) => s.initialQuery);
  const openVersion = useSearchStore((s) => s.openVersion);
  const closeQuickSearch = useSearchStore((s) => s.closeQuickSearch);

  const close = () => {
    Keyboard.dismiss();
    closeQuickSearch();
  };

  return (
    <Modal
      visible={isOpen}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={close}
    >
      <View style={styles.modalRoot}>
        <Pressable android_ripple={ripple.bounded} unstable_pressDelay={SCROLL_PRESS_DELAY} style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" />
        {isOpen ? (
          <QuickSearchPanel key={openVersion} initialQuery={initialQuery} onClose={close} />
        ) : null}
      </View>
    </Modal>
  );
}

const useStyles = createThemedStyles((colors) => ({
  modalRoot: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.backdrop,
    paddingHorizontal: spacing.md,
  },
  panel: {
    width: '100%',
    maxWidth: 720,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.bgSecondary,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 18 },
    elevation: 20,
  },
  resultsList: {
    flex: 1,
  },
  inputWrap: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomColor: colors.glassBorder,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minWidth: 0,
    fontFamily: fonts.sans.regular,
    fontSize: fontSize.base,
    color: colors.textPrimary,
    paddingVertical: spacing.md,
  },
  modeBanner: {
    borderBottomColor: colors.glassBorder,
    borderBottomWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.glassBg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  resultsContent: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  groupLabel: {
    color: colors.textTertiary,
    fontSize: 10,
    letterSpacing: 0,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  resultRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  resultRowActive: {
    backgroundColor: rgbaFromHex(colors.accent, 0.12),
  },
  showModeRow: {
    marginTop: spacing.sm,
    borderTopColor: colors.glassBorder,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  thumb: {
    width: 42,
    height: 42,
    flexShrink: 0,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbRound: {
    borderRadius: radius.pill,
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  resultText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  resultLabel: {
    fontSize: 15,
  },
  activeLabel: {
    color: colors.accentTextStrong,
  },
  resultSubtitle: {
    color: colors.textSecondary,
  },
  highlight: {
    color: colors.accentTextStrong,
    backgroundColor: rgbaFromHex(colors.accent, 0.22),
    borderRadius: 2,
  },
  queueButton: {
    width: 32,
    height: 32,
    flexShrink: 0,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassHighlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    flex: 1,
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyText: {
    textAlign: 'center',
  },
}));
