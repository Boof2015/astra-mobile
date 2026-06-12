import { View, Pressable, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { colors, radius, spacing } from '@/theme';
import { useLibraryStore } from '@/stores/libraryStore';
import type { FolderWithCount } from '@/stores/libraryStore';

function FolderRow({ folder }: { folder: FolderWithCount }) {
  const removeFolder = useLibraryStore((s) => s.removeFolder);

  const confirmRemove = () => {
    Alert.alert(
      'Remove folder?',
      `"${folder.display_name}" and its ${folder.track_count} tracks will be removed from the library. Files on disk are not touched.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => void removeFolder(folder.id) },
      ]
    );
  };

  return (
    <View style={styles.row}>
      <Ionicons
        name={folder.available ? 'folder-outline' : 'alert-circle-outline'}
        size={22}
        color={folder.available ? colors.textSecondary : colors.warning}
      />
      <View style={styles.meta}>
        <Text variant="body" numberOfLines={1}>
          {folder.display_name}
        </Text>
        <Text variant="label" numberOfLines={1}>
          {folder.available
            ? `${folder.track_count} ${folder.track_count === 1 ? 'track' : 'tracks'}`
            : 'Access lost — remove and add the folder again'}
        </Text>
      </View>
      <Pressable hitSlop={8} onPress={confirmRemove} accessibilityRole="button">
        <Ionicons name="trash-outline" size={18} color={colors.textTertiary} />
      </Pressable>
    </View>
  );
}

export function FoldersView() {
  const folders = useLibraryStore((s) => s.folders);
  const isScanning = useLibraryStore((s) => s.isScanning);
  const addFolder = useLibraryStore((s) => s.addFolder);
  const rescan = useLibraryStore((s) => s.rescan);

  return (
    <View style={styles.container}>
      {folders.map((folder) => (
        <FolderRow key={folder.id} folder={folder} />
      ))}

      <View style={styles.actions}>
        <Pressable
          style={[styles.action, isScanning && styles.actionDisabled]}
          disabled={isScanning}
          onPress={() => void addFolder()}
          accessibilityRole="button"
        >
          <Ionicons name="add" size={18} color={colors.accent} />
          <Text variant="body" color={colors.accent}>
            Add folder
          </Text>
        </Pressable>
        {folders.length > 0 ? (
          <Pressable
            style={[styles.action, isScanning && styles.actionDisabled]}
            disabled={isScanning}
            onPress={() => void rescan()}
            accessibilityRole="button"
          >
            <Ionicons name="refresh" size={16} color={colors.textSecondary} />
            <Text variant="body" color={colors.textSecondary}>
              Rescan all
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomColor: colors.glassBorder,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  meta: {
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderColor: colors.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  actionDisabled: {
    opacity: 0.4,
  },
});
