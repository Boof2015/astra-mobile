import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { AstraLibraryData } from '../../modules/astra-library-scanner';
import { useLibraryStore } from '@/stores/libraryStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { Album, Artist } from '@/types/library';
import {
  createHomeSpotlightController,
  createSpotlightHistory,
  HOME_SPOTLIGHT_HISTORY_KEY,
} from './homeSpotlightState';

const history = createSpotlightHistory({
  read: async () => (await AstraLibraryData.getSettings([HOME_SPOTLIGHT_HISTORY_KEY]))[HOME_SPOTLIGHT_HISTORY_KEY] ?? null,
  write: (value) => AstraLibraryData.setSettings({ [HOME_SPOTLIGHT_HISTORY_KEY]: value }),
  warn: (error) => console.warn('[home-spotlight] history unavailable', error),
});

export function useHomeSpotlight() {
  const initialized = useLibraryStore((s) => s.initialized);
  const loaded = useSettingsStore((s) => s.loaded);
  const includeSingles = useSettingsStore((s) => s.includeSingles);
  const groupingMode = useSettingsStore((s) => s.artistGroupingMode);
  const includeCollaborations = useLibraryStore((s) => s.includeCollabArtists);
  const [controller] = useState(() => createHomeSpotlightController({
    history,
    choose: (request) => AstraLibraryData.getHomeSpotlight<Album, Artist>(request),
    warn: (error) => console.warn('[home-spotlight] selection failed', error),
  }));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  useEffect(() => {
    controller.configure(initialized && loaded ? { includeSingles, groupingMode, includeCollaborations } : null);
  }, [controller, initialized, loaded, includeSingles, groupingMode, includeCollaborations]);

  useFocusEffect(useCallback(() => {
    controller.setActive(AppState.currentState === 'active');
    controller.markShown();
    const subscription = AppState.addEventListener('change', (state) => {
      controller.setActive(state === 'active');
      if (state === 'active') controller.markShown();
    });
    return () => {
      subscription.remove();
      controller.setActive(false);
    };
  }, [controller]));

  useEffect(() => {
    controller.markShown();
  }, [controller, snapshot.spotlight]);

  useEffect(() => {
    const catalog = AstraLibraryData.addListener('onCatalogChanged', controller.invalidate);
    const images = AstraLibraryData.addListener('onArtistImagesChanged', (event) => {
      const identity = controller.getSnapshot().spotlight?.identity;
      if (identity?.kind === 'artist' && ('all' in event
        || (event.groupingMode === identity.groupingMode && event.artistKey === identity.key))) {
        controller.invalidate();
      }
    });
    return () => { catalog.remove(); images.remove(); };
  }, [controller]);

  return { spotlight: snapshot.spotlight, loading: snapshot.busy, reroll: controller.reroll };
}
