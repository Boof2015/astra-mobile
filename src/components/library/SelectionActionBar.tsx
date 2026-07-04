import {
  Pressable,
  StyleSheet,
  View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { colors, spacing } from '@/theme';

interface SelectionActionBarProps {
  count: number;
  onPlayNext: () => void;
  onAddToQueue: () => void;
  onAddToPlaylist: () => void;
}

/** Bottom batch-action bar for library multi-select (QueueTray action-bar language). */
export function SelectionActionBar({
  count,
  onPlayNext,
  onAddToQueue,
  onAddToPlaylist,
}: SelectionActionBarProps) {
  const disabled = count === 0;
  return (
    <View style={styles.bar}>
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
  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        pressed && styles.buttonPressed,
        disabled && styles.buttonDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Ionicons name={icon} size={18} color={colors.accent} />
      <Text variant="label" style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
  buttonPressed: {
    opacity: 0.7,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  label: {
    color: colors.accent,
  },
});
