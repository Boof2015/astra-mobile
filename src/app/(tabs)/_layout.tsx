import { useMemo, useRef } from 'react';
import { Tabs } from 'expo-router';
import { TabBar, type TabItem } from '@/components/TabBar';
import {
  TAB_SCENE_ANIMATION,
  TAB_TRANSITION_SETTLE_MS,
  TAB_TRANSITION_SPEC,
} from '@/navigation/tabTransition';
import { popToTop } from '@/navigation/stackActions';
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
      // Retained scenes cross-fade without translating two full pages.
      animation: TAB_SCENE_ANIMATION,
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
          // Interrupting the native-driver scene animation can drop its
          // completion frame and leave the incoming scene invisible; swallow
          // taps until the current transition has finished.
          const now = Date.now();
          if (now - lastSwitchAt.current < TAB_TRANSITION_SETTLE_MS + 30) return;
          const event = navigation.emit({
            type: 'tabPress',
            target: item.key,
            canPreventDefault: true,
          });
          if (event.defaultPrevented) return;

          if (item.focused) {
            // Re-tapping the active tab resets its nested stack. This is the
            // one-tap escape from a deep library chain (artist → album →
            // another artist), which is why back itself only pops one level.
            const nested = state.routes[state.index]?.state;
            if (nested?.key && (nested.index ?? 0) > 0) {
              navigation.dispatch({ ...popToTop(), target: nested.key });
            }
            return;
          }

          lastSwitchAt.current = now;
          navigation.navigate(item.name);
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
