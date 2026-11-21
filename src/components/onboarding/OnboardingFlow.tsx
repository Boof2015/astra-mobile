import { useEffect, useEffectEvent, useState } from 'react';
import { BackHandler, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useScanNotificationPermission } from '@/library/useScanNotificationPermission';
import { getShellLayout } from '@/navigation/shellLayout';
import { useLibraryStore } from '@/stores/libraryStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import type { NowPlayingScopeStyle } from '@/stores/settingsStore';
import { useColors } from '@/theme/themed';
import { ArtistImageStep } from './ArtistImageStep';
import { PlayerStep, ThemeStep } from './AppearanceSteps';
import { MusicStep } from './MusicStep';
import { NotificationStep } from './NotificationStep';
import { DonePage, WelcomePage } from './OnboardingBookends';
import { BookendBackground, OnboardingNavContext, type OnboardingNav } from './OnboardingFrame';
import { ServerStep } from './ServerStep';
import { getOnboardingLayout } from './onboardingLayout';
import {
  backFrom,
  isBookend,
  nextPage,
  progressFill,
  stepPosition,
  type OnboardingContext,
  type OnboardingPage,
} from './onboardingSteps';

/**
 * First-run wizard. Mounted by the root layout as an opaque overlay above the
 * (hidden) navigator while `onboarding_complete` is unset, so nothing in here
 * can route: every page, including the server connect form, lives inside it.
 * It drives the existing library/server/theme/settings stores and calls
 * `onDone` (→ markComplete) at the end.
 *
 * Sequencing rules live in onboardingSteps.ts, geometry in onboardingLayout.ts.
 */
export function OnboardingFlow({ onDone }: { onDone: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width, height, fontScale } = useWindowDimensions();
  const [page, setPage] = useState<OnboardingPage>('welcome');
  const [direction, setDirection] = useState<1 | -1>(1);
  const [notificationsShown, setNotificationsShown] = useState(false);
  const [busy, setBusy] = useState(false);
  // Deliberately unset until tapped, like before: skipping keeps the store default.
  const [scopeChoice, setScopeChoice] = useState<NowPlayingScopeStyle | null>(null);
  const localMusic = useLibraryStore((s) => s.folders.length > 0 || s.isScanning);
  const replaying = useOnboardingStore((s) => s.replaying);
  const notificationPermission = useScanNotificationPermission();

  const ctx: OnboardingContext = {
    localMusic,
    notificationPermission: notificationPermission.state,
    notificationsShown,
  };
  // The same "is this window short" answer the app shell gives, so the wizard
  // goes side by side exactly when the app would show its rail.
  const shortWindow = getShellLayout(width, height, insets, fontScale, false).mode === 'rail';
  const layout = getOnboardingLayout(width, height, insets, fontScale, shortWindow);

  const go = (to: OnboardingPage, towards: 1 | -1) => {
    if (to === 'notifications') setNotificationsShown(true);
    setDirection(towards);
    setPage(to);
  };

  const next = () => {
    const to = nextPage(page, ctx);
    if (to) go(to, 1);
    else onDone();
  };

  /** True when handled; false lets Android take it (first run on Welcome: the app backgrounds). */
  const back = (): boolean => {
    const result = backFrom(page, ctx, { busy });
    if (result === 'stay') return true;
    if (result === 'exit') {
      // A replay sits on top of the Troubleshooting screen; leaving must finish
      // the replay rather than reach that screen through the overlay.
      if (replaying) {
        onDone();
        return true;
      }
      return false;
    }
    go(result.page, -1);
    return true;
  };

  const onHardwareBack = useEffectEvent(() => back());
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => onHardwareBack());
    return () => subscription.remove();
  }, []);

  const nav: OnboardingNav = {
    page,
    direction,
    layout,
    progress: progressFill(page, ctx),
    position: stepPosition(page, ctx),
    next,
    back: () => {
      back();
    },
    goTo: (to) => go(to, to === 'server' ? 1 : -1),
    finish: onDone,
    setBusy,
    notificationPermission,
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.bgPrimary }]}>
      {isBookend(page) ? <BookendBackground size={layout.markGraphicSize} /> : null}
      <View
        style={[
          styles.inner,
          { paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right },
        ]}
      >
        <OnboardingNavContext.Provider value={nav}>
          {page === 'welcome' ? <WelcomePage /> : null}
          {page === 'music' ? <MusicStep /> : null}
          {page === 'server' ? <ServerStep /> : null}
          {page === 'notifications' ? <NotificationStep /> : null}
          {page === 'portraits' ? <ArtistImageStep /> : null}
          {page === 'theme' ? <ThemeStep /> : null}
          {page === 'player' ? <PlayerStep choice={scopeChoice} onChoose={setScopeChoice} /> : null}
          {page === 'done' ? <DonePage /> : null}
        </OnboardingNavContext.Provider>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: 'hidden',
  },
  inner: {
    flex: 1,
  },
});

export default OnboardingFlow;
