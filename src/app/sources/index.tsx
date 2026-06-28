import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { ActionSheet, type ActionSheetItem } from '@/components/sheets/ActionSheet';
import { colors, radius, spacing } from '@/theme';
import { useRemoteSourcesStore } from '@/stores/remoteSourcesStore';
import type { RemoteSourceRow, RemoteSyncProgress } from '@/types/remote';

function statusLine(
  source: RemoteSourceRow,
  progress: RemoteSyncProgress | null
): { text: string; tone: 'normal' | 'error' } {
  if (!source.enabled) return { text: 'Disabled', tone: 'normal' };
  if (progress) {
    const pct = progress.total > 0 ? ` ${progress.current}/${progress.total}` : '';
    return { text: `Syncing… ${progress.phase}${pct}`, tone: 'normal' };
  }
  if (source.last_status === 'error') {
    return { text: source.last_error ?? 'Sync failed', tone: 'error' };
  }
  if (source.last_sync_at) {
    return { text: `Last synced ${new Date(source.last_sync_at).toLocaleString()}`, tone: 'normal' };
  }
  return { text: 'Not synced yet', tone: 'normal' };
}

export default function SourcesScreen() {
  const router = useRouter();
  const sources = useRemoteSourcesStore((s) => s.sources);
  const progressById = useRemoteSourcesStore((s) => s.progressById);
  const syncSource = useRemoteSourcesStore((s) => s.syncSource);
  const syncAll = useRemoteSourcesStore((s) => s.syncAll);
  const deleteSource = useRemoteSourcesStore((s) => s.deleteSource);

  const [actionFor, setActionFor] = useState<RemoteSourceRow | null>(null);

  const confirmRemove = (source: RemoteSourceRow) => {
    Alert.alert(
      `Remove ${source.name}?`,
      'This removes the server and all of its tracks from your library. Favorites and playlist entries are kept but will show as missing.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => void deleteSource(source.id, true),
        },
      ]
    );
  };

  const actionItems: ActionSheetItem[] = actionFor
    ? [
        {
          key: 'sync',
          label: 'Sync now',
          icon: 'sync',
          onPress: () => {
            const id = actionFor.id;
            setActionFor(null);
            void syncSource(id);
          },
        },
        {
          key: 'edit',
          label: 'Edit server',
          icon: 'create-outline',
          onPress: () => {
            const id = actionFor.id;
            setActionFor(null);
            router.push({ pathname: '/sources/edit', params: { id: String(id) } });
          },
        },
        {
          key: 'remove',
          label: 'Remove server',
          icon: 'trash-outline',
          destructive: true,
          onPress: () => {
            const source = actionFor;
            setActionFor(null);
            confirmRemove(source);
          },
        },
      ]
    : [];

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.textSecondary} />
          <Text variant="body" color={colors.textSecondary}>
            Settings
          </Text>
        </Pressable>
        <View style={styles.headerActions}>
          {sources.length > 0 ? (
            <Pressable onPress={() => void syncAll()} hitSlop={8} accessibilityLabel="Sync all">
              <Ionicons name="sync" size={20} color={colors.textSecondary} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => router.push('/sources/edit')}
            hitSlop={8}
            accessibilityLabel="Add server"
          >
            <Ionicons name="add" size={26} color={colors.accent} />
          </Pressable>
        </View>
      </View>

      <Text variant="title" style={styles.heading}>
        Remote sources
      </Text>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {sources.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="server-outline" size={28} color={colors.textTertiary} />
            <Text variant="body" color={colors.textSecondary} style={styles.emptyText}>
              No servers yet. Add a Subsonic or Jellyfin server to stream and browse your
              self-hosted library.
            </Text>
            <Pressable style={styles.addButton} onPress={() => router.push('/sources/edit')}>
              <Ionicons name="add" size={18} color={colors.accentTextStrong} />
              <Text variant="body" color={colors.accentTextStrong}>
                Add server
              </Text>
            </Pressable>
          </View>
        ) : (
          sources.map((source) => {
            const status = statusLine(source, progressById[source.id] ?? null);
            return (
              <Pressable
                key={source.id}
                style={styles.row}
                onPress={() => setActionFor(source)}
                accessibilityRole="button"
              >
                <View style={styles.rowIcon}>
                  <Ionicons
                    name={source.type === 'subsonic' ? 'cloud-outline' : 'tv-outline'}
                    size={20}
                    color={colors.accent}
                  />
                </View>
                <View style={styles.rowMeta}>
                  <View style={styles.rowTitleLine}>
                    <Text variant="body" numberOfLines={1} style={styles.rowName}>
                      {source.name}
                    </Text>
                    <Text variant="label" color={colors.textTertiary}>
                      {source.type.toUpperCase()}
                    </Text>
                  </View>
                  <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
                    {source.base_url}
                  </Text>
                  <Text
                    variant="caption"
                    color={status.tone === 'error' ? colors.warning : colors.textSecondary}
                    numberOfLines={1}
                  >
                    {status.text}
                  </Text>
                </View>
                <Ionicons name="ellipsis-horizontal" size={18} color={colors.textTertiary} />
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <ActionSheet
        visible={actionFor !== null}
        title={actionFor?.name}
        items={actionItems}
        onClose={() => setActionFor(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  heading: {
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  content: {
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  empty: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  emptyText: {
    textAlign: 'center',
    lineHeight: 20,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
    backgroundColor: colors.accentGlow,
    marginTop: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgTertiary,
  },
  rowMeta: {
    flex: 1,
    gap: 2,
  },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  rowName: {
    flex: 1,
  },
});
