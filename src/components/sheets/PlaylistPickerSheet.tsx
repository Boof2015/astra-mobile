import { ActionButton } from '@/components/ActionButton';
import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Text } from '@/components/Text';
import {
  AppSheet,
  AppSheetBody,
  AppSheetDivider,
  AppSheetField,
  AppSheetFooter,
  AppSheetItem,
  AppSheetTitle
} from '@/components/sheets/AppSheet';
import {
  fonts,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { usePlaylistStore } from '@/stores/playlistStore';
import type { DbTrack } from '@/types/library';

interface PlaylistPickerSheetProps {
  /** Tracks to add (in order) to the chosen or newly created playlist. */
  tracks: DbTrack[];
  /** Context line under the sheet title, e.g. a track title or "12 tracks". */
  subtitle?: string;
  onClose: () => void;
  /** Renders a back item returning to the caller's own menu (track actions). */
  onBackToMenu?: () => void;
  /** Fires only when tracks were actually added (not on cancel/dismiss). */
  onAdded?: () => void;
}

/** Two-step "add to playlist" sheet: pick an existing playlist or create one. */
export function PlaylistPickerSheet({
  tracks,
  subtitle,
  onClose,
  onBackToMenu,
  onAdded,
}: PlaylistPickerSheetProps) {
  const styles = useStyles();
  const colors = useColors();
  const [step, setStep] = useState<'pick' | 'create'>('pick');
  const [playlistName, setPlaylistName] = useState('');
  const playlists = usePlaylistStore((s) => s.playlists);
  const addTracksToPlaylist = usePlaylistStore((s) => s.addTracksToPlaylist);
  const createPlaylist = usePlaylistStore((s) => s.createPlaylist);
  const trimmedPlaylistName = playlistName.trim();
  const targetPlaylists = playlists.filter((playlist) => playlist.kind !== 'dynamic');

  const addToExisting = (playlistId: number) => {
    onClose();
    void addTracksToPlaylist(playlistId, tracks);
    onAdded?.();
  };

  const addToNewPlaylist = () => {
    if (!trimmedPlaylistName) return;
    void (async () => {
      const playlist = await createPlaylist(trimmedPlaylistName);
      await addTracksToPlaylist(playlist.id, tracks);
    })();
    onClose();
    onAdded?.();
  };

  if (step === 'create') {
    return (
      <AppSheet onClose={onClose} scrollable>
        <AppSheetTitle title="New playlist" subtitle={subtitle} />
        <AppSheetBody>
          <AppSheetField label="Playlist name">
            <BottomSheetTextInput
              value={playlistName}
              onChangeText={setPlaylistName}
              placeholder="Playlist name"
              accessibilityLabel="Playlist name"
              placeholderTextColor={colors.textTertiary}
              style={styles.input}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={addToNewPlaylist}
              selectionColor={colors.accent}
            />
          </AppSheetField>
        </AppSheetBody>
        <AppSheetFooter>
          <ActionButton
            onPress={() => setStep('pick')}
            variant="secondary"
            label="Back"
          />
          <ActionButton
            disabled={!trimmedPlaylistName}
            onPress={addToNewPlaylist}
            variant="primary"
            label="Create"
          />
        </AppSheetFooter>
      </AppSheet>
    );
  }

  return (
    <AppSheet onClose={onClose} scrollable>
      <AppSheetTitle title="Add to playlist" subtitle={subtitle} />
      {onBackToMenu ? (
        <AppSheetItem label="Track actions" icon="arrow-back" onPress={onBackToMenu} />
      ) : null}
      {targetPlaylists.length === 0 ? (
        <Text variant="caption" color={colors.textTertiary} style={styles.empty}>
          No playlists yet.
        </Text>
      ) : null}
      {targetPlaylists.map((playlist) => (
        <AppSheetItem
          key={playlist.id}
          label={playlist.name}
          icon="musical-notes-outline"
          onPress={() => addToExisting(playlist.id)}
        />
      ))}
      <AppSheetDivider />
      <AppSheetItem label="New playlist..." icon="add" onPress={() => setStep('create')} />
    </AppSheet>
  );
}

const useStyles = createThemedStyles((colors) => ({
  empty: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  input: {
    color: colors.textPrimary,
    fontFamily: fonts.sans.regular,
    fontSize: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
}));
