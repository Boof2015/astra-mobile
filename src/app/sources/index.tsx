import { ActionButton } from '@/components/ActionButton';
import { useState } from 'react';
import {
  StyleSheet,
  View
} from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import {
  ScreenHeader,
  ScreenHeaderAction,
  useScreenHeader,
} from '@/components/ScreenHeader';
import { Text } from '@/components/Text';
import { showAppDialog } from '@/components/dialogs/AppDialog';
import { ActionSheet, type ActionSheetItem } from '@/components/sheets/ActionSheet';
import {
  radius,
  spacing,
} from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { AppPressable } from '@/components/AppPressable';
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
  const styles = useStyles();
  const colors = useColors();
  const router = useRouter();
  const sources = useRemoteSourcesStore((s) => s.sources);
  const header = useScreenHeader({ actionCount: sources.length > 0 ? 2 : 1 });
  const progressById = useRemoteSourcesStore((s) => s.progressById);
  const syncSource = useRemoteSourcesStore((s) => s.syncSource);
  const syncAll = useRemoteSourcesStore((s) => s.syncAll);
  const deleteSource = useRemoteSourcesStore((s) => s.deleteSource);

  const [actionFor, setActionFor] = useState<RemoteSourceRow | null>(null);

  const confirmRemove = (source: RemoteSourceRow) => {
    showAppDialog({
      title: `Remove ${source.name}?`,
      message: 'This removes the server and all of its tracks from your library. Favorites and playlist entries are kept but will show as missing.',
      actions: [
        { label: 'Cancel', role: 'cancel' },
        {
          label: 'Remove',
          role: 'destructive',
          onPress: () => void deleteSource(source.id, true),
        },
      ],
    });
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
    // The header is an overlay the content scrolls under, so the screen keeps
    // neither the top inset nor the gutter — both move into the ScrollView.
    <Screen padded={false} style={styles.screen}>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        onScroll={header.onScroll}
        scrollEventThrottle={header.scrollEventThrottle}
        contentContainerStyle={[styles.content, { paddingTop: header.contentPaddingTop }]}
      >
        {sources.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="server-outline" size={28} color={colors.textTertiary} />
            <Text variant="body" color={colors.textSecondary} style={styles.emptyText}>
              No servers yet. Add a Subsonic or Jellyfin server to stream and browse your
              self-hosted library.
            </Text>
            <ActionButton
              style={styles.addButton}
              onPress={() => router.push('/sources/edit')}
              variant="primary"
              label="Add server"
              icon="add"
              iconSize={18}
            />
          </View>
        ) : (
          sources.map((source) => {
            const status = statusLine(source, progressById[source.id] ?? null);
            return (
              <AppPressable
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
              </AppPressable>
            );
          })
        )}
      </Animated.ScrollView>

      <ScreenHeader
        header={header}
        title="Remote sources"
        backLabel="Settings"
        onBack={() => router.back()}
        actions={
          <>
            {sources.length > 0 ? (
              <ScreenHeaderAction onPress={() => void syncAll()} accessibilityLabel="Sync all">
                <Ionicons name="sync" size={20} color={colors.textSecondary} />
              </ScreenHeaderAction>
            ) : null}
            <ScreenHeaderAction
              onPress={() => router.push('/sources/edit')}
              accessibilityLabel="Add server"
            >
              <Ionicons name="add" size={26} color={colors.accent} />
            </ScreenHeaderAction>
          </>
        }
      />

      <ActionSheet
        visible={actionFor !== null}
        title={actionFor?.name}
        items={actionItems}
        onClose={() => setActionFor(null)}
      />
    </Screen>
  );
}

const useStyles = createThemedStyles((colors) => ({
  // The header draws behind the status bar; the ScrollView pays the inset.
  screen: {
    paddingTop: 0,
  },
  content: {
    paddingHorizontal: spacing.lg,
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
}));
