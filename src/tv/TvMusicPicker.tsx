import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, PermissionsAndroid } from 'react-native';
import { AstraLibraryData, AstraLibraryScanner } from '../../modules/astra-library-scanner';
import { hasTvAudioPermission, requestTvAudioPermission } from '../../modules/astra-tv';
import { AUDIO_EXTENSIONS } from '@/library/audioExtensions';
import { useLibraryStore } from '@/stores/libraryStore';
import { useTvBackHandler } from './TvBack';
import { useTvActive } from './TvFocus';
import { TvSetupPage, type SetupChoice } from './TvSetupPage';
import { deviceScope, deviceSelectionLabel, isTvMusicScope, scopeDevice, selectDevice, toggleMusicFolder, type MusicDevice } from './musicSelection';

export function TvMusicPicker({ close, saved }: { close: () => void; saved: (uri?: string) => void }) {
  const active = useTvActive(); const library = useLibraryStore();
  const [devices, setDevices] = useState<MusicDevice[]>([]); const [device, setDevice] = useState<string | null>(null);
  const [selection, setSelection] = useState(() => library.folders.filter(folder => isTvMusicScope(folder.tree_uri)).map(folder => folder.tree_uri));
  const [status, setStatus] = useState<'loading' | 'permission' | 'blocked' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState(''); const [saving, setSaving] = useState(false); const lock = useRef(false); const alive = useRef(true);
  const [entry, setEntry] = useState('all');
  const discover = useCallback(async (ask = false) => {
    try {
      const granted = await hasTvAudioPermission();
      if (!alive.current) return;
      setMessage('');
      if (!granted) {
        if (!ask) { if (alive.current) setStatus('permission'); return; }
        const result = await requestTvAudioPermission();
        if (result !== PermissionsAndroid.RESULTS.GRANTED) { if (alive.current) setStatus(result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? 'blocked' : 'permission'); return; }
      }
      if (!alive.current) return; setStatus('loading');
      const found: MusicDevice[] = await AstraLibraryScanner.discoverTvMusic(AUDIO_EXTENSIONS);
      // Preserve configured disconnected devices; discovering an empty list does
      // not mean the user asked to remove them.
      for (const folder of useLibraryStore.getState().folders) {
        const id = scopeDevice(folder.tree_uri);
        if (id && !found.some(item => item.id === id)) found.push({ id, label: folder.display_name.split(' · ')[0], folders: [], unavailable: true });
      }
      if (alive.current) { setDevices(found); setStatus('ready'); }
    } catch (error) { if (alive.current) { setStatus('error'); setMessage(error instanceof Error ? error.message : 'Could not find your music.'); } }
  }, []);
  useEffect(() => {
    alive.current = true;
    const frame = requestAnimationFrame(() => void discover());
    const listener = AppState.addEventListener('change', value => { if (value === 'active' && !lock.current) void discover(); });
    return () => { alive.current = false; cancelAnimationFrame(frame); listener.remove(); };
  }, [discover]);
  const back = () => { if (lock.current) return; if (device) { setEntry(`device:${device}`); setDevice(null); } else close(); };
  useTvBackHandler(active, () => { back(); return true; });
  const save = async () => {
    if (lock.current || library.isScanning) return;
    lock.current = true; setSaving(true); setMessage('');
    try {
      if (!await hasTvAudioPermission()) { setStatus('permission'); throw new Error('Allow music access before saving these folders.'); }
      const previous = useLibraryStore.getState().folders;
      const added = selection.find(uri => !previous.some(folder => folder.tree_uri === uri));
      for (const uri of selection) {
        if (previous.some(folder => folder.tree_uri === uri)) continue;
        const volume = devices.find(item => item.id === scopeDevice(uri));
        if (!volume || volume.unavailable) throw new Error('Reconnect the selected device and try again.');
        const folder = volume.folders.find(item => item.uri === uri);
        await AstraLibraryData.registerFolder(uri, folder ? `${volume.label} · ${folder.path || 'Root folder'}` : volume.label);
      }
      for (const folder of previous) {
        if (isTvMusicScope(folder.tree_uri) && !selection.includes(folder.tree_uri)) await AstraLibraryData.removeFolder(folder.id);
      }
      await useLibraryStore.getState().refresh();
      void useLibraryStore.getState().rescan();
      if (alive.current) saved(added ?? selection[0]);
    } catch (error) { if (alive.current) setMessage(error instanceof Error ? error.message : 'Could not save music folders.'); }
    finally { lock.current = false; if (alive.current) setSaving(false); }
  };
  const current = devices.find(item => item.id === device);
  let choices: SetupChoice[] = [];
  if (status === 'permission' || status === 'blocked') choices = [{ id: 'permission', label: status === 'blocked' ? 'Open app permissions' : 'Allow music access', icon: 'musical-notes-outline', run: () => { if (status === 'blocked') void Linking.openSettings(); else void discover(true); } }];
  else if (status === 'error') choices = [{ id: 'retry', label: 'Try again', run: () => void discover() }];
  else if (status === 'ready' && current) {
    const all = selection.includes(deviceScope(current.id));
    choices = [{ id: 'all', label: 'Use all music on this device', sub: 'Includes new folders found on future scans', selected: all, disabled: current.unavailable,
      run: () => setSelection(previous => selectDevice(previous, current, !all)) },
    ...current.folders.map(folder => ({ id: folder.uri, label: folder.path.replace(/\/$/, '') || 'Root folder', sub: `${folder.count} ${folder.count === 1 ? 'track' : 'tracks'}`, selected: all || selection.includes(folder.uri),
      run: () => setSelection(previous => toggleMusicFolder(previous, current, folder)) }))];
  } else if (status === 'ready') choices = [
    { id: 'all', label: 'Use all music', sub: 'All currently connected storage devices', icon: 'checkmark-done-outline', disabled: !devices.some(item => !item.unavailable),
      selected: devices.some(item => !item.unavailable) && devices.filter(item => !item.unavailable).every(item => selection.includes(deviceScope(item.id))),
      run: () => setSelection(previous => devices.filter(item => !item.unavailable).reduce((value, item) => selectDevice(value, item, true), previous)) },
    ...devices.map(item => ({ id: `device:${item.id}`, label: item.label, sub: item.unavailable ? 'Disconnected · saved selection kept' : deviceSelectionLabel(selection, item), icon: 'albums-outline' as const,
      run: () => { setEntry('all'); setDevice(item.id); } })),
    { id: 'refresh', label: 'Look for music again', icon: 'refresh-outline', run: () => void discover() },
  ];
  const initial = status === 'ready' ? entry : status === 'permission' || status === 'blocked' ? 'permission' : status === 'error' ? 'retry' : undefined;
  return <TvSetupPage key={`${status}:${device ?? 'devices'}`} title={current?.label ?? 'Music on this TV'} eyebrow="ADD YOUR MUSIC"
    description={status === 'loading' ? 'Looking for music…' : status === 'permission' || status === 'blocked' ? 'Allow Astra to read audio on this TV and connected storage. Then choose what to add to your library.' : current ? 'Choose folders containing music, or use the whole device.' : 'Choose the music to include in your library. You can change this later in Settings.'}
    initial={initial} choices={choices} busy={saving} back={back}
    message={message || (status === 'ready' && !devices.some(item => item.folders.length) ? 'No indexed audio found. Connect storage with music, then look again.' : undefined)}
    next={status === 'ready' ? { label: saving ? 'Saving…' : library.isScanning ? 'Scan in progress…' : 'Continue', run: () => void save(), disabled: saving || library.isScanning } : undefined} />;
}
