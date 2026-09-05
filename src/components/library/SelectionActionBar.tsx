import { ActionButton } from '@/components/ActionButton';
import {
  StyleSheet,
  View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing } from '@/theme';
import { createThemedStyles } from '@/theme/themed';
import { useSceneBottomInset } from '@/navigation/useShellLayout';

interface SelectionActionBarProps {
  count: number;
  onPlayNext: () => void;
  onAddToQueue: () => void;
  onAddToPlaylist: () => void;
}

/** Bottom batch-action bar for library multi-select (native queue action-bar language). */
export function SelectionActionBar({
  count,
  onPlayNext,
  onAddToQueue,
  onAddToPlaylist,
}: SelectionActionBarProps) {
  const styles = useStyles();
  // Pinned to the bottom of the scene, so it has to clear the floating chrome
  // itself — the lists above it reserve this in their content inset, but a bar
  // outside the scroll view has to ask.
  const sceneBottomInset = useSceneBottomInset();
  const disabled = count === 0;
  return (
    <View style={[styles.bar, { paddingBottom: sceneBottomInset }]}>
      <BarButton
        primary
        icon="play-skip-forward"
        label={`Play next (${count})`}
        accessibilityLabel={`Play ${count} selected tracks next`}
        disabled={disabled}
        onPress={onPlayNext}
      />
      <BarButton
        icon="list-outline"
        label={`Queue (${count})`}
        accessibilityLabel={`Add ${count} selected tracks to the queue`}
        disabled={disabled}
        onPress={onAddToQueue}
      />
      <BarButton
        icon="add-circle-outline"
        label={`Playlist (${count})`}
        accessibilityLabel={`Add ${count} selected tracks to a playlist`}
        disabled={disabled}
        onPress={onAddToPlaylist}
      />
    </View>
  );
}

function BarButton({
  primary = false,
  icon,
  label,
  accessibilityLabel,
  disabled,
  onPress,
}: {
  primary?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  accessibilityLabel: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  return (
    <ActionButton
      variant={primary ? 'primary' : 'secondary'}
      icon={icon}
      label={label}
      style={styles.button}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    />
  );
}

const useStyles = createThemedStyles((colors) => ({
  bar: {
    flexDirection: 'row',
    borderTopColor: colors.glassBorder,
    borderTopWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.bgPrimary,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  button: {
    flex: 1,
    minWidth: 132,
  },
}));
