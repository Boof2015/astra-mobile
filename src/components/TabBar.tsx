import { View, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { MiniPlayer } from './MiniPlayer';
import { colors, layout, spacing } from '@/theme';

type IconName = keyof typeof Ionicons.glyphMap;

export const TAB_META: Record<string, { label: string; icon: IconName }> = {
  index: { label: 'Home', icon: 'home' },
  library: { label: 'Library', icon: 'musical-notes' },
  eq: { label: 'EQ', icon: 'options' },
  settings: { label: 'Settings', icon: 'settings' },
};

export interface TabItem {
  key: string;
  name: string;
  focused: boolean;
}

interface TabBarProps {
  items: TabItem[];
  onPress: (item: TabItem) => void;
}

/**
 * Astra bottom tab bar with the persistent mini-player glued above it.
 * Receives plain props (no react-navigation types) so the typed navigation
 * logic stays in the layout's `tabBar` callback.
 */
export function TabBar({ items, onPress }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const homeFocused = items.some((item) => item.name === 'index' && item.focused);

  return (
    <View style={styles.wrap}>
      {!homeFocused ? <MiniPlayer /> : null}
      <View
        style={[
          styles.bar,
          { paddingBottom: insets.bottom, height: layout.tabBarHeight + insets.bottom },
        ]}
      >
        {items.map((item) => {
          const meta = TAB_META[item.name];
          if (!meta) return null;
          const color = item.focused ? colors.accent : colors.textTertiary;
          return (
            <Pressable
              key={item.key}
              style={styles.tab}
              onPress={() => onPress(item)}
              hitSlop={8}
              accessibilityRole="tab"
              accessibilityState={{ selected: item.focused }}
            >
              <Ionicons name={meta.icon} size={22} color={color} />
              <Text variant="caption" style={[styles.label, { color }]}>
                {meta.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.bgSecondary,
  },
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.bgSecondary,
    borderTopColor: colors.glassBorder,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.sm,
  },
  label: {
    marginTop: 2,
    fontSize: 10,
  },
});

export default TabBar;
