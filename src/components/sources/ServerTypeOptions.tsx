import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppPressable } from '@/components/AppPressable';
import { Text } from '@/components/Text';
import { radius, spacing } from '@/theme';
import { createThemedStyles, useColors } from '@/theme/themed';
import type { RemoteSourceType } from '@/types/remote';

export const SERVER_TYPE_OPTIONS: {
  type: RemoteSourceType;
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  {
    type: 'subsonic',
    label: 'Subsonic',
    description: 'Navidrome, Airsonic, Gonic, and other Subsonic-compatible servers.',
    icon: 'cloud-outline',
  },
  {
    type: 'jellyfin',
    label: 'Jellyfin',
    description: 'A Jellyfin media server.',
    icon: 'tv-outline',
  },
];

export function serverTypeLabel(type: RemoteSourceType): string {
  return type === 'jellyfin' ? 'Jellyfin' : 'Subsonic';
}

/** The type cards Settings › Servers opens with when adding a server. */
export function ServerTypeOptions({ onChoose }: { onChoose: (type: RemoteSourceType) => void }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.typeCards}>
      {SERVER_TYPE_OPTIONS.map((option) => (
        <AppPressable
          key={option.type}
          style={styles.typeCard}
          onPress={() => onChoose(option.type)}
          accessibilityRole="button"
        >
          <View style={styles.typeCardIcon}>
            <Ionicons name={option.icon} size={24} color={colors.accent} />
          </View>
          <View style={styles.typeCardText}>
            <Text variant="body">{option.label}</Text>
            <Text variant="caption" color={colors.textSecondary}>
              {option.description}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        </AppPressable>
      ))}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  typeCards: {
    gap: spacing.md,
  },
  typeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glassBg,
  },
  typeCardIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgTertiary,
  },
  typeCardText: {
    flex: 1,
    gap: 2,
  },
}));
