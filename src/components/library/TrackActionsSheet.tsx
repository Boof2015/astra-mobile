import { useState } from 'react';
import { useRouter } from 'expo-router';
import {
  AppSheet,
  AppSheetItem,
  AppSheetSection,
  AppSheetTitle,
  type AppSheetItemProps,
} from '@/components/sheets/AppSheet';
import { PlaylistPickerSheet } from '@/components/sheets/PlaylistPickerSheet';
import { enqueueEnd, enqueueTop } from '@/audio/playbackController';
import { dbTrackToTrack } from '@/library/trackAdapter';
import { resolveNavigationArtist } from '@/library/artistGrouping';
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
  const [step, setStep] = useState<'menu' | 'pickPlaylist'>(initialStep);
  const groupingMode = useSettingsStore((s) => s.artistGroupingMode);
  const isFavorite = usePlaylistStore((s) => s.favoritePaths.has(track.path));
  const toggleFavorite = usePlaylistStore((s) => s.toggleFavorite);

  const artistName = resolveNavigationArtist(track, groupingMode);

  const closeAndRun = (run: () => void) => {
    onClose();
    run();
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

  if (step === 'pickPlaylist') {
    return (
      <PlaylistPickerSheet
        tracks={[track]}
        subtitle={track.title}
        onClose={onClose}
        onBackToMenu={initialStep === 'menu' ? () => setStep('menu') : undefined}
      />
    );
  }

  return (
    <AppSheet onClose={onClose}>
      <AppSheetTitle title={track.title} subtitle={track.artist} />
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
