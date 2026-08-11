import {
  StyleSheet,
  View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import { AppPressable } from '@/components/AppPressable';
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
  icon,
  label,
  accessibilityLabel,
  disabled,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  accessibilityLabel: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <AppPressable feedback="control"

      style={[styles.button, disabled && styles.buttonDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Ionicons name={icon} size={18} color={colors.accent} />
      <Text variant="label" style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </AppPressable>
  );
}

const useStyles = createThemedStyles((colors) => ({
  bar: {
    flexDirection: 'row',
    borderTopColor: colors.glassBorder,
    borderTopWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.bgTertiary,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  label: {
    color: colors.accent,
  },
}));
