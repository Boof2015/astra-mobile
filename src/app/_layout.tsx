import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
} from '@expo-google-fonts/jetbrains-mono';
import { usePlaybackSync } from '@/audio/usePlaybackSync';
import { QuickSearchOverlay } from '@/components/search/QuickSearchOverlay';
import { useScopeLifecycle } from '@/scope/useScopeLifecycle';
import { useLibraryStore } from '@/stores/libraryStore';
import { useEQStore } from '@/stores/eqStore';
import { useAudioSettingsStore } from '@/stores/audioSettingsStore';
import { useRemoteSourcesStore } from '@/stores/remoteSourcesStore';
import { useLastFmSettingsStore } from '@/stores/lastFmSettingsStore';
import { useDesktopRemoteStore } from '@/stores/desktopRemoteStore';
import { useNormalizationSync } from '@/audio/useNormalizationSync';
import { useLastFmScrobbler } from '@/audio/useLastFmScrobbler';
import {
  clearDesktopRemoteMediaSession,
  setDesktopRemoteMediaSession,
  subscribeDesktopRemoteMediaSessionCommands,
} from '@/services/desktopRemoteMediaSession';
import { colors } from '@/theme';

// Anchor the root stack at the tabs so a deep link straight to a top-level route (the
// widget/notification opening `now-playing`, or `recently-played`) builds `[(tabs), route]`
// instead of just `[route]`. Without this, dismissing the now-playing modal pops to an empty
// stack → blank screen. Only affects deep-link/launch ordering; normal nav is unchanged.
export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

/** Mirrors RNTP state into the player store. Renders nothing. */
function PlaybackSync() {
  usePlaybackSync();
  return null;
}

/** Owns the visualizer on/off gate (foreground + playing + motion). Renders nothing. */
function ScopeLifecycle() {
  useScopeLifecycle();
  return null;
}

/** Pushes per-track normalization gain to native on track/settings change. */
function NormalizationSync() {
  useNormalizationSync();
  return null;
}

/** Feeds playback snapshots to the Last.fm scrobble service. Renders nothing. */
function LastFmScrobbler() {
  useLastFmScrobbler();
  return null;
}

/** Mirrors Desktop Remote now-playing into a separate Android MediaSession. */
function DesktopRemoteMediaSessionSync() {
  const connection = useDesktopRemoteStore((s) => s.connection);
  const connectionState = useDesktopRemoteStore((s) => s.connectionState);
  const snapshot = useDesktopRemoteStore((s) => s.snapshot);
  const sendControl = useDesktopRemoteStore((s) => s.sendControl);

  useEffect(() => {
    const subscription = subscribeDesktopRemoteMediaSessionCommands((event) => {
      if (event.command === 'toggle-play') {
        const playing = useDesktopRemoteStore.getState().snapshot?.playbackState === 'playing';
        void useDesktopRemoteStore.getState().sendControl(playing ? 'pause' : 'play');
        return;
      }
      if (event.command === 'stop') {
        void useDesktopRemoteStore.getState().sendControl('pause');
        return;
      }
      if (event.command === 'seek') {
        void useDesktopRemoteStore.getState().sendControl('seek', event.position);
        return;
      }
      void useDesktopRemoteStore.getState().sendControl(event.command);
    });
    return () => subscription.remove();
  }, [sendControl]);

  useEffect(() => {
    if (!connection || connectionState === 'unpaired') {
      clearDesktopRemoteMediaSession();
      return;
    }
    setDesktopRemoteMediaSession(snapshot, connection);
  }, [connection, connectionState, snapshot]);

  useEffect(() => clearDesktopRemoteMediaSession, []);

  return null;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });

  // Failsafe so the splash can never hang the UI blank. `preventAutoHideAsync` runs at
  // module scope — including in the headless JS context Android Auto spins up — so when
  // the process is started from the car first and the app is opened later, the normal
  // "hide once fonts load" path can get stuck. Render (and hide the splash) anyway after
  // a short timeout even if fonts haven't reported in.
  const [splashTimedOut, setSplashTimedOut] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSplashTimedOut(true), 2000);
    return () => clearTimeout(timer);
  }, []);
  const ready = fontsLoaded || splashTimedOut;

  useEffect(() => {
    if (ready) {
      void SplashScreen.hideAsync().catch(() => {});
    }
  }, [ready]);

  // Eager library init: SQLite open + initial reads are tens of ms, and the
  // Library tab + playback adapters get data immediately. EQ + audio settings load
  // alongside so the native EQ/gain reflect persisted prefs from the first play.
  useEffect(() => {
    useLibraryStore
      .getState()
      .initialize()
      .catch((err) => console.error('[library] init failed', err));
    useEQStore
      .getState()
      .load()
      .catch((err) => console.error('[eq] load failed', err));
    useAudioSettingsStore
      .getState()
      .load()
      .catch((err) => console.error('[audioSettings] load failed', err));
    // Remote sources: load server rows + hydrate the URL registry from cached
    // config/token (no network on launch). Runs after library init reads first.
    useRemoteSourcesStore
      .getState()
      .init()
      .catch((err) => console.error('[remoteSources] init failed', err));
    // Last.fm: construct the scrobble service + drain any persisted offline queue,
    // even if the user never opens the settings screen this session.
    useLastFmSettingsStore
      .getState()
      .init()
      .catch((err) => console.error('[lastfm] init failed', err));
  }, []);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <PlaybackSync />
        <ScopeLifecycle />
        <NormalizationSync />
        <LastFmScrobbler />
        <DesktopRemoteMediaSessionSync />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bgPrimary },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="now-playing"
            options={{
              presentation: 'transparentModal',
              animation: 'none',
              gestureEnabled: false,
              contentStyle: { backgroundColor: 'transparent' },
            }}
          />
        </Stack>
        <QuickSearchOverlay />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = {
  root: { flex: 1, backgroundColor: colors.bgPrimary },
} as const;
