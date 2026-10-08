import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';
import { useLibraryStore } from '@/stores/libraryStore';
import { useRemoteSourcesStore } from '@/stores/remoteSourcesStore';
import type { RemoteSourceType } from '@/types/remote';
import { useTvBackHandler } from './TvBack';
import { useTvActive } from './TvFocus';
import { TvMusicPicker } from './TvMusicPicker';
import { TvServerWizard } from './TvServerWizard';
import { TvNameFlow } from './TvNameFlow';
import { TvSetupPage, type SetupChoice } from './TvSetupPage';

type Page = { kind: 'summary' } | { kind: 'add' } | { kind: 'local' } | { kind: 'server'; type: RemoteSourceType; id?: number }
  | { kind: 'detail'; source: 'local' | 'server'; id: number } | { kind: 'rename'; id: number } | { kind: 'remove'; source: 'local' | 'server'; id: number };

export function TvSourceSetup({ close, next }: { close: () => void; next: () => void }) {
  const active = useTvActive(); const library = useLibraryStore(); const remote = useRemoteSourcesStore();
  const [page, setPage] = useState<Page>({ kind: 'summary' }); const [entry, setEntry] = useState<string | undefined>();
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const [localOpener, setLocalOpener] = useState<number | null>(null);
  const hasSources = library.folders.length + remote.sources.length > 0;
  useEffect(() => { void Promise.all([useLibraryStore.getState().initialize(), useRemoteSourcesStore.getState().init()]).catch(error => setMessage(String(error))); }, []);
  const summary = (focus?: string) => { setEntry(focus); setPage({ kind: 'summary' }); };
  const back = () => {
    if (busy) return;
    if (page.kind === 'summary') close();
    else if (page.kind === 'add') summary('add');
    else if (page.kind === 'detail') summary(`${page.source}:${page.id}`);
    else if (page.kind === 'rename') { setEntry('rename'); setPage({ kind: 'detail', source: 'server', id: page.id }); }
    else if (page.kind === 'remove') { setEntry('remove'); setPage({ kind: 'detail', source: page.source, id: page.id }); }
  };
  useTvBackHandler(active && page.kind !== 'local' && page.kind !== 'server', () => {
    if (Keyboard.isVisible()) Keyboard.dismiss(); else back(); return true;
  });
  const run = (fn: () => Promise<void>) => {
    if (busy) return; setBusy(true); setMessage('');
    void fn().catch(error => setMessage(error instanceof Error ? error.message : 'Could not update this source.')).finally(() => setBusy(false));
  };
  const chooseSource = (id: string) => { setEntry(id); setPage(hasSources ? { kind: 'add' } : { kind: 'summary' }); };
  if (page.kind === 'local') return <TvMusicPicker close={() => {
    if (localOpener !== null) { setEntry('edit'); setPage({ kind: 'detail', source: 'local', id: localOpener }); }
    else chooseSource('local');
  }} saved={uri => {
    const added = useLibraryStore.getState().folders.find(folder => folder.tree_uri === uri);
    summary(added ? `local:${added.id}` : 'add');
  }} />;
  if (page.kind === 'server') return <TvServerWizard type={page.type} source={remote.sources.find(source => source.id === page.id)}
    close={() => { if (page.id) { setEntry('edit'); setPage({ kind: 'detail', source: 'server', id: page.id }); } else chooseSource(page.type); }}
    saved={id => summary(`server:${id}`)} />;
  if (page.kind === 'rename') {
    const source = remote.sources.find(item => item.id === page.id);
    return <TvNameFlow initial={source?.name} cancel={back} labels={{ eyebrow: 'MUSIC SERVER', title: 'Name this connection', description: 'Choose a name that is easy to recognize.', field: 'Connection name', verb: 'Save' }} submit={async name => { await remote.updateSource(page.id, { name }); back(); }} />;
  }
  let title = 'Your music'; let description = 'Here’s what you’ve added. Scans can keep running while you finish setup.';
  let choices: SetupChoice[] = [];
  if (page.kind === 'remove') {
    return <TvSetupPage title="Remove this source?" description="Its music will leave this library. Your music files and server are kept." back={back} initial="cancel" choices={[
      { id: 'cancel', label: 'Keep source', run: back },
      { id: 'remove', label: busy ? 'Removing…' : 'Remove source', disabled: busy, run: () => run(async () => {
        if (page.source === 'local') await library.removeFolder(page.id); else await remote.deleteSource(page.id, true);
        summary('add');
      }) },
    ]} message={message} />;
  }
  if (page.kind === 'detail') {
    if (page.source === 'local') {
      const folder = library.folders.find(item => item.id === page.id);
      title = folder?.display_name ?? 'Music folder'; description = folder?.scan_error || (folder?.available ? `${folder.track_count} tracks in your library.` : 'Reconnect this storage device or allow music access. Your library is kept.');
      choices = [
        { id: 'edit', label: 'Choose music folders', icon: 'folder-outline', disabled: library.isScanning, run: () => { setLocalOpener(page.id); setPage({ kind: 'local' }); } },
        { id: 'scan', label: library.isScanning ? 'Scanning…' : 'Scan for changes', icon: 'refresh-outline', disabled: library.isScanning || !folder?.available, run: () => void library.rescan() },
        { id: 'remove', label: 'Remove source', disabled: library.isScanning, run: () => { setMessage(''); setPage({ kind: 'remove', source: 'local', id: page.id }); } },
      ];
    } else {
      const source = remote.sources.find(item => item.id === page.id); const progress = remote.progressById[page.id];
      title = source?.name ?? 'Music server'; description = source?.last_error || source?.base_url || 'Server connection';
      choices = [
        { id: 'rename', label: 'Name this connection', icon: 'create-outline', run: () => setPage({ kind: 'rename', id: page.id }) },
        { id: 'edit', label: 'Edit connection', icon: 'server-outline', disabled: !!progress, run: () => { if (source) setPage({ kind: 'server', type: source.type, id: source.id }); } },
        { id: 'sync', label: progress ? 'Syncing…' : 'Sync library', disabled: !!progress, icon: 'refresh-outline', run: () => run(() => remote.syncSource(page.id)) },
        { id: 'remove', label: 'Remove source', disabled: !!progress, run: () => { setMessage(''); setPage({ kind: 'remove', source: 'server', id: page.id }); } },
      ];
    }
  } else if (!hasSources || page.kind === 'add') {
    title = 'Add your music'; description = 'Play music from this TV, connected storage, or your own music server.';
    choices = [
      { id: 'local', label: 'Music on this TV', sub: 'Internal storage and USB drives', icon: 'folder-outline', run: () => { setLocalOpener(null); setPage({ kind: 'local' }); } },
      { id: 'subsonic', label: 'Subsonic', sub: 'Navidrome and compatible servers', icon: 'server-outline', run: () => setPage({ kind: 'server', type: 'subsonic' }) },
      { id: 'jellyfin', label: 'Jellyfin', sub: 'Connect your music library', icon: 'server-outline', run: () => setPage({ kind: 'server', type: 'jellyfin' }) },
    ];
  } else {
    choices = [
      ...library.folders.map(folder => ({ id: `local:${folder.id}`, label: folder.display_name, icon: 'folder-outline' as const,
        sub: !folder.available ? 'Storage unavailable · library kept' : library.isScanning && library.scanProgress.folderName === folder.display_name ? `Scanning · ${library.scanProgress.processed} / ${library.scanProgress.total}` : folder.scan_error || (folder.last_scanned_at ? `${folder.track_count} tracks · Ready` : 'Waiting to scan'),
        run: () => { setEntry(undefined); setPage({ kind: 'detail', source: 'local', id: folder.id }); } })),
      ...remote.sources.map(source => ({ id: `server:${source.id}`, label: source.name, icon: 'server-outline' as const,
        sub: `${source.type === 'jellyfin' ? 'Jellyfin' : 'Subsonic'} · ${remote.progressById[source.id] ? `Syncing · ${remote.progressById[source.id]?.current} tracks` : source.last_error || (source.last_status === 'ok' ? 'Connected' : 'Waiting to sync')}`,
        run: () => { setEntry(undefined); setPage({ kind: 'detail', source: 'server', id: source.id }); } })),
      { id: 'add', label: 'Add another source', icon: 'add-outline', run: () => { setEntry('local'); setPage({ kind: 'add' }); } },
    ];
  }
  return <TvSetupPage key={page.kind === 'detail' ? `detail:${page.source}:${page.id}` : `${page.kind}:${hasSources}`} title={title} description={description} choices={choices} busy={busy}
    initial={entry && choices.some(row => row.id === entry) ? entry : undefined} back={back} message={message}
    next={page.kind === 'summary' ? { label: hasSources ? 'Continue' : 'Set up later', run: next } : undefined} />;
}
