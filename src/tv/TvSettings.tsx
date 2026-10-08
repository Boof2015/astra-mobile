import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Keyboard, Linking, View } from 'react-native';
import Constants from 'expo-constants';
import QRCode from 'react-native-qrcode-svg';
import { AstraAudioRoute } from '../../modules/astra-audio-route';
import { AstraLibraryData } from '../../modules/astra-library-scanner';
import { legalDocuments, readLegalDocument, useDiscordStatus } from '../../modules/astra-discord';
import { useThemeStore } from '@/stores/themeStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAudioSettingsStore } from '@/stores/audioSettingsStore';
import { useLibraryStore } from '@/stores/libraryStore';
import { useLyricsSettingsStore } from '@/stores/lyricsSettingsStore';
import { useLyricsStore } from '@/stores/lyricsStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useSleepTimerStore } from '@/stores/sleepTimerStore';
import { useRemoteSourcesStore } from '@/stores/remoteSourcesStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useLastFmSettingsStore } from '@/stores/lastFmSettingsStore';
import { usePlaybackTargetStore } from '@/stores/playbackTargetStore';
import { requestLastFmFlush } from '@/services/lastfm';
import type { RemoteSourceRow } from '@/types/remote';
import type { LastFmProfileStatus } from '@/types/lastFm';
import { useEQStore } from '@/stores/eqStore';
import { ACCENTS, ACCENT_IDS } from '@/theme/accents';
import { clearAllLyricsCache } from '@/lyrics/lyrics';
import { clearAllWaveformCache } from '@/scope/waveform';
import { pauseListeningHistoryTracking, resumeListeningHistoryTracking } from '@/audio/listeningHistoryTracker';
import { notifyListeningHistoryChanged } from '@/listeningStats/events';
import { createBuildInfo } from '@/release/buildInfo';
import { capabilityList, formatChannels, formatDiagnosticFormat, formatDiagnosticSource, formatEncoding, formatSampleRate, outputDescription, type AudioDiagnosticsSnapshot } from '@/audio/audioDiagnostics';
import { TvButton, TvFocusRegion, useTvActive, useTvFocus } from './TvFocus';
import { useTvBackHandler } from './TvBack';
import { TvNameFlow } from './TvNameFlow';
import { TvServiceForm, type ServiceForm } from './TvServiceForm';
import { TvScrobbleAuth } from './TvScrobbleAuth';
import { TvStorageProbe } from './TvStorageProbe';
import { TvMusicPicker } from './TvMusicPicker';
import { TvSettingsRows, settingsRowId, type SettingsRow } from './TvSettingsRows';
import { adjustSetting, settingsEntry, settingsTextPages } from './settingsModel';
import { box, TvText } from './TvPrimitives';
import { useTvTheme } from './useTvTheme';
import type { TvActions } from './tvCollections';

const categories = [
  ['Appearance', 'Theme and colors'], ['Library', 'Folders, scanning and how albums group'],
  ['Audio', 'Output, loudness and gain'], ['Playback', 'Sleep timer and listening history'],
  ['Lyrics', 'Lookup, timing and translations'], ['Services', 'Servers, scrobbling and Discord'],
  ['Troubleshooting', 'Library maintenance and caches'], ['Info', 'About Astra'],
] as const;
const sectionId = (index: number) => `settings:section:${index}`;
type Page = { key: string; title: string; description: string; opener: string; text?: string };
type Flow = { kind: 'languages'; opener: string } | { kind: 'link'; title: string; url: string; opener: string }
  | { kind: 'music-picker'; opener: string } | { kind: 'server-name'; source: RemoteSourceRow; opener: string }
  | { kind: 'service'; form: ServiceForm; opener: string } | { kind: 'auth'; profileId: string; opener: string } | { kind: 'storage-probe'; opener: string };
const build = createBuildInfo(Constants.expoConfig);

function useMaintenance(scanning: boolean) {
  const [busy, setBusy] = useState<string | null>(null); const busyRef = useRef(false);
  const [feedback, setFeedback] = useState('');
  const operation = useCallback((id: string, action: () => Promise<void>, success: string) => {
    if (busyRef.current || scanning) return;
    busyRef.current = true; setBusy(id); setFeedback('');
    void action().then(() => {
      const error = useLibraryStore.getState().scanError;
      if ((id === 'scan' || id === 'rebuild') && error) throw new Error(error);
      setFeedback(success);
    }).catch(error => setFeedback(error instanceof Error ? error.message : 'That action could not be completed.')).finally(() => { busyRef.current = false; setBusy(null); });
  }, [scanning]);
  return { busy, feedback, setFeedback, operation };
}

export function TvSettings({ actions, setEntry, setImmersive }: { actions: TvActions; setEntry: (id: string) => void; setImmersive: (value: boolean) => void }) {
  const tv = useTvTheme(); const active = useTvActive(); const { focused, request } = useTvFocus();
  const [section, setSection] = useState(0); const [history, setHistory] = useState<Page[]>([]);
  const [memory, setMemory] = useState<Record<string, string>>({}); const [grab, setGrab] = useState<string | null>(null);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [document, setDocument] = useState<{ key: string; pages: string[] } | null>(null);
  const [textPage, setTextPage] = useState(0); const [diagnostics, setDiagnostics] = useState<AudioDiagnosticsSnapshot | null>(null);
  const theme = useThemeStore(); const settings = useSettingsStore(); const audio = useAudioSettingsStore();
  const library = useLibraryStore(); const lyrics = useLyricsSettingsStore(); const timer = useSleepTimerStore();
  const { busy, feedback, setFeedback, operation } = useMaintenance(library.isScanning);
  const remote = useRemoteSourcesStore(); const sources = remote.sources; const lastfm = useLastFmSettingsStore(); const discord = useDiscordStatus();
  const track = usePlayerStore(s => s.currentTrack); const localPlayback = usePlaybackTargetStore(s => s.target === 'phone');
  const output = useEQStore(s => s.activeOutputRoute);
  const leaf = history.at(-1); const page = leaf?.key ?? `category:${section}`;
  const isLicense = !!leaf?.key.startsWith('license:');
  const isDocument = isLicense || leaf?.text !== undefined;
  const pages = leaf?.text !== undefined ? settingsTextPages(leaf.text) : document?.key === page ? document.pages : ['Loading…'];
  const { light, menu, run } = actions;
  useEffect(() => { if (active) light(null); }, [active, light]);
  useEffect(() => { setEntry(leaf ? 'settings:back' : sectionId(section)); }, [section, leaf, setEntry]);
  useEffect(() => { setImmersive(!!flow); return () => setImmersive(false); }, [flow, setImmersive]);
  useEffect(() => { if (flow?.kind === 'link') request('settings:link:done'); }, [flow?.kind, request]);
  useEffect(() => {
    if (!active || leaf?.key !== 'advanced-audio') return;
    const read = () => { if (AppState.currentState !== 'active') return; try { setDiagnostics(AstraAudioRoute.getAudioDiagnostics()); } catch { setDiagnostics(null); } };
    read(); const interval = setInterval(read, 1000); return () => clearInterval(interval);
  }, [active, leaf?.key]);
  useEffect(() => {
    if (!isLicense || !leaf) return;
    let current = true; const key = leaf.key;
    void readLegalDocument(key.slice(8)).then(text => { if (current) setDocument({ key, pages: settingsTextPages(text) }); }, () => {
      if (current) setDocument({ key, pages: ['This document could not be loaded. The license files are also available in Astra’s GitHub repository.'] });
    });
    return () => { current = false; };
  }, [leaf, isLicense]);
  const closeFlow = () => { if (!flow) return; Keyboard.dismiss(); setFlow(null); request(flow.opener); };
  const backPage = () => { if (!leaf) return; setHistory(previous => previous.slice(0, -1)); setTextPage(0); request(leaf.opener); };
  useTvBackHandler(active, () => {
    if (flow?.kind === 'service' || flow?.kind === 'auth' || flow?.kind === 'storage-probe' || flow?.kind === 'music-picker') return false;
    if (flow) { if (Keyboard.isVisible()) Keyboard.dismiss(); else closeFlow(); return true; }
    if (grab) { setGrab(null); return true; }
    if (leaf) { backPage(); return true; }
    return false;
  });
  const open = (key: string, title: string, description = '', text?: string) => {
    setFeedback(''); setTextPage(0); setHistory(previous => [...previous, { key, title, description, opener: focused, text }]); request('settings:back');
  };

  const confirm = (title: string, message: string, label: string, action: () => void) => menu({ title, message, opener: focused, left: 659, top: 180, items: [
    { label: 'Cancel', run: () => {} }, { label, run: action },
  ] });
  const external = (title: string, url: string) => setFlow({ kind: 'link', title, url, opener: focused });
  const change = (action: () => Promise<unknown>) => run(async () => { await action(); });
  const sleep = (action: () => Promise<void>) => change(async () => {
    try { await action(); } catch (error) {
      if (error instanceof Error && error.message === 'Start phone playback before setting a sleep timer.') throw new Error('Start playback on this TV before setting a sleep timer.');
      if (error instanceof Error && error.message === 'Sleep timers are available for phone playback only.') throw new Error('Sleep timers are available for playback on this TV.');
      throw error;
    }
  });
  const toggle = (id: string, label: string, on: boolean, set: (next: boolean) => Promise<unknown> | void, sub?: string, disabled = false): SettingsRow =>
    ({ id, label, kind: 'toggle', on, sub, disabled, run: () => change(async () => set(!on)) });
  const choice = (id: string, label: string, value: string, choices: Extract<SettingsRow, { kind: 'choice' }>['choices'], disabled = false): SettingsRow => ({ id, label, kind: 'choice', value, choices, disabled });
  const link = (id: string, label: string, fn: () => void, value?: string, sub?: string, disabled = false): SettingsRow => ({ id, label, kind: 'link', run: fn, value, sub, disabled });
  const maintenance = (id: string, label: string, fn: () => Promise<void>, success: string, sub?: string): SettingsRow => ({ id, label, kind: 'action', run: () => operation(id, fn, success), sub: busy === id ? 'Working…' : sub, disabled: busy !== id && (!!busy || library.isScanning) });
  const readout = (id: string, label: string, value: string, sub?: string) => link(id, label, () => open(`readout:${id}`, label, sub ?? '▲ ▼ page through details · Back returns', value), value, sub);
  const scan = maintenance('scan', 'Scan for Changes', () => useLibraryStore.getState().rescan(), 'Library scan complete.', 'Rescan configured music folders.');
  const openServer = (source: RemoteSourceRow) => open(`server:${source.id}`, source.name, source.type === 'jellyfin' ? 'Jellyfin connection' : 'Subsonic connection');
  const openProfile = (profile: LastFmProfileStatus) => open(`profile:${profile.id}`, profile.name, profile.protocolLabel);
  const updateScrobbling = async (action: () => ReturnType<typeof lastfm.setEnabled>) => {
    const result = await action(); if (!result || result.lastError) throw new Error(result?.lastError || useLastFmSettingsStore.getState().errorMessage || 'Could not update scrobbling.');
  };
  const serviceSaved = (id: string | number) => {
    if (flow?.kind !== 'service') return;
    const form = flow.form;
    if ((form.kind === 'server' && form.source) || (form.kind === 'scrobbler' && form.profile)) {
      const name = form.kind === 'server' ? useRemoteSourcesStore.getState().sources.find(item => item.id === id)?.name : useLastFmSettingsStore.getState().status?.profiles.find(item => item.id === id)?.name;
      if (name) setHistory(previous => previous.map((entry, i) => i === previous.length - 1 ? { ...entry, title: name } : entry));
      closeFlow(); return;
    }
    const server = form.kind === 'server';
    const item = server ? useRemoteSourcesStore.getState().sources.find(source => source.id === id) : useLastFmSettingsStore.getState().status?.profiles.find(profile => profile.id === id);
    if (!item) { closeFlow(); return; }
    setFlow(null);
    setHistory(previous => [...previous.slice(0, -1), { key: `${server ? 'server' : 'profile'}:${id}`, title: item.name, description: server ? 'Server connection' : 'Scrobbling destination', opener: settingsRowId(server ? 'servers' : 'lastfm', `${server ? 'source' : 'profile'}:${id}`) }]);
    request('settings:back');
  };
  const sectionRows: SettingsRow[][] = [
    [choice('theme', 'Theme', ({ midnight: 'Midnight', dark: 'Dark', amoled: 'AMOLED', light: 'Light', system: 'System', materialYou: 'Material You' })[theme.baseTheme],
      (['midnight', 'dark', 'amoled', 'light'] as const).map(id => ({ label: ({ midnight: 'Midnight', dark: 'Dark', amoled: 'AMOLED', light: 'Light' })[id], selected: theme.baseTheme === id, run: () => change(() => theme.setBaseTheme(id)) }))),
    choice('accent', 'Accent color', theme.accentPreference.kind === 'preset' ? ACCENTS[theme.accentPreference.id].label : 'Custom', ACCENT_IDS.map(id => ({ label: ACCENTS[id].label, swatch: ACCENTS[id].base, selected: theme.accentPreference.kind === 'preset' && theme.accentPreference.id === id, run: () => change(() => theme.setAccent(id)) }))),
    choice('playing-accent', 'Now Playing accent', theme.nowPlayingAccentSource === 'cover-art' ? 'From artwork' : 'App accent', [
      { label: 'From artwork', selected: theme.nowPlayingAccentSource === 'cover-art', run: () => change(() => theme.setNowPlayingAccentSource('cover-art')) },
      { label: 'App accent', selected: theme.nowPlayingAccentSource === 'app', run: () => change(() => theme.setNowPlayingAccentSource('app')) },
    ])],
    [link('folders', 'Music folders', () => open('folders', 'Music folders', 'Configured local music folders'), `${library.folders.length} folders`), { ...scan, label: 'Rescan all' },
    { ...choice('portraits', 'Artist portraits', ({ wifi: 'Wi-Fi or Ethernet', any: 'Any network', off: 'Off' })[settings.artistImageAutoPolicy],
      (['wifi', 'any', 'off'] as const).map(policy => ({ label: ({ wifi: 'Wi-Fi or Ethernet', any: 'Any network', off: 'Off' })[policy], selected: settings.artistImageAutoPolicy === policy,
        run: () => change(async () => { await settings.setArtistImageAutoPolicy(policy); await settings.acknowledgeArtistImageDisclosure(); }) }))), sub: 'Photos from Deezer · only artist names are sent' },
    toggle('singles', 'Show singles in Albums', settings.includeSingles, settings.setIncludeSingles),
    toggle('collaborators', 'Show collaborator-only artists', library.includeCollabArtists, library.setIncludeCollabArtists, undefined, settings.artistGroupingMode !== 'astra'),
    choice('grouping', 'Artist grouping', settings.artistGroupingMode === 'astra' ? 'Astra Resolve' : 'File tags', (['astra', 'fileTags'] as const).map(mode => ({ label: mode === 'astra' ? 'Astra Resolve' : 'File tags', selected: settings.artistGroupingMode === mode, run: () => change(() => settings.setArtistGroupingMode(mode)) }))),
    ...(__DEV__ ? [link('storage-probe', 'Local audio test', () => setFlow({ kind: 'storage-probe', opener: focused }), undefined, 'Developer probe · Android 13+')] : [])],
    [link('output', 'Audio output', () => open('output', 'Audio output', 'Current output and the TV’s sound settings'), output?.kind === 'speaker' ? 'TV speakers' : output?.label ?? 'Not reported'),
    toggle('normalization', 'Loudness normalization', audio.normalizationEnabled, audio.setNormalizationEnabled),
    { id: 'target', kind: 'value', label: 'Target', amount: audio.normalizationTargetLufs, value: `${audio.normalizationTargetLufs} LUFS`, min: -30, max: -5, disabled: !audio.normalizationEnabled, set: value => change(() => audio.setNormalizationTargetLufs(value)) },
    toggle('replaygain', 'ReplayGain', audio.replayGainEnabled, audio.setReplayGainEnabled),
    choice('replaygain-mode', 'ReplayGain mode', ({ auto: 'Automatic', track: 'Track', album: 'Album' })[audio.replayGainMode], (['auto', 'track', 'album'] as const).map(mode => ({ label: ({ auto: 'Automatic', track: 'Track', album: 'Album' })[mode], selected: audio.replayGainMode === mode, run: () => change(() => audio.setReplayGainMode(mode)) })), !audio.replayGainEnabled),
    link('advanced', 'Advanced', () => open('advanced-audio', 'Advanced audio', 'Playback formats, device capabilities and processing details'))],
    [choice('sleep', 'Sleep timer', timer.timer?.mode === 'end-of-track' ? 'End of track' : timer.timer ? `${Math.max(1, Math.ceil((timer.remainingMs ?? 0) / 60000))} min remaining` : 'Off', [
      { label: 'Off', selected: !timer.timer, run: () => sleep(timer.cancel) },
      ...[15, 30, 45, 60].map(minutes => ({ label: minutes === 60 ? '1 hour' : `${minutes} min`, selected: timer.timer?.mode === 'minutes' && timer.timer.durationMinutes === minutes, run: () => sleep(() => timer.startMinutes(minutes)) })),
      { label: 'End of track', selected: timer.timer?.mode === 'end-of-track', run: () => sleep(timer.startEndOfTrack) },
    ], !timer.timer && (!track || !localPlayback)),
    toggle('history', 'Listening History', settings.listeningHistoryEnabled, settings.setListeningHistoryEnabled, 'Record listening time and qualified plays on this TV.'),
    { id: 'clear-history', label: 'Clear Detailed Listening History', kind: 'action', run: () => confirm('Clear listening history?', 'Removes detailed listening time and rankings. Play counts, recents, favorites and playlists are kept.', 'Clear history', () => operation('clear-history', async () => {
      await pauseListeningHistoryTracking(); try { await AstraLibraryData.clearDetailedListeningHistory(); notifyListeningHistoryChanged(); } finally { if (useSettingsStore.getState().listeningHistoryEnabled) resumeListeningHistoryTracking(); }
    }, 'Detailed listening history cleared.')), disabled: busy !== 'clear-history' && (!!busy || library.isScanning) }],
    [toggle('lookup', 'Online lookup', lyrics.onlineLookupEnabled, async enabled => {
      await lyrics.setOnlineLookupEnabled(enabled);
      if (enabled && Object.values(useLyricsStore.getState().byPath).some(entry => entry.result?.status === 'not_found' && entry.result.reason === 'online-disabled')) {
        useLyricsStore.getState().invalidateAll(); await useLyricsStore.getState().loadForTrack(usePlayerStore.getState().currentTrack);
      }
    }), toggle('timing', 'Word timing', lyrics.wordTimingEnabled, lyrics.setWordTimingEnabled),
    toggle('furigana', 'Furigana', lyrics.furiganaEnabled, lyrics.setFuriganaEnabled), toggle('translations', 'Translations', lyrics.translationsEnabled, lyrics.setTranslationsEnabled),
    toggle('voices', 'Voice labels', lyrics.voiceLabelsEnabled, lyrics.setVoiceLabelsEnabled),
    link('languages', 'Translation priority', () => setFlow({ kind: 'languages', opener: focused }), lyrics.translationPriority.join(', '), 'Preferred language tags', !lyrics.translationsEnabled)],
    [link('servers', 'Subsonic / Jellyfin servers', () => open('servers', 'Music servers', 'Add and manage Subsonic and Jellyfin connections'), `${sources.length} servers`),
    link('lastfm', 'Scrobbling', () => open('lastfm', 'Scrobbling', 'Connect Last.fm, ListenBrainz or another scrobbling service'), lastfm.status?.profiles.some(profile => profile.connected) ? 'Connected' : 'Set up'),
    toggle('discord', 'Discord Rich Presence', discord.status.enabled, discord.setEnabled, discord.status.available ? 'Show what you’re listening to on your profile.' : 'Not included in this build.', !discord.status.available)],
    [scan, { id: 'rebuild', label: 'Rebuild Local Library Index', kind: 'action', sub: busy === 'rebuild' ? 'Working…' : undefined, disabled: busy !== 'rebuild' && (!!busy || library.isScanning), run: () => { if (!busy) confirm('Rebuild library index?', 'Re-read local track metadata. Folders, playlists, favorites, history and remote sources are kept.', 'Rebuild', () => operation('rebuild', () => useLibraryStore.getState().rebuildLocalIndex(), 'Local library index rebuilt.')); } },
    maintenance('lyrics', 'Clear Lyrics Cache', async () => { await clearAllLyricsCache(); useLyricsStore.getState().invalidateAll(); }, 'Lyrics cache cleared.', 'Display preferences are kept.'),
    maintenance('waveforms', 'Clear Waveform Cache', clearAllWaveformCache, 'Waveform cache cleared.', 'Tracks recompute on their next load.'),
    link('onboarding', 'Replay Onboarding', () => confirm('Replay setup?', 'Review music sources and appearance. Your existing library and settings are kept.', 'Start setup', () => change(() => useOnboardingStore.getState().reset())))],
    [link('github', 'GitHub Repository', () => external('GitHub Repository', 'https://github.com/Boof2015/astra-mobile'), 'Boof2015/astra-mobile'),
    link('privacy', 'Privacy Policy', () => external('Privacy Policy', 'https://github.com/Boof2015/astra-mobile/blob/main/PRIVACY.md')),
    link('licenses', 'Licenses', () => open('licenses', 'Licenses', 'Read bundled license texts offline')),
    ...(build.showExternalSupportLink ? [link('support', 'Ko-fi', () => external('Support Astra', 'https://ko-fi.com/boof2015'), 'ko-fi.com/boof2015')] : []),
    link('about', 'About Astra', () => open('about', 'About Astra', `Version ${build.versionLabel}`), build.versionLabel)],
  ];
  let rows = sectionRows[section]; let empty = '';
  if (leaf?.key === 'folders') {
    rows = [link('choose', 'Choose music folders', () => setFlow({ kind: 'music-picker', opener: focused }), undefined, 'Internal storage and USB drives', library.isScanning),
      ...library.folders.map(folder => link(String(folder.id), folder.display_name, () => open(`folder:${folder.id}`, folder.display_name, 'Local music source'), `${folder.track_count} tracks`, folder.available ? 'Available' : 'Storage or music permission unavailable'))];
    empty = 'No music folders configured.';
  } else if (leaf?.key.startsWith('folder:')) {
    const folder = library.folders.find(item => `folder:${item.id}` === leaf.key);
    rows = folder ? [readout('status', 'Status', folder.available ? 'Available' : 'Unavailable'),
      readout('tracks', 'Tracks', String(folder.track_count)), { ...scan, disabled: scan.disabled || !folder.available },
      link('remove', 'Remove music source', () => confirm('Remove music source?', 'Its music will leave this library. Your files are kept.', 'Remove', () => change(async () => {
        await library.removeFolder(folder.id); setHistory(previous => previous.slice(0, -1)); request(settingsRowId('folders', 'choose'));
      })), undefined, undefined, library.isScanning)] : [];
  } else if (leaf?.key === 'servers') {
    rows = [link('add', 'Add server', () => open('add-server', 'Add server', 'Choose the type of music server you use')),
      ...sources.map(source => link(`source:${source.id}`, source.name, () => openServer(source), remote.progressById[source.id] ? 'Syncing…' : source.enabled ? source.last_status === 'ok' ? 'Connected' : source.last_status === 'error' ? 'Needs attention' : 'Not synced' : 'Disabled', source.type === 'jellyfin' ? 'Jellyfin' : 'Subsonic'))];
  } else if (leaf?.key === 'add-server') rows = [
    link('subsonic', 'Subsonic', () => setFlow({ kind: 'service', form: { kind: 'server', type: 'subsonic' }, opener: focused }), undefined, 'Navidrome, Airsonic, Gonic and compatible servers'),
    link('jellyfin', 'Jellyfin', () => setFlow({ kind: 'service', form: { kind: 'server', type: 'jellyfin' }, opener: focused }), undefined, 'Connect your Jellyfin music library'),
  ];
  else if (leaf?.key.startsWith('server:')) {
    const source = sources.find(item => `server:${item.id}` === leaf.key); const progress = source && remote.progressById[source.id];
    rows = source ? [toggle('enabled', 'Enable server', !!source.enabled, enabled => remote.updateSource(source.id, { enabled }), undefined, !!progress),
      link('name', 'Connection name', () => setFlow({ kind: 'server-name', source, opener: focused }), source.name),
      link('edit', 'Edit connection', () => setFlow({ kind: 'service', form: { kind: 'server', type: source.type, source }, opener: focused }), undefined, undefined, !!progress),
      link('sync', progress ? 'Syncing…' : 'Sync library', () => change(() => remote.syncSource(source.id)), progress ? `${progress.current}${progress.total ? ` / ${progress.total}` : ''}` : source.last_sync_at ? new Date(source.last_sync_at).toLocaleString() : 'Not synced', progress?.detail ?? undefined, !source.enabled),
      readout('address', 'Server address', source.base_url),
      ...(source.last_error ? [readout('error', 'Connection error', source.last_error)] : []),
      link('remove', 'Remove server', () => confirm('Remove server?', 'Remove this connection and its imported library from this TV. Your server files are kept.', 'Remove', () => change(async () => { await remote.deleteSource(source.id, true); setHistory(previous => previous.slice(0, -1)); request(settingsRowId('servers', 'add')); })), undefined, undefined, !!progress)] : [];
  } else if (leaf?.key === 'lastfm') {
    rows = [toggle('enabled', 'Enable scrobbling', lastfm.status?.enabled ?? false, enabled => updateScrobbling(() => lastfm.setEnabled(enabled)), 'Submit listening activity to your enabled destinations.', !lastfm.status?.profiles.some(profile => profile.connected)),
      ...(lastfm.status?.profiles ?? []).map(profile => link(`profile:${profile.id}`, profile.name, () => openProfile(profile), profile.connected ? profile.username ?? 'Configured' : 'Connect', profile.lastError ?? profile.protocolLabel)),
      link('add', 'Add destination', () => open('add-scrobbler', 'Add destination', 'Choose a scrobbling protocol')),
      ...(lastfm.status?.pendingScrobbles ? [link('retry', 'Retry queued scrobbles', requestLastFmFlush, String(lastfm.status.pendingScrobbles))] : [])];
  } else if (leaf?.key === 'add-scrobbler') rows = [
    ...(['listenbrainz', 'lastfm2', 'audioscrobbler'] as const).map(protocol => link(protocol, ({ listenbrainz: 'ListenBrainz', lastfm2: 'Last.fm 2.0 compatible', audioscrobbler: 'AudioScrobbler' })[protocol], () => setFlow({ kind: 'service', form: { kind: 'scrobbler', protocol }, opener: focused }), undefined, ({ listenbrainz: 'ListenBrainz or a compatible server', lastfm2: 'Libre.fm, GNU FM and compatible services', audioscrobbler: 'Legacy AudioScrobbler 1.2' })[protocol])),
  ];
  else if (leaf?.key.startsWith('profile:')) {
    const profile = lastfm.status?.profiles.find(item => `profile:${item.id}` === leaf.key);
    rows = profile ? [
      ...(profile.kind === 'official' && !profile.connected ? [link('connect', 'Connect Last.fm', () => setFlow({ kind: 'auth', profileId: profile.id, opener: focused }), undefined, 'Scan a QR code and approve Astra on your phone.')] : []),
      toggle('enabled', 'Enable destination', profile.enabled, enabled => updateScrobbling(() => lastfm.setProfileEnabled(profile.id, enabled)), undefined, !profile.connected),
      ...(profile.kind === 'custom' ? [link('edit', 'Edit connection', () => setFlow({ kind: 'service', form: { kind: 'scrobbler', protocol: profile.protocol, profile }, opener: focused }))] : []),
      ...(profile.username ? [readout('username', 'Username', profile.username)] : []),
      ...(profile.lastError ? [readout('error', 'Connection error', profile.lastError)] : []),
      ...(profile.connected ? [link('disconnect', 'Disconnect', () => confirm('Disconnect destination?', 'Stop scrobbling here and remove its saved credential from this TV. Your history on the service is kept.', 'Disconnect', () => change(() => updateScrobbling(() => lastfm.disconnectProfile(profile.id)))))] : []),
      ...(profile.canDelete ? [link('remove', 'Remove destination', () => confirm('Remove destination?', 'Remove this destination and its queued scrobbles from this TV. Your service history is kept.', 'Remove', () => change(async () => { await updateScrobbling(() => lastfm.deleteCustomProfile(profile.id)); setHistory(previous => previous.slice(0, -1)); request(settingsRowId('lastfm', 'add')); })))] : []),
    ] : [];
  } else if (leaf?.key === 'licenses') rows = legalDocuments.map(doc => link(doc.id, doc.title, () => open(`license:${doc.id}`, doc.readerTitle, '▲ ▼ page through the document · Back returns to Licenses')));
  else if (leaf?.key === 'about') rows = [readout('version', 'App version', build.versionLabel), readout('author', 'Created and maintained by', 'Boof2015'), readout('contact', 'Contact', 'contact@novaml.ai'), readout('license', 'License', 'GPL-3.0-only', 'With an additional permission to link the Discord Social SDK.')];
  else if (leaf?.key === 'output') rows = [readout('current', 'Current output', output?.kind === 'speaker' ? 'TV speakers' : output?.label ?? 'Not reported'),
    link('system', 'TV sound settings', () => change(async () => { try { await Linking.sendIntent('android.settings.SOUND_SETTINGS'); } catch { throw new Error('This TV could not open its sound settings. Open them from the TV’s main Settings menu.'); } }), undefined, 'Choose outputs and sound options in Android TV.')];
  else if (leaf?.key === 'advanced-audio') {
    const d = diagnostics; const c = d?.capabilities;
    rows = [readout('output', 'Current output', d?.route?.kind === 'speaker' ? 'TV speakers' : d?.route?.label ?? 'Not reported'),
      readout('source', 'Source', formatDiagnosticSource(d?.source ?? null)), readout('astra-output', 'Astra output', outputDescription(d), 'Stream sent to Android; device processing may differ.'),
      readout('device-output', 'Device output', 'Not reported by Android'), readout('rates', 'Sample rates', capabilityList(c?.sampleRates, formatSampleRate)),
      readout('channels', 'Channels', capabilityList(c?.channelCounts, formatChannels)), readout('formats', 'Reported formats', c?.encodings.map(formatEncoding).join(' · ') || 'Not reported'),
      readout('decoder', 'Decoder', d?.decoder ?? 'Not reported'), readout('sink', 'Decoded / sink input', formatDiagnosticFormat(d?.sinkInput ?? null)),
      readout('eq', 'EQ setting', d ? d.processing.eqEnabled ? `On · ${d.processing.preampDb ?? 0} dB preamp` : 'Off' : 'Not reported'),
      readout('gain', 'Native gain target', d?.processing.gainTargetDb == null ? 'Not reported' : `${d.processing.gainTargetDb.toFixed(1)} dB`)];
  }
  const entry = settingsEntry(rows, memory[page]); const left = leaf ? 'settings:back' : sectionId(section);
  useEffect(() => {
    if (active && !flow && focused.startsWith(`settings:row:${page}:`) && !rows.some(row => settingsRowId(page, row.id) === focused && !row.disabled)) {
      queueMicrotask(() => setGrab(null)); request(entry ? settingsRowId(page, entry) : left);
    }
  }, [active, flow, focused, page, rows, entry, left, request]);
  const press = (row: SettingsRow, center: number) => {
    if (row.kind === 'value') setGrab(grab ? null : settingsRowId(page, row.id));
    else if (row.kind === 'choice') menu({ title: row.label, items: row.choices, selected: Math.max(0, row.choices.findIndex(item => item.selected)), opener: settingsRowId(page, row.id), left: 659, top: 150, valueCenter: center });
    else row.run();
  };
  return <>
    <TvFocusRegion enabled={!flow}>
      {leaf ? <TvButton id="settings:back" label={`Back to ${history.length > 1 ? history[history.length - 2].title : categories[section][0]}`} onPress={backPage}
        links={{ up: 'nav:settings', down: isDocument ? 'settings:document' : entry ? settingsRowId(page, entry) : undefined, right: isDocument ? 'settings:document' : entry ? settingsRowId(page, entry) : undefined }}
        style={[box(51, 84, 176, 36), { paddingHorizontal: 14 }]}><TvText size={14} color={tv.muted}>‹ {history.length > 1 ? history[history.length - 2].title : categories[section][0]}</TvText></TvButton>
        : categories.map(([name], i) => <TvButton key={name} id={sectionId(i)} label={name} onPress={() => { setSection(i); setFeedback(''); }}
          onDirection={direction => {
            if (direction === 'up') request(i ? sectionId(i - 1) : 'nav:settings');
            if (direction === 'down') request(sectionId(Math.min(categories.length - 1, i + 1)));
            if (direction === 'right') { setSection(i); setFeedback(''); const row = settingsEntry(sectionRows[i], memory[`category:${i}`]); if (row) request(settingsRowId(`category:${i}`, row)); }
          }} style={[box(51, 84 + i * 40, 176, 36), { paddingHorizontal: 14, backgroundColor: section === i ? tv.fill : 'transparent' }]}><TvText size={14} weight="medium" color={section === i || focused === sectionId(i) ? tv.text : tv.muted}>{name}</TvText></TvButton>)}
      <TvText size={24} weight="semibold" color={tv.strong} style={box(263, 80, 646)} numberOfLines={1}>{leaf?.title ?? categories[section][0]}</TvText>
      <TvText size={13} color={tv.muted} style={box(263, 114, 646)} numberOfLines={1}>{leaf?.description ?? categories[section][1]}</TvText>
      {isDocument ? <TvButton id="settings:document" label={`Document page ${textPage + 1} of ${pages.length}`} onPress={() => {}} onDirection={direction => {
        if (direction === 'left') request('settings:back');
        if (direction === 'up' || direction === 'down') setTextPage(value => Math.max(0, Math.min(pages.length - 1, value + (direction === 'up' ? -1 : 1))));
      }} style={[box(263, 150, 646, 348), { padding: 12, justifyContent: 'flex-start' }]}>
        <TvText mono size={12} style={{ lineHeight: 21 }}>{pages[textPage]}</TvText>
        <TvText mono size={10} color={tv.muted} style={{ position: 'absolute', right: 12, bottom: 6 }}>{textPage + 1} / {pages.length}</TvText>
      </TvButton> : <TvSettingsRows rows={rows} page={page} remembered={memory[page]} left={left} up={leaf ? 'settings:back' : 'nav:settings'} grab={grab}
        enter={id => setMemory(previous => previous[page] === id ? previous : { ...previous, [page]: id })} press={press} adjust={(row, direction) => {
          if (row.kind === 'value') { const next = adjustSetting(row.amount, direction, row.min, row.max); if (next !== row.amount) row.set(next); }
        }} />}
      {!isDocument && !rows.length && <TvText color={tv.muted} style={box(279, 168, 614)}>{empty}</TvText>}
      {(!!feedback || library.isScanning) && <TvText size={11.5} color={tv.muted} numberOfLines={2} style={box(263, 505, 646)}>{library.isScanning ? `Scanning · ${library.scanProgress.processed}${library.scanProgress.total ? ` / ${library.scanProgress.total}` : ''} tracks` : feedback}</TvText>}
    </TvFocusRegion>
    {flow && <TvFocusRegion enabled><View style={[box(0, 0, 960, 540), { backgroundColor: tv.bg }]}>
      {flow.kind === 'service' ? <TvServiceForm form={flow.form} close={closeFlow} saved={serviceSaved} />
        : flow.kind === 'music-picker' ? <TvMusicPicker close={closeFlow} saved={closeFlow} />
        : flow.kind === 'server-name' ? <TvNameFlow initial={flow.source.name} labels={{ eyebrow: 'MUSIC SERVER', title: 'Name this connection', description: 'Choose a name that is easy to recognize.', field: 'Connection name', verb: 'Save' }} cancel={closeFlow} submit={async name => {
          await remote.updateSource(flow.source.id, { name }); setHistory(previous => previous.map(entry => entry.key === `server:${flow.source.id}` ? { ...entry, title: name } : entry)); closeFlow();
        }} />
        : flow.kind === 'auth' ? <TvScrobbleAuth profileId={flow.profileId} close={closeFlow} />
        : flow.kind === 'storage-probe' ? <TvStorageProbe close={closeFlow} />
        : flow.kind === 'languages' ? <TvNameFlow allowEmpty initial={lyrics.translationPriority.join(', ')} labels={{ eyebrow: 'LYRICS', title: 'Translation priority', description: 'Comma-separated language tags. Leave blank to use en, ja-Latn.', field: 'Language tags', verb: 'Save' }} submit={async value => { await lyrics.setTranslationPriority(value); closeFlow(); }} cancel={closeFlow} />
        : <><TvText size={28} weight="semibold" style={box(51, 57, 858)}>{flow.title}</TvText><TvText color={tv.muted} style={box(51, 102, 858)}>Scan with your phone to open this link.</TvText>
          <View style={[box(350, 156, 260, 260), { padding: 14, borderRadius: 12, backgroundColor: '#fff' }]}><QRCode value={flow.url} size={232} quietZone={8} /></View>
          <TvText size={11.5} color={tv.muted} numberOfLines={1} style={[box(51, 433, 858), { textAlign: 'center' }]}>{flow.url}</TvText>
          <TvButton id="settings:link:done" label="Done" onPress={closeFlow} style={[box(400, 469, 160, 38), { backgroundColor: tv.fill, alignItems: 'center' }]}><TvText>Done</TvText></TvButton>
        </>}
    </View></TvFocusRegion>}
  </>;
}
