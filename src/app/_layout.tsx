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
  // Library tab + playback adapters get data immediately.
  useEffect(() => {
    useLibraryStore
      .getState()
      .initialize()
      .catch((err) => console.error('[library] init failed', err));
  }, []);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <PlaybackSync />
        <ScopeLifecycle />
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
