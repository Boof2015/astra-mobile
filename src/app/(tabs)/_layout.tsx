import { useEffect, useMemo, useRef } from 'react';
import { Tabs } from 'expo-router';
import { TabBar, type TabItem } from '@/components/TabBar';
import { useShellLayout } from '@/navigation/useShellLayout';
import { ShellRailContext } from '@/navigation/shellRailContext';
import {
  TAB_PRESS_SWALLOW_MS,
  TAB_SCENE_ANIMATION,
  TAB_STACK_RESET_DELAY_MS,
  TAB_TRANSITION_SPEC,
} from '@/navigation/tabTransition';
import { popToTop } from '@/navigation/stackActions';
import {
  leavingStackResetTarget,
  shouldApplyStackReset,
  type TabsStateLike,
} from '@/navigation/tabStackReset';
import { emitTabReselect } from '@/navigation/tabReselect';
import { useColors } from '@/theme/themed';
import { isDisplayedTabFocused } from '@/navigation/statsTabState';

export default function TabsLayout() {
  const colors = useColors();
  const lastSwitchAt = useRef(0);
  const pendingStackReset = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (pendingStackReset.current) clearTimeout(pendingStackReset.current);
    pendingStackReset.current = null;
  }, []);

  // Landscape moves navigation to a rail down the leading edge and hands the
  // scene back the ~152dp the tab bar and mini player were costing it. The
  // navigator does the reflow itself: `tabBarPosition: 'left'` flips its
  // container to a row and renders the tab-bar element ahead of the scenes,
  // so no screen has to know about any of this.
  // Must be the hook, not a bare getShellLayout(window): the dock takes width
  // off the trailing edge, so this navigator lives in a narrower column than
  // the window. Sizing to the window left the bar's cards too wide and left it
  // still rendering a mini player the dock had replaced.
  const shell = useShellLayout();
  const tabBarPosition = shell.mode === 'rail' ? ('left' as const) : ('bottom' as const);
  // Stable screenOptions identity: handing the navigator a fresh options object
  // mid-transition (e.g. on a Material You palette change) re-runs the scene
  // animation effect and can strand the incoming scene at opacity 0. The
  // position belongs in here, but it only changes on rotation — never during a
  // tab switch — so it is safe as a dependency.
  const screenOptions = useMemo(
    () => ({
      headerShown: false,
      freezeOnBlur: false,
      sceneStyle: { backgroundColor: colors.bgPrimary },
      // Retained scenes cross-fade without translating two full pages.
      animation: TAB_SCENE_ANIMATION,
      transitionSpec: TAB_TRANSITION_SPEC,
      tabBarPosition,
    }),
    [colors.bgPrimary, tabBarPosition]
  );
  return (
    // Tells every scene below that the rail is already standing in the leading
    // cutout's way, so `Screen` pays only the trailing inset. Screens outside
    // this navigator get the default `false` and pay both.
    <ShellRailContext.Provider value={shell.mode === 'rail'}>
      <Tabs
        detachInactiveScreens={false}
        screenOptions={screenOptions}
        tabBar={({ state, navigation }) => {
          const activeRouteName = state.routes[state.index]?.name;
          const items: TabItem[] = state.routes.map((route, index) => ({
            key: route.key,
            name: route.name,
            focused: isDisplayedTabFocused(
              route.name,
              index,
              state.index,
              activeRouteName,
            ),
          }));

          const handlePress = (item: TabItem) => {
            // Interrupting the native-driver scene animation can drop its
            // completion frame and leave the incoming scene invisible; swallow
            // taps until the current transition has finished.
            const now = Date.now();
            if (now - lastSwitchAt.current < TAB_PRESS_SWALLOW_MS) return;
            const event = navigation.emit({
              type: 'tabPress',
              target: item.key,
              canPreventDefault: true,
            });
            if (event.defaultPrevented) return;

            const actuallyFocused = state.routes[state.index]?.key === item.key;
            if (actuallyFocused) {
              // Re-tapping the active tab resets its nested stack. This is the
              // one-tap escape from a deep library chain (artist → album →
              // another artist), which is why back itself only pops one level.
              const nested = state.routes[state.index]?.state;
              if (nested?.key && (nested.index ?? 0) > 0) {
                navigation.dispatch({ ...popToTop(), target: nested.key });
                // Escaping the chain is the whole press; the list underneath
                // keeps the place the user left it in.
                return;
              }
              // Already at this tab's root, so the press means "top of the
              // list" — which is also the only offset where pull-to-search arms.
              emitTabReselect(item.name);
              return;
            }

            // Rewind the tab being *left*, after the fade rather than on the way
            // in; see `tabStackReset` for why arrival is the wrong side of the
            // transition. Read before navigating, while `state` still describes
            // the tab we are leaving.
            const resetTarget = leavingStackResetTarget(state);
            lastSwitchAt.current = now;
            navigation.navigate(item.name);
            if (!resetTarget) return;

            if (pendingStackReset.current) clearTimeout(pendingStackReset.current);
            pendingStackReset.current = setTimeout(() => {
              pendingStackReset.current = null;
              const current = navigation.getState() as TabsStateLike | undefined;
              if (!shouldApplyStackReset(current, resetTarget)) return;
              // A targeted action bubbles to the root and back down through every
              // mounted navigator, focused or not — which holds only because this
              // navigator keeps inactive scenes attached and unfrozen
              // (`detachInactiveScreens={false}` + `freezeOnBlur: false` below).
              navigation.dispatch({ ...popToTop(), target: resetTarget });
            }, TAB_STACK_RESET_DELAY_MS);
          };

          return <TabBar items={items} onPress={handlePress} shell={shell} />;
        }}
      >
        <Tabs.Screen name="index" />
        <Tabs.Screen name="library" />
        <Tabs.Screen name="eq" />
        <Tabs.Screen name="settings" />
        <Tabs.Screen name="stats" options={{ href: null }} />
      </Tabs>
    </ShellRailContext.Provider>
  );
}
