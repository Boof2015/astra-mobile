import { useEffect } from 'react';
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
import { useScopeLifecycle } from '@/scope/useScopeLifecycle';
import { useLibraryStore } from '@/stores/libraryStore';
import { useEQStore } from '@/stores/eqStore';
import { useAudioSettingsStore } from '@/stores/audioSettingsStore';
import { useRemoteSourcesStore } from '@/stores/remoteSourcesStore';
import { useNormalizationSync } from '@/audio/useNormalizationSync';
import { colors } from '@/theme';

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

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });

  useEffect(() => {
    if (fontsLoaded) {
      void SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

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
  }, []);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <PlaybackSync />
        <ScopeLifecycle />
        <NormalizationSync />
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
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = {
  root: { flex: 1, backgroundColor: colors.bgPrimary },
} as const;
