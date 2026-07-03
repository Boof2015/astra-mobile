import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { useRouter } from 'expo-router';
import { Text } from '@/components/Text';
import { AppSheet, AppSheetItem, AppSheetSection, type AppSheetItemProps } from '@/components/sheets/AppSheet';
import { enqueueEnd, enqueueTop } from '@/audio/playbackController';
import { dbTrackToTrack } from '@/library/trackAdapter';
import { resolveCanonicalBrowseArtist, resolveStrictBrowseArtist } from '@/library/artistGrouping';
import { colors, fonts, radius, spacing } from '@/theme';
import { usePlaylistStore } from '@/stores/playlistStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { DbTrack } from '@/types/library';

export interface TrackActionSheetItem extends AppSheetItemProps {
  key: string;
}

interface TrackActionsSheetProps {
  /** null = hidden. */
  track: DbTrack | null;
  onClose: () => void;
  /** Allows callers with their own menu to jump straight to playlist picking. */
  initialStep?: 'menu' | 'pickPlaylist';
  /** Screen-specific extras (e.g. playlist detail: remove / move). Handlers should close. */
  extraItems?: TrackActionSheetItem[];
}

/** Track menu: queue, playlist, navigation, favorites, and optional screen extras. */
export function TrackActionsSheet(props: TrackActionsSheetProps) {
  // Mount fresh per track so the step state resets.
  if (!props.track) return null;
  return <TrackActionsSheetInner {...props} track={props.track} />;
}

function TrackActionsSheetInner({
  track,
  onClose,
  initialStep = 'menu',
  extraItems = [],
}: TrackActionsSheetProps & { track: DbTrack }) {
  const router = useRouter();
  const [step, setStep] = useState<'menu' | 'pickPlaylist' | 'newPlaylist'>(initialStep);
  const [playlistName, setPlaylistName] = useState('');
  const groupingMode = useSettingsStore((s) => s.artistGroupingMode);
  const playlists = usePlaylistStore((s) => s.playlists);
  const isFavorite = usePlaylistStore((s) => s.favoritePaths.has(track.path));
  const toggleFavorite = usePlaylistStore((s) => s.toggleFavorite);
  const addTracksToPlaylist = usePlaylistStore((s) => s.addTracksToPlaylist);
  const createPlaylist = usePlaylistStore((s) => s.createPlaylist);

  const artistName =
    groupingMode === 'fileTags' ? resolveStrictBrowseArtist(track) : resolveCanonicalBrowseArtist(track);
  const trimmedPlaylistName = playlistName.trim();

  const closeAndRun = (run: () => void) => {
    onClose();
    run();
  };

  const addToNewPlaylist = () => {
    if (!trimmedPlaylistName) return;
    void (async () => {
      const playlist = await createPlaylist(trimmedPlaylistName);
      await addTracksToPlaylist(playlist.id, [track]);
    })();
    onClose();
  };

  const menuItems: TrackActionSheetItem[] = [
    {
      key: 'play-next',
      label: 'Play next',
      icon: 'play-skip-forward',
      onPress: () => closeAndRun(() => void enqueueTop(dbTrackToTrack(track))),
    },
    {
      key: 'add-to-queue',
      label: 'Add to queue',
      icon: 'list-outline',
      onPress: () => closeAndRun(() => void enqueueEnd(dbTrackToTrack(track))),
    },
    {
      key: 'add-to-playlist',
      label: 'Add to playlist...',
      icon: 'add-circle-outline',
      onPress: () => setStep('pickPlaylist'),
    },
    {
      key: 'view-album',
      label: 'View album',
      icon: 'albums-outline',
      onPress: () =>
        closeAndRun(() =>
          router.push({
            pathname: '/library/album/[key]',
            params: { key: track.album_identity_key },
          })
        ),
    },
    {
      key: 'view-artist',
      label: 'View artist',
      icon: 'person-outline',
      onPress: () =>
        closeAndRun(() =>
          router.push({
            pathname: '/library/artist/[name]',
            params: { name: artistName },
          })
        ),
    },
    {
      key: 'favorite',
      label: isFavorite ? 'Remove from favorites' : 'Add to favorites',
      icon: isFavorite ? 'heart-dislike-outline' : 'heart-outline',
      selected: isFavorite,
      onPress: () => closeAndRun(() => void toggleFavorite(track)),
    },
  ];

  const pickItems: TrackActionSheetItem[] = [
    ...playlists.map((playlist) => ({
      key: `playlist-${playlist.id}`,
      label: playlist.name,
      icon: 'musical-notes-outline' as const,
      onPress: () => closeAndRun(() => void addTracksToPlaylist(playlist.id, [track])),
    })),
    {
      key: 'new-playlist',
      label: 'New playlist...',
      icon: 'add',
      onPress: () => setStep('newPlaylist'),
    },
  ];

  if (step === 'pickPlaylist') {
    return (
      <AppSheet onClose={onClose}>
        <SheetTitle title="Add to playlist" subtitle={track.title} />
        {initialStep === 'menu' ? (
          <AppSheetItem label="Track actions" icon="arrow-back" onPress={() => setStep('menu')} />
        ) : null}
        {playlists.length === 0 ? (
          <Text variant="caption" color={colors.textTertiary} style={styles.empty}>
            No playlists yet.
          </Text>
        ) : null}
        {pickItems.map(({ key, ...item }) => (
          <AppSheetItem key={key} {...item} />
        ))}
      </AppSheet>
    );
  }

  if (step === 'newPlaylist') {
    return (
      <AppSheet onClose={onClose}>
        <SheetTitle title="New playlist" subtitle={track.title} />
        <BottomSheetTextInput
          value={playlistName}
          onChangeText={setPlaylistName}
          placeholder="Playlist name"
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={addToNewPlaylist}
          selectionColor={colors.accent}
        />
        <View style={styles.actions}>
          <Pressable style={[styles.btn, styles.cancel]} onPress={() => setStep('pickPlaylist')}>
            <Text variant="label" color={colors.textSecondary}>
              Back
            </Text>
          </Pressable>
          <Pressable
            style={[styles.btn, styles.create, !trimmedPlaylistName && styles.createDisabled]}
            disabled={!trimmedPlaylistName}
            onPress={addToNewPlaylist}
          >
            <Text variant="label" color={colors.accentTextStrong}>
              Create
            </Text>
          </Pressable>
        </View>
      </AppSheet>
    );
  }

  return (
    <AppSheet onClose={onClose}>
      <SheetTitle title={track.title} subtitle={track.artist} />
      {menuItems.map(({ key, ...item }) => (
        <AppSheetItem key={key} {...item} />
      ))}
      {extraItems.length > 0 ? (
        <>
          <AppSheetSection label="PLAYLIST" />
          {extraItems.map(({ key, ...item }) => (
            <AppSheetItem key={key} {...item} />
          ))}
        </>
      ) : null}
    </AppSheet>
  );
}

function SheetTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.titleBlock}>
      <Text variant="heading" numberOfLines={1} style={styles.title}>
        {title}
      </Text>
      {subtitle ? (
        <Text variant="label" numberOfLines={1} color={colors.textSecondary}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  titleBlock: {
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    gap: 2,
  },
  title: {
    paddingRight: spacing.lg,
  },
  empty: {
    paddingVertical: spacing.sm,
  },
  input: {
    color: colors.textPrimary,
    fontFamily: fonts.sans.regular,
    fontSize: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  btn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  cancel: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  create: {
    backgroundColor: colors.accentGlow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
  },
  createDisabled: {
    opacity: 0.4,
  },
});
