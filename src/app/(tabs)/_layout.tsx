import { useMemo, useRef } from 'react';
import { Tabs } from 'expo-router';
import { TabBar, type TabItem } from '@/components/TabBar';
import {
  TAB_TRANSITION_SETTLE_MS,
  TAB_TRANSITION_SPEC,
} from '@/navigation/tabTransition';
import { useColors } from '@/theme/themed';

export default function TabsLayout() {
  const colors = useColors();
  const lastSwitchAt = useRef(0);
  // Stable screenOptions identity: handing the navigator a fresh options object
  // mid-transition (e.g. on a Material You palette change) re-runs the scene
  // animation effect and can strand the incoming scene at opacity 0.
  const screenOptions = useMemo(
    () => ({
      headerShown: false,
      freezeOnBlur: false,
      sceneStyle: { backgroundColor: colors.bgPrimary },
      // Directional slide + cross-fade between tabs, following tab order.
      animation: 'shift' as const,
      transitionSpec: TAB_TRANSITION_SPEC,
    }),
    [colors.bgPrimary]
  );
  return (
    <Tabs
      detachInactiveScreens={false}
      screenOptions={screenOptions}
      tabBar={({ state, navigation }) => {
        const items: TabItem[] = state.routes.map((route, index) => ({
          key: route.key,
          name: route.name,
          focused: state.index === index,
        }));

        const handlePress = (item: TabItem) => {
          // Interrupting the native-driver shift animation can drop its
          // completion frame and leave the incoming scene invisible; swallow
          // taps until the current transition has finished.
          const now = Date.now();
          if (now - lastSwitchAt.current < TAB_TRANSITION_SETTLE_MS + 30) return;
          const event = navigation.emit({
            type: 'tabPress',
            target: item.key,
            canPreventDefault: true,
          });
          if (!item.focused && !event.defaultPrevented) {
            lastSwitchAt.current = now;
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
