import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { SCROLL_PRESS_DELAY, useRipple } from '@/theme/ripple';
import {
  LIBRARY_CONTEXT_BAR_HEIGHT,
  LIBRARY_CONTEXT_TOP_GAP,
} from '@/library/libraryViewPresentation';
import {
  libraryViewModeLabel,
  type LibraryViewMode,
} from '@/library/libraryViewMode';

type IconName = keyof typeof Ionicons.glyphMap;

const MODE_ICONS: Record<LibraryViewMode, IconName> = {
  albums: 'albums-outline',
  artists: 'people-outline',
  tracks: 'musical-notes-outline',
  playlists: 'list-outline',
  folders: 'folder-outline',
};

export const LIBRARY_CONTEXT_ACTION_SIZE = 44;

interface SelectionActions {
  count: number;
  onPlayNext: () => void;
  onAddToQueue: () => void;
  onAddToPlaylist: () => void;
  onCancel: () => void;
}

export function LibraryContextBar({
  mode,
  bottomClearance,
  onOpenModePicker,
  onSearch,
  onSort,
  sortLabel,
  onLayout,
  layoutLabel,
  onAddPlaylist,
  selection,
}: {
  mode: LibraryViewMode;
  bottomClearance: number;
  onOpenModePicker: () => void;
  onSearch: () => void;
  onSort?: () => void;
  sortLabel?: string;
  onLayout?: () => void;
  layoutLabel?: string;
  onAddPlaylist?: () => void;
  selection?: SelectionActions;
}) {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.accessory,
        { paddingBottom: bottomClearance },
      ]}
    >
      <View style={styles.bar}>
        {selection ? (
          <>
            <Text variant="label" numberOfLines={1} style={styles.selectionCount}>
              {selection.count} selected
            </Text>
            <View style={styles.actions}>
              <ContextAction
                icon="play-skip-forward"
                label={`Play ${selection.count} selected tracks next`}
                disabled={selection.count === 0}
                onPress={selection.onPlayNext}
              />
              <ContextAction
                icon="list-outline"
                label={`Add ${selection.count} selected tracks to the queue`}
                disabled={selection.count === 0}
                onPress={selection.onAddToQueue}
              />
              <ContextAction
                icon="add-circle-outline"
                label={`Add ${selection.count} selected tracks to a playlist`}
                disabled={selection.count === 0}
                onPress={selection.onAddToPlaylist}
              />
              <ContextAction icon="close" label="Cancel selection" onPress={selection.onCancel} />
            </View>
          </>
        ) : (
          <>
            <Pressable
              android_ripple={ripple.bounded}
              unstable_pressDelay={SCROLL_PRESS_DELAY}
              style={styles.modeButton}
              onPress={onOpenModePicker}
              accessibilityRole="button"
              accessibilityLabel={`Change Library section. Current section: ${libraryViewModeLabel(mode)}`}
            >
              <Ionicons name={MODE_ICONS[mode]} size={19} color={colors.accent} />
              <Text variant="body" numberOfLines={1} style={styles.modeLabel}>
                {libraryViewModeLabel(mode)}
              </Text>
              <Ionicons name="chevron-up" size={16} color={colors.textTertiary} />
            </Pressable>
            <View style={styles.actions}>
              <ContextAction icon="search" label="Search library" onPress={onSearch} />
              {onSort ? (
                <ContextAction
                  icon="swap-vertical"
                  label={`Sort ${libraryViewModeLabel(mode)}${sortLabel ? `, currently ${sortLabel}` : ''}`}
                  onPress={onSort}
                />
              ) : null}
              {onLayout ? (
                <ContextAction
                  icon={layoutLabel === 'List' ? 'list-outline' : 'grid-outline'}
                  label={`Change ${libraryViewModeLabel(mode)} layout${layoutLabel ? `. Current layout: ${layoutLabel}` : ''}`}
                  onPress={onLayout}
                />
              ) : null}
              {onAddPlaylist ? (
                <ContextAction
                  icon="add"
                  label="Add or import playlist"
                  onPress={onAddPlaylist}
                />
              ) : null}
            </View>
          </>
        )}
      </View>
    </View>
  );
}

function ContextAction({
  icon,
  label,
  disabled = false,
  onPress,
}: {
  icon: IconName;
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const ripple = useRipple();
  return (
    <Pressable
      android_ripple={ripple.icon(LIBRARY_CONTEXT_ACTION_SIZE / 2)}
      unstable_pressDelay={SCROLL_PRESS_DELAY}
      style={[styles.action, disabled && styles.disabled]}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      <Ionicons name={icon} size={20} color={colors.textSecondary} />
    </Pressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  accessory: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
    paddingTop: LIBRARY_CONTEXT_TOP_GAP,
    paddingHorizontal: spacing.md,
  },
  bar: {
    height: LIBRARY_CONTEXT_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgTertiary,
    borderColor: colors.glassBorderStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  modeButton: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  modeLabel: {
    flex: 1,
    minWidth: 0,
  },
  selectionCount: {
    flex: 1,
    minWidth: 0,
    paddingLeft: spacing.md,
    color: colors.textPrimary,
  },
  actions: {
    flexDirection: 'row',
    flexShrink: 0,
    alignItems: 'center',
  },
  action: {
    width: LIBRARY_CONTEXT_ACTION_SIZE,
    height: LIBRARY_CONTEXT_ACTION_SIZE,
    borderRadius: LIBRARY_CONTEXT_ACTION_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.4,
  },
}));

export default LibraryContextBar;
