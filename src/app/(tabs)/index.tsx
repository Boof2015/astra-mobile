import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { AstraLogo } from '@/components/AstraLogo';
import { SpectrumCurve } from '@/components/SpectrumCurve';
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
import { rgbaFromHex } from '@/theme/colorUtils';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useSearchStore } from '@/stores/searchStore';
import {
  playTracks,
  shuffleTracks,
  skipToNext,
  skipToPrevious,
  togglePlay
} from '@/audio/playbackController';
import { compareTracksByDiscTrackTitle } from '@/library/albumIdentity';
import { dbTrackToTrack } from '@/library/trackAdapter';
import { albumArtworkSource } from '@/library/artwork';
import { formatDuration } from '@/lib/format';
import { useScopeActive } from '@/scope/scopeStore';
import type { PlaybackState, Track } from '@/types/audio';
import type { Album, DbTrack } from '@/types/library';

const RECENT_ALBUM_LIMIT = 8;
const RECENT_TRACK_LIMIT = 3;
const PLAYLIST_LIMIT = 4;
const PLAYER_CARD_MIN_HEIGHT = 174;
const CURVE_POINTS = 64;

function chooseRandomAlbum(albums: Album[], currentKey?: string | null): string | null {
  if (albums.length === 0) return null;
  if (albums.length === 1) return albums[0].identity_key;

  let next: string | null = currentKey ?? null;
  while (next === currentKey) {
    next = albums[Math.floor(Math.random() * albums.length)].identity_key;
  }
  return next;
}

function albumMeta(album: Album, tracks: DbTrack[]): string {
  const duration = tracks.reduce((sum, track) => sum + track.duration, 0);
  return [
    album.year ? String(album.year) : null,
    `${album.track_count} ${album.track_count === 1 ? 'track' : 'tracks'}`,
    formatDuration(duration),
  ]
    .filter(Boolean)
    .join(' / ');
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
        <Pressable style={styles.seeAllButton} onPress={onActionPress} accessibilityRole="button">
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

function NowPlayingCard({
  track,
  playbackState,
  currentTime,
  duration,
  onOpen,
}: {
  track: Track;
  playbackState: PlaybackState;
  currentTime: number;
  duration: number;
  onOpen: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const isPlaying = playbackState === 'playing';
  const isLoading = playbackState === 'loading';
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const scopeActive = useScopeActive();
  const [cardSize, setCardSize] = useState({ width: 0, height: PLAYER_CARD_MIN_HEIGHT });

  const onCardLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setCardSize((prev) =>
      prev.width === width && prev.height === height ? prev : { width, height }
    );
  };

  return (
    <View style={styles.playerCard} onLayout={onCardLayout}>
      {scopeActive && cardSize.width > 0 ? (
        <View pointerEvents="none" style={styles.playerSpectrum}>
          <SpectrumCurve
            active={scopeActive}
            pointCount={CURVE_POINTS}
            analysisFrameMs={0}
            dbMin={-84}
            dbMax={-20}
            width={cardSize.width}
            height={cardSize.height}
            lineWidth={1.4}
            lineOpacity={0.38}
            fillOpacity={0.28}
            glow
            glowOpacity={0.07}
          />
        </View>
      ) : null}
      {scopeActive && cardSize.width > 0 ? (
        <View pointerEvents="none" style={styles.playerSpectrumVeil} />
      ) : null}
      <Pressable style={styles.playerArt} onPress={onOpen} accessibilityRole="button">
        {track.artworkData ? (
          <Image source={{ uri: track.artworkData }} style={styles.image} contentFit="cover" />
        ) : (
          <AstraLogo size={42} />
        )}
      </Pressable>
      <View style={styles.playerMeta}>
        <Text variant="label" color={colors.textTertiary}>
          NOW PLAYING
        </Text>
        <Text variant="heading" numberOfLines={1}>
          {track.title}
        </Text>
        <Text variant="body" color={colors.textSecondary} numberOfLines={1}>
          {track.album ? `${track.artist} / ${track.album}` : track.artist}
        </Text>
        <View style={styles.seekTrack}>
          <View style={[styles.seekFill, { width: `${progress * 100}%` }]} />
        </View>
        <View style={styles.placeholderControls}>
          <Pressable hitSlop={10} onPress={() => void skipToPrevious()}>
            <Ionicons name="play-skip-back" size={22} color={colors.textSecondary} />
          </Pressable>
          <Pressable hitSlop={10} onPress={() => void togglePlay()} style={styles.playCircle}>
            <Ionicons
              name={isLoading ? 'ellipsis-horizontal' : isPlaying ? 'pause' : 'play'}
              size={18}
              color={colors.bgPrimary}
            />
          </Pressable>
          <Pressable hitSlop={10} onPress={() => void skipToNext()}>
            <Ionicons name="play-skip-forward" size={22} color={colors.textSecondary} />
          </Pressable>
          <Pressable hitSlop={10} onPress={onOpen}>
            <Ionicons name="expand-outline" size={21} color={colors.textTertiary} />
          </Pressable>
        </View>
      </View>
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
  return (
    <Pressable style={styles.recentAlbum} onPress={onPress} accessibilityRole="button">
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

function RandomAlbumCard({
  album,
  tracks,
  onPlay,
  onShuffle,
  onReroll,
  onOpen,
}: {
  album: Album;
  tracks: DbTrack[];
  onPlay: () => void;
  onShuffle: () => void;
  onReroll: () => void;
  onOpen: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const disabled = tracks.length === 0;

  return (
    <View style={styles.randomCard}>
      <Pressable style={styles.randomMain} onPress={onOpen} accessibilityRole="button">
        <AlbumCover album={album} size={96} />
        <View style={styles.randomMeta}>
          <Text variant="label" color={colors.textTertiary}>
            RANDOM ALBUM
          </Text>
          <Text variant="heading" numberOfLines={2}>
            {album.album}
          </Text>
          <Text variant="body" color={colors.textSecondary} numberOfLines={1}>
            {album.artist}
          </Text>
          <Text variant="label" numberOfLines={1}>
            {albumMeta(album, tracks)}
          </Text>
        </View>
        <Pressable
          style={styles.reroll}
          onPress={onReroll}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Pick another random album"
        >
          <Ionicons name="shuffle" size={19} color={colors.textSecondary} />
        </Pressable>
      </Pressable>

      <View style={styles.randomActions}>
        <Pressable
          style={[styles.primaryButton, disabled && styles.buttonDisabled]}
          disabled={disabled}
          onPress={onPlay}
          accessibilityRole="button"
        >
          <Ionicons name="play" size={16} color={colors.bgPrimary} />
          <Text variant="body" style={styles.primaryButtonText}>
            Play
          </Text>
        </Pressable>
        <Pressable
          style={[styles.secondaryButton, disabled && styles.buttonDisabled]}
          disabled={disabled}
          onPress={onShuffle}
          accessibilityRole="button"
        >
          <Ionicons name="shuffle" size={16} color={colors.accent} />
          <Text variant="body" color={colors.accent}>
            Shuffle
          </Text>
        </Pressable>
      </View>
    </View>
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
  const colors = useColors();
  const router = useRouter();
  const tracks = useLibraryStore((s) => s.tracks);
  const albums = useLibraryStore((s) => s.albums);
  const recentlyPlayedTracks = useLibraryStore((s) => s.recentlyPlayedTracks);
  const scanError = useLibraryStore((s) => s.scanError);
  const playlists = usePlaylistStore((s) => s.playlists);
  const favoriteTracks = usePlaylistStore((s) => s.favoriteTracks);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const currentPath = currentTrack?.path;
  const playbackState = usePlayerStore((s) => s.playbackState);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const openQuickSearch = useSearchStore((s) => s.openQuickSearch);

  const [randomAlbumKey, setRandomAlbumKey] = useState<string | null>(null);
  const [randomSeed] = useState(() => Math.random());
  const [actionTrack, setActionTrack] = useState<DbTrack | null>(null);
  const scrollTop = useScrollTopGate();
  const hasLibrary = tracks.length > 0;

  const recentlyAddedAlbums = useMemo(
    () => [...albums].sort((a, b) => b.latest_added_at - a.latest_added_at).slice(0, RECENT_ALBUM_LIMIT),
    [albums]
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

  const randomAlbum = useMemo(() => {
    if (!albums.length) return null;
    const selected = randomAlbumKey
      ? albums.find((album) => album.identity_key === randomAlbumKey)
      : null;
    if (selected) return selected;
    return albums[Math.floor(randomSeed * albums.length) % albums.length];
  }, [albums, randomAlbumKey, randomSeed]);
  const randomAlbumNeedsTracks = hasLibrary && !currentTrack && randomAlbum != null;
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
  const recentTracks = recentlyPlayedTracks.slice(0, RECENT_TRACK_LIMIT);
  const canExpandRecentTracks = recentlyPlayedTracks.length > RECENT_TRACK_LIMIT;

  const openAlbum = (album: Album) => {
    router.push({
      pathname: '/library/album/[key]',
      params: { key: album.identity_key, from: 'home' },
    });
  };

  const playTrackList = (list: DbTrack[], index = 0) => {
    if (list.length === 0) return;
    void playTracks(list.map(dbTrackToTrack), index);
  };

  const playAlbum = (album: Album, shuffled = false) => {
    if (!tracksByAlbum) return;
    const albumTracks = tracksByAlbum.get(album.identity_key) ?? [];
    if (albumTracks.length === 0) return;
    if (shuffled) {
      void shuffleTracks(albumTracks.map(dbTrackToTrack));
    } else {
      void playTracks(albumTracks.map(dbTrackToTrack), 0);
    }
  };

  const openSearch = () => openQuickSearch();

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
        <View style={styles.header}>
          <AstraLogo size={36} />
          <Text style={styles.wordmark}>ASTRA</Text>
        </View>
        <Text variant="label" style={styles.tagline}>
          Audiophile player
        </Text>

        <ScanProgress />

        {!hasLibrary ? (
          <>
            {currentTrack ? (
              <View style={styles.topFeature}>
                <NowPlayingCard
                  track={currentTrack}
                  playbackState={playbackState}
                  currentTime={currentTime}
                  duration={duration}
                  onOpen={() => router.push('/now-playing')}
                />
              </View>
            ) : null}
            <EmptyHomeCard
              scanError={scanError}
              onManageFolders={() => router.push('/settings')}
            />
          </>
        ) : (
          <>
            <View style={styles.topFeature}>
              {currentTrack ? (
                <NowPlayingCard
                  track={currentTrack}
                  playbackState={playbackState}
                  currentTime={currentTime}
                  duration={duration}
                  onOpen={() => router.push('/now-playing')}
                />
              ) : randomAlbum ? (
                <RandomAlbumCard
                  album={randomAlbum}
                  tracks={randomTracks}
                  onOpen={() => openAlbum(randomAlbum)}
                  onPlay={() => playAlbum(randomAlbum)}
                  onShuffle={() => playAlbum(randomAlbum, true)}
                  onReroll={() => setRandomAlbumKey(chooseRandomAlbum(albums, randomAlbum.identity_key))}
                />
              ) : null}
            </View>

            <View style={styles.section}>
              <SectionHeader
                title="Recently Played"
                trailing={
                  recentlyPlayedTracks.length > 0
                    ? formatCount(recentlyPlayedTracks.length, 'track')
                    : undefined
                }
                actionLabel={
                  canExpandRecentTracks ? 'See all' : undefined
                }
                onActionPress={
                  canExpandRecentTracks ? () => router.push('/recently-played') : undefined
                }
              />
              {recentTracks.length > 0 ? (
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
              ) : (
                <Text variant="body" color={colors.textSecondary} style={styles.emptyLine}>
                  No recent plays yet.
                </Text>
              )}
            </View>

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

            <View style={styles.section}>
              <SectionHeader title="Favorites & Playlists" />
              <View style={styles.listBlock}>
                <PlaylistRow
                  name="Favorites"
                  trackCount={favoriteTracks.length}
                  coverHash={favoriteTracks[0]?.artwork_hash ?? null}
                  pinned
                  onPress={() => router.push('/library/playlist/favorites')}
                />
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  wordmark: {
    fontFamily: fonts.sans.bold,
    fontSize: 30,
    letterSpacing: 6,
    color: colors.textPrimary,
  },
  tagline: {
    marginTop: spacing.xs,
    letterSpacing: 1,
  },
  topFeature: {
    marginTop: spacing.xxl,
  },
  playerCard: {
    minHeight: PLAYER_CARD_MIN_HEIGHT,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.glassBg,
    borderColor: colors.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  playerSpectrum: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  playerSpectrumVeil: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: rgbaFromHex(colors.bgPrimary, 0.28),
  },
  playerArt: {
    width: 112,
    aspectRatio: 1,
    alignSelf: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.bgTertiary,
    borderColor: colors.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  playerMeta: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    gap: spacing.xs,
  },
  seekTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.glassBorder,
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  seekFill: {
    width: '38%',
    height: 3,
    backgroundColor: colors.accent,
  },
  placeholderControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    maxWidth: 220,
  },
  playCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
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
  image: {
    width: '100%',
    height: '100%',
  },
  randomCard: {
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
    padding: spacing.lg,
  },
  randomMeta: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  reroll: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glassHighlight,
  },
  randomActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
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
  secondaryButton: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderColor: colors.accent,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  listBlock: {
    backgroundColor: colors.bgPrimary,
  },
  emptyLine: {
    paddingVertical: spacing.md,
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
