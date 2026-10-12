import { useEffect, useState } from 'react';
import { View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import TrackPlayer from 'react-native-track-player';
import { AstraLibraryScanner, type ExtractedMetadata } from '../../modules/astra-library-scanner';
import { probeTvLocalAudio, requestTvAudioProbePermission, type TvAudioProbe } from '../../modules/astra-tv';
import { pause, playTracks } from '@/audio/playbackController';
import { artworkUri } from '@/library/artwork';
import { AUDIO_EXTENSIONS } from '@/library/audioExtensions';
import type { Track } from '@/types/audio';
import { TvButton, useTvActive, useTvFocus } from './TvFocus';
import { useTvBackHandler } from './TvBack';
import { box, TvText } from './TvPrimitives';
import { useTvTheme } from './useTvTheme';

const reportUri = `${FileSystem.documentDirectory}tv-storage-probe.json`;
type Inspected = { file: TvAudioProbe['files'][number]; metadata: ExtractedMetadata; embedded: unknown; sidecar: unknown; gain: unknown };
const saveReport = (value: unknown) => FileSystem.writeAsStringAsync(reportUri, JSON.stringify(value, null, 2));

/** Temporary development surface: no folder registration or catalog mutations. */
export function TvStorageProbe({ close }: { close: () => void }) {
  const tv = useTvTheme(); const active = useTvActive(); const { request } = useTvFocus();
  const [message, setMessage] = useState('Android 13+ audio-access experiment. Uses generated files in Music/Astra TV Probe.');
  const [busy, setBusy] = useState(false); const [items, setItems] = useState<Inspected[]>([]);
  const [discovery, setDiscovery] = useState<TvAudioProbe | null>(null);
  useEffect(() => { request('storage:0'); }, [request]);
  useTvBackHandler(active, () => { if (!busy) close(); return true; });
  const inspect = async (stable = false) => {
    const result = await probeTvLocalAudio(); setDiscovery(result);
    const files: TvAudioProbe['files'] = stable ? (await Promise.all(result.volumes.map(async volume => {
      const listing = await AstraLibraryScanner.listAudioFiles(`astra-media://${volume}/Music%2FAstra%20TV%20Probe`, AUDIO_EXTENSIONS);
      return listing.files.map(file => ({ ...file, size: file.size ?? 0, volume, relativePath: 'Music/Astra TV Probe/' }));
    }))).flat() : result.files.filter(file => file.relativePath?.startsWith('Music/Astra TV Probe/'));
    const metadata = await AstraLibraryScanner.extractMetadata(files.map(file => ({ uri: file.uri })));
    const inspected = await Promise.all(files.map(async (file, i) => ({ file, metadata: metadata[i],
      embedded: await AstraLibraryScanner.readEmbeddedLyrics(file.uri),
      sidecar: await AstraLibraryScanner.readSidecarLyrics(file.uri),
      gain: await AstraLibraryScanner.readReplayGain(file.uri),
    })));
    setItems(inspected); await saveReport({ discovery: result, inspected });
    setMessage(`${result.status} · ${result.total} indexed audio files · ${inspected.filter(item => item.metadata.ok).length}/${files.length} fixture metadata reads succeeded\nVolumes: ${result.volumes.join(', ') || 'none'}\n${inspected.map(item => `${item.file.name}: ${item.metadata.title ?? item.metadata.error ?? 'no title'} · ${item.metadata.artist ?? ''}`).join('\n')}`);
  };
  const playback = async () => {
    const results = [];
    for (const item of items) {
      const m = item.metadata;
      if (!m.ok) continue;
      const track: Track = { id: item.file.uri, path: item.file.uri, origin: 'associated-external',
        title: m.title ?? item.file.name, artist: m.artist ?? '', artistNames: m.artistNames, album: m.album ?? '',
        albumArtist: m.albumArtist ?? undefined, albumArtistNames: m.albumArtistNames,
        duration: (m.durationMs ?? 0) / 1000, format: item.file.name.split('.').at(-1)?.toUpperCase() ?? '',
        artworkData: m.artworkHash ? artworkUri(m.artworkHash) : undefined, artworkHash: m.artworkHash ?? undefined,
        sampleRate: m.sampleRate ?? undefined, channels: m.channels ?? undefined, codec: m.codecMime ?? undefined, sourceType: 'local' };
      setMessage(`Testing ${item.file.name} through Astra playback…`);
      try {
        await playTracks([track], { source: { kind: 'sample', label: 'TV storage probe' } });
        await new Promise(resolve => setTimeout(resolve, 2300));
        const progress = await TrackPlayer.getProgress(); const state = await TrackPlayer.getPlaybackState();
        const nativeTrack = await TrackPlayer.getActiveTrack();
        await pause();
        const analysis = await AstraLibraryScanner.analyzeTrack(item.file.uri, 64, false, `tv-probe-${Date.now()}`, m.durationMs ?? 0);
        results.push({ name: item.file.name, progress, state, nativeUrl: nativeTrack?.url, analysis });
      } catch (error) { results.push({ name: item.file.name, error: String(error) }); await pause(); }
    }
    await saveReport({ discovery, inspected: items, playback: results });
    setMessage(results.map(result => `${result.name}: ${result.error ?? `${result.state?.state} · ${result.progress?.position.toFixed(2)}s · analysis ${result.analysis?.completed ? 'OK' : 'failed'}`}`).join('\n'));
  };
  const run = (action: () => Promise<void>) => {
    if (busy) return; setBusy(true);
    void action().catch(error => { setMessage(String(error)); }).finally(() => setBusy(false));
  };
  const buttons = [
    { label: 'Request audio access', run: () => run(async () => { const result = await requestTvAudioProbePermission(); setMessage(`Permission: ${result}`); }) },
    { label: 'Discover and inspect', run: () => run(() => inspect()) },
    { label: 'Inspect stable audio locations', run: () => run(() => inspect(true)) },
    { label: 'Test playback and analysis', run: () => run(playback) },
    { label: 'Re-read previous URIs', run: () => run(async () => { const reread = await AstraLibraryScanner.extractMetadata(items.map(item => ({ uri: item.file.uri }))); await saveReport({ discovery, reread }); setMessage(reread.map(item => `${item.uri}: ${item.ok ? 'readable' : item.error}`).join('\n')); }) },
    { label: 'Done', run: close },
  ];
  return <View style={[box(0, 0, 960, 540), { backgroundColor: tv.bg }]}>
    <TvText size={27} weight="semibold" style={box(51, 50, 858)}>TV local audio · developer probe</TvText>
    <TvText size={13} color={tv.muted} style={box(51, 96, 858)}>MediaStore discovery → existing Astra scanner → existing player</TvText>
    {buttons.map((button, i) => <TvButton key={button.label} id={`storage:${i}`} label={button.label} onPress={() => { if (!busy) button.run(); }} links={{ up: i ? `storage:${i - 1}` : undefined, down: i < buttons.length - 1 ? `storage:${i + 1}` : undefined }} style={[box(51, 154 + i * 58, 285, 48), { paddingHorizontal: 16, backgroundColor: tv.fill }]}><TvText>{button.label}</TvText></TvButton>)}
    <TvText size={13} color={tv.muted} style={box(371, 157, 538)}>{busy ? 'Working…\n' : ''}{message}</TvText>
  </View>;
}
