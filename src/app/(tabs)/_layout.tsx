import { Tabs } from 'expo-router';
// RN's Easing (not reanimated): the bottom-tabs scene transition runs on legacy
// Animated.timing and may use the native driver, so the easing must be serializable.
import { Easing } from 'react-native';
import { TabBar, type TabItem } from '@/components/TabBar';
import { colors } from '@/theme';

const TAB_TRANSITION_MS = 160;

export default function TabsLayout() {
  return (
    <Tabs
      detachInactiveScreens
      screenOptions={{
        headerShown: false,
        freezeOnBlur: false,
        sceneStyle: { backgroundColor: colors.bgPrimary },
        // Directional slide + cross-fade between tabs, following tab order.
        animation: 'shift',
        transitionSpec: {
          animation: 'timing',
          config: { duration: TAB_TRANSITION_MS, easing: Easing.out(Easing.cubic) },
        },
      }}
      tabBar={({ state, navigation }) => {
        const items: TabItem[] = state.routes.map((route, index) => ({
          key: route.key,
          name: route.name,
          focused: state.index === index,
        }));

        const handlePress = (item: TabItem) => {
          const event = navigation.emit({
            type: 'tabPress',
            target: item.key,
            canPreventDefault: true,
          });
          if (!item.focused && !event.defaultPrevented) {
            navigation.navigate(item.name);
          }
        };

        return <TabBar items={items} onPress={handlePress} />;
      }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="library" />
      <Tabs.Screen name="eq" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}
