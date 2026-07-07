// Read-only queue sheet for the Desktop Remote: the desktop's current +
// upcoming tracks, tap-to-play. Deliberately NOT QueueTray — that component is
// welded to the local RNTP queue store (drag-reorder, swipe-remove,
// multi-select), none of which applies to a remote snapshot. Uses an INLINE
// BottomSheet like QueueTray does — BottomSheetModal's portal does not work in
// this app's screen setups (see queue-tray-sheet gotcha).

import { useCallback, useEffect, useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet, {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  useBottomSheetScrollableCreator,
} from '@gorhom/bottom-sheet';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { Text } from '@/components/Text';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { formatDuration } from '@/lib/format';
import { useDesktopRemoteStore } from '@/stores/desktopRemoteStore';
import type { DesktopRemoteQueueItem } from '@/types/desktopRemote';

interface RemoteQueueSheetProps {
  onClose: () => void;
}

export function RemoteQueueSheet({ onClose }: RemoteQueueSheetProps) {
  const styles = useStyles();
  const colors = useColors();
  const queue = useDesktopRemoteStore((s) => s.queue);
  const snapPoints = useMemo(() => ['58%', '100%'], []);
  const renderFlashListScrollComponent = useBottomSheetScrollableCreator();

  // The SSE stream keeps the queue fresh while connected; refresh once on open
  // in case the stream fell back to snapshot polling (which has no queue).
  useEffect(() => {
    void useDesktopRemoteStore.getState().refreshQueue();
  }, []);

  const items = queue?.items ?? [];
  const upcomingCount = items.filter((item) => !item.isCurrent).length;

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
        opacity={0.58}
      />
    ),
    []
  );

  const playItem = useCallback(
    (item: DesktopRemoteQueueItem) => {
      if (item.isCurrent) return;
      void useDesktopRemoteStore.getState().playQueueItem(item.queueId);
      onClose();
    },
    [onClose]
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<DesktopRemoteQueueItem>) => (
      <Pressable
        style={({ pressed }) => [styles.row, pressed && !item.isCurrent && styles.rowPressed]}
        onPress={() => playItem(item)}
        disabled={item.isCurrent}
        accessibilityRole="button"
        accessibilityLabel={
          item.isCurrent ? `Now playing: ${item.title}` : `Play ${item.title} on desktop`
        }
      >
        <View style={styles.rowText}>
          <Text
            variant="body"
            numberOfLines={1}
            style={item.isCurrent ? styles.titleActive : undefined}
          >
            {item.title || 'Unknown title'}
          </Text>
          <Text variant="label" numberOfLines={1} color={colors.textTertiary}>
            {item.artist || 'Unknown artist'}
          </Text>
        </View>
        {item.isCurrent ? (
          <Ionicons name="volume-high" size={18} color={colors.accent} />
        ) : item.durationSeconds !== null ? (
          <Text variant="label" color={colors.textTertiary}>
            {formatDuration(item.durationSeconds)}
          </Text>
        ) : null}
      </Pressable>
    ),
    [playItem, colors, styles]
  );

  return (
    <BottomSheet
      index={0}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose
      onClose={onClose}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBg}
      handleIndicatorStyle={styles.handle}
    >
      <View style={styles.headerRow}>
        <Text variant="heading">Desktop queue</Text>
        <Text variant="label" color={colors.textTertiary}>
          {upcomingCount === 1 ? '1 song up next' : `${upcomingCount} songs up next`}
        </Text>
      </View>
      <FlashList
        data={items}
        keyExtractor={(item) => item.queueId}
        renderScrollComponent={renderFlashListScrollComponent}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text variant="body" color={colors.textSecondary}>
              The desktop queue is empty.
            </Text>
          </View>
        }
      />
    </BottomSheet>
  );
}

const useStyles = createThemedStyles((colors) => ({
  sheetBg: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
  },
  handle: {
    backgroundColor: colors.textTertiary,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  titleActive: {
    color: colors.accent,
  },
  empty: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
}));
