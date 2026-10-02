import { useSyncExternalStore } from 'react';
import { requireOptionalNativeModule, type NativeModule } from 'expo-modules-core';

export interface DiscordPreferences {
  coverArtEnabled: boolean;
  smallIconEnabled: boolean;
  compactStatusMode: 'title' | 'artist';
  expandedInfoMode: 'file-info' | 'album';
  linkDestination: 'off' | 'ytmusic' | 'lastfm';
  pauseClearMinutes: number;
}

export interface DiscordStatus {
  available: boolean;
  enabled: boolean;
  state: 'off' | 'idle' | 'waiting' | 'updating' | 'active' | 'unavailable' | 'error';
  message: string;
  lastUpdatedAt: number | null;
  settings: DiscordPreferences;
  artworkState: 'idle' | 'loading' | 'found' | 'not-found' | 'unavailable';
  artworkProvider: string | null;
}

declare class DiscordModule extends NativeModule<{ onStatus: (status: DiscordStatus) => void }> {
  available: boolean;
  getStatus(): DiscordStatus;
  readLegalDocument(id: string): Promise<string>;
  setEnabled(enabled: boolean): Promise<DiscordStatus>;
  configure(options: Partial<DiscordPreferences> & { enabled?: boolean }): Promise<DiscordStatus>;
  clearArtworkCache(): Promise<DiscordStatus>;
}

const native = requireOptionalNativeModule<DiscordModule>('AstraDiscord');
export const discordAvailable = native?.available ?? false;
const unavailable: DiscordStatus = {
  available: false, enabled: false, state: 'off',
  message: 'Discord presence is not included in this build.', lastUpdatedAt: null,
  settings: {
    coverArtEnabled: false, smallIconEnabled: true, compactStatusMode: 'title',
    expandedInfoMode: 'file-info', linkDestination: 'ytmusic', pauseClearMinutes: 5,
  },
  artworkState: 'idle', artworkProvider: null,
};

let cached = native?.getStatus() ?? unavailable;
const listeners = new Set<() => void>();
function receive(next: DiscordStatus) {
  if (JSON.stringify(next) === JSON.stringify(cached)) return;
  cached = next;
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const subscription = native?.addListener('onStatus', receive);
  receive(native?.getStatus() ?? unavailable);
  return () => { listeners.delete(listener); subscription?.remove(); };
}
const getSnapshot = () => cached;

export function useDiscordStatus() {
  const status = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const configure = async (options: Partial<DiscordPreferences> & { enabled?: boolean }) => {
    try {
      if (native) receive(await native.configure(options));
    } catch {
      receive({ ...cached, state: 'error', message: 'Could not update Discord settings. Please try again.' });
    }
  };
  const clearArtworkCache = async () => {
    if (native) receive(await native.clearArtworkCache());
  };
  return { status, setEnabled: (enabled: boolean) => configure({ enabled }), configure, clearArtworkCache };
}

export const legalDocuments = [
  { id: 'gpl', title: 'GNU GPL v3', readerTitle: 'GNU GPL v3' },
  { id: 'discord-exception', title: 'Discord Linking Exception', readerTitle: 'Linking Exception' },
  ...(discordAvailable ? [
    { id: 'discord-sdk', title: 'Discord SDK Notice', readerTitle: 'Discord SDK' },
    { id: 'discord-third-party', title: 'Discord SDK Third-party Notices', readerTitle: 'SDK Notices' },
  ] : []),
];

export async function readLegalDocument(id: string): Promise<string> {
  if (!native || !legalDocuments.some((document) => document.id === id)) {
    throw new Error('This legal document is unavailable in this build.');
  }
  return native.readLegalDocument(id);
}
