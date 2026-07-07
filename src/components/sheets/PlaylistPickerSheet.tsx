import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  View
} from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Text } from '@/components/Text';
import {
  AppSheet,
  AppSheetItem,
  AppSheetTitle
} from '@/components/sheets/AppSheet';
import {
  fonts,
  radius,
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
      <AppSheet onClose={onClose}>
        <AppSheetTitle title="New playlist" subtitle={subtitle} />
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
          <Pressable style={[styles.btn, styles.cancel]} onPress={() => setStep('pick')}>
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
      <AppSheetItem label="New playlist..." icon="add" onPress={() => setStep('create')} />
    </AppSheet>
  );
}

const useStyles = createThemedStyles((colors) => ({
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
}));
