import { useState } from 'react';
import { ActionSheet, type ActionSheetItem } from '@/components/sheets/ActionSheet';
import { TextPromptModal } from '@/components/sheets/TextPromptModal';
import { usePlaylistStore } from '@/stores/playlistStore';
import type { DbTrack } from '@/types/library';

interface TrackActionsSheetProps {
  /** null = hidden. */
  track: DbTrack | null;
  onClose: () => void;
  /** Allows callers with their own menu to jump straight to playlist picking. */
  initialStep?: 'menu' | 'pickPlaylist';
  /** Screen-specific extras (e.g. playlist detail: remove / move). Handlers should close. */
  extraItems?: ActionSheetItem[];
}

/** Long-press track menu: favorite toggle, add-to-playlist (pick or create), extras. */
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
  const [step, setStep] = useState<'menu' | 'pickPlaylist' | 'newPlaylist'>(initialStep);
  const playlists = usePlaylistStore((s) => s.playlists);
  const isFavorite = usePlaylistStore((s) => s.favoritePaths.has(track.path));
  const toggleFavorite = usePlaylistStore((s) => s.toggleFavorite);
  const addTracksToPlaylist = usePlaylistStore((s) => s.addTracksToPlaylist);
  const createPlaylist = usePlaylistStore((s) => s.createPlaylist);

  const menuItems: ActionSheetItem[] = [
    {
      key: 'favorite',
      label: isFavorite ? 'Remove from favorites' : 'Add to favorites',
      icon: isFavorite ? 'heart-dislike-outline' : 'heart-outline',
      onPress: () => {
        void toggleFavorite(track);
        onClose();
      },
    },
    {
      key: 'add-to-playlist',
      label: 'Add to playlist…',
      icon: 'add-circle-outline',
      onPress: () => setStep('pickPlaylist'),
    },
    ...extraItems,
  ];

  const pickItems: ActionSheetItem[] = [
    ...playlists.map((playlist) => ({
      key: `playlist-${playlist.id}`,
      label: playlist.name,
      icon: 'musical-notes-outline' as const,
      onPress: () => {
        void addTracksToPlaylist(playlist.id, [track]);
        onClose();
      },
    })),
    {
      key: 'new-playlist',
      label: 'New playlist…',
      icon: 'add',
      onPress: () => setStep('newPlaylist'),
    },
  ];

  return (
    <>
      <ActionSheet
        visible={step === 'menu'}
        title={track.title}
        items={menuItems}
        onClose={onClose}
      />
      <ActionSheet
        visible={step === 'pickPlaylist'}
        title="Add to playlist"
        items={pickItems}
        onClose={onClose}
      />
      <TextPromptModal
        visible={step === 'newPlaylist'}
        title="New playlist"
        placeholder="Playlist name"
        submitLabel="Create"
        onSubmit={(name) => {
          void (async () => {
            const playlist = await createPlaylist(name);
            await addTracksToPlaylist(playlist.id, [track]);
          })();
          onClose();
        }}
        onClose={onClose}
      />
    </>
  );
}
