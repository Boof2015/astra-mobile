import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, withTiming } from 'react-native-reanimated';
import type { Track as NativeTrack } from 'react-native-track-player';
import { getVirtualQueuePage, getVirtualQueueState, jumpToQueueIndex, moveQueueItem, removeFromQueue, requeueToTop } from '@/audio/playbackController';
import { useQueueStore } from '@/stores/queueStore';
import { queueLoadSettled } from '@/audio/queueLoader';
import { artworkThumbFromSource } from '@/library/artwork';
import { useTvBackHandler } from './TvBack';
import { TvButton, TvFocusRegion, useTvFocus } from './TvFocus';
import { TvPanel, type TvMenu } from './TvPanel';
import { box, TvArtwork, TvText, TvViewport } from './TvPrimitives';
import { playerTime } from './nowPlayingModel';
import { useTvTheme } from './useTvTheme';
import type { TvRun } from './tvCollections';
import type { FocusLinks } from './focusGeometry';
import { tvEnter, tvExit, tvQueueEnter, tvQueueExit } from './TvTransitions';
import { queueEntryKey, queueMoveTarget } from './playerQueueModel';

type Row = { key: string; position: number; track: NativeTrack };
type Snapshot = { rows: Row[]; active: number; total: number; virtual: boolean; session: string };
const idOf = (row: Row, options = false) => `npq:${row.key}:${options ? 'options' : 'row'}`;

async function readQueue(position?: number): Promise<Snapshot> {
  await queueLoadSettled();
  const virtual = getVirtualQueueState();
  const store = useQueueStore.getState();
  const active = virtual?.activePosition ?? Math.max(0, store.activeIndex);
  const start = Math.max(active, (position ?? active) - 16);
  if (virtual) {
    const page = await getVirtualQueuePage(start, 60);
    const latest = getVirtualQueueState();
    if (!page || latest?.sessionId !== virtual.sessionId || latest.sessionEpoch !== virtual.sessionEpoch || latest.queueRevision !== virtual.queueRevision) throw new Error('The queue changed. Try again.');
    return { rows: page.items.map(item => ({ key: queueEntryKey(item.track), position: item.queuePosition, track: item.track })), active: page.activePosition, total: page.totalCount, virtual: true, session: `${virtual.sessionId}:${virtual.sessionEpoch}` };
  }
  return { rows: store.tracks.slice(start, start + 60).map((track, i) => ({ key: queueEntryKey(track), position: start + i, track })), active, total: store.tracks.length, virtual: false, session: 'native' };
}

/** Reads bounded pages from the complete queue, not the transport's short tail.
 * Occurrence IDs preserve duplicate songs and focus through acknowledged edits. */
export function TvPlayerQueue({ close, run }: { close: () => void; run: TvRun }) {
  const tv = useTvTheme();
  const { request } = useTvFocus();
  const tracks = useQueueStore(s => s.tracks);
  const activeIndex = useQueueStore(s => s.activeIndex);
  const transport = useQueueStore(s => s.transport);
  const source = useQueueStore(s => s.source);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selection, setSelection] = useState({ key: '', position: -1, options: false });
  const selected = useRef(selection);
  useLayoutEffect(() => { selected.current = selection; }, [selection]);
  const [grabbed, setGrabbed] = useState(false);
  const [menu, setMenu] = useState<TvMenu | null>(null);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const alive = useRef(true);
  const generation = useRef(0);
  const data = useRef(snapshot);
  useLayoutEffect(() => { data.current = snapshot; }, [snapshot]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const publish = useCallback((next: Snapshot, position: number, key: string, options: boolean) => {
    if (!alive.current) return;
    const row = next.rows.find(item => item.key === key && item.position >= next.active)
      ?? next.rows.find(item => item.position === Math.max(next.active, Math.min(next.total - 1, position))) ?? next.rows[0];
    setSnapshot(next); data.current = next; setError('');
    if (row) {
      const pick = { key: row.key, position: row.position, options: options && row.position > next.active };
      selected.current = pick; setSelection(pick); request(idOf(row, pick.options));
      if (row.position <= next.active) setGrabbed(false);
    } else request('npq:empty');
  }, [request]);
  const reload = useCallback(async () => {
    const token = ++generation.current;
    const pick = selected.current;
    try {
      const next = await readQueue(pick.position < 0 ? undefined : pick.position);
      if (alive.current && generation.current === token) {
        const latest = selected.current;
        publish(next, latest.position, latest.key, latest.options);
      }
    } catch (reason) {
      if (alive.current && generation.current === token) { setError(String(reason instanceof Error ? reason.message : reason)); request('npq:retry'); }
    }
  }, [publish, request]);
  useEffect(() => { if (!busy.current) void reload(); }, [tracks, activeIndex, transport, reload]);
  const dismissMenu = useCallback(() => {
    if (!menu) return;
    setMenu(null); request(menu.opener);
  }, [menu, request]);
  const drop = () => {
    setGrabbed(false);
    const row = data.current?.rows.find(item => item.key === selected.current.key);
    if (row) request(idOf(row));
  };
  useTvBackHandler(true, () => {
    if (menu) dismissMenu();
    else if (grabbed) drop();
    else close();
    return true;
  });
  const navigate = (position: number, options: boolean, focus = true) => {
    if (busy.current || !data.current) return;
    const state = data.current;
    const target = Math.max(state.active, Math.min(state.total - 1, position));
    const row = state.rows.find(item => item.position === target);
    if (row) {
      const next = { key: row.key, position: row.position, options: options && target > state.active };
      selected.current = next; setSelection(next); if (focus) request(idOf(row, next.options));
      if (state.rows[0].position > state.active && target <= state.rows[0].position + 4 || target >= state.rows.at(-1)!.position - 4 && target < state.total - 1) void reload();
    } else {
      selected.current = { key: '', position: target, options }; void reload();
    }
  };
  const mutate = (row: Row, kind: 'play' | 'next' | 'remove' | 'move', direction: -1 | 1 = 1) => {
    if (busy.current) return;
    busy.current = true; generation.current++;
    run(async () => {
      try {
        const before = data.current;
        const fresh = await readQueue(row.position);
        const current = fresh.rows.find(item => item.key === row.key);
        if (!before || fresh.session !== before.session || !current || current.position < fresh.active || kind !== 'play' && current.position === fresh.active) throw new Error('This item has changed. Select it again from the current queue.');
        const options = { virtualPosition: fresh.virtual };
        let position = current.position;
        if (kind === 'move') {
          position = queueMoveTarget(current.position, direction, fresh.active, fresh.total);
          await moveQueueItem(current.position, position, options);
        } else if (kind === 'next') {
          position = fresh.active + 1; await requeueToTop(current.position, options);
        } else if (kind === 'remove') await removeFromQueue(current.position, options);
        else if (current.position !== fresh.active) await jumpToQueueIndex(current.position, options);
        const after = await readQueue(position);
        publish(after, position, kind === 'remove' ? '' : row.key, kind === 'next' || kind === 'remove');
      } catch (reason) {
        if (alive.current) { setGrabbed(false); await reload(); }
        throw reason;
      } finally { busy.current = false; }
    });
  };
  const openMenu = (row: Row) => setMenu({ title: row.track.title ?? 'Track', opener: idOf(row, true), left: 308, top: 180, items: [
    { label: 'Move', icon: 'swap-vertical', run: () => { setGrabbed(true); navigate(row.position, false); } },
    { label: 'Play next', icon: 'play-skip-forward-outline', run: () => mutate(row, 'next') },
    { label: 'Remove from queue', icon: 'remove-circle-outline', run: () => mutate(row, 'remove') },
  ] });
  const visibleIndex = Math.max(snapshot?.active ?? 0, selection.position - 3);
  const start = Math.min(visibleIndex, Math.max(snapshot?.active ?? 0, (snapshot?.total ?? 0) - 7));
  return <>
    <Animated.View entering={tvEnter} exiting={tvExit} style={[StyleSheet.absoluteFill, { backgroundColor: tv.scrim }]} />
    <Animated.View collapsable={false} entering={tvQueueEnter} exiting={tvQueueExit} style={[box(568, 0, 392, 540), { backgroundColor: tv.panel, borderLeftWidth: 1, borderColor: tv.border, boxShadow: '-25px 0px 60px rgba(0,0,0,.35)' }]}>
      <TvText size={20} weight="semibold" style={box(26, 40, 338)}>Queue</TvText>
      <TvText size={12} color={tv.muted} numberOfLines={2} style={box(26, 71, 338)}>{`Playing from ${source?.label ?? 'your music'} · ${Math.max(0, (snapshot?.total ?? 0) - (snapshot?.active ?? 0) - 1)} tracks up next`}</TvText>
      <TvFocusRegion enabled={!menu}>
        {error ? <TvButton id="npq:retry" label="Retry loading queue" onPress={() => { void reload(); }} style={[box(26, 132, 338, 64), { padding: 12, backgroundColor: tv.fill }]}><TvText>{error}</TvText><TvText color={tv.accent}>Try again</TvText></TvButton>
          : !snapshot?.rows.length ? <TvButton id="npq:empty" label="Close queue" onPress={close} style={[box(26, 140, 338, 48), { backgroundColor: tv.fill, padding: 12 }]}><TvText>{snapshot ? 'Queue is empty · Close' : 'Loading queue…'}</TvText></TvButton>
          : <TvViewport width={392} height={414} topFade={0} bottomFade={32} style={box(0, 106, 392, 414)}>
            {snapshot.rows.filter(row => row.position >= start - 2 && row.position <= start + 9 && row.position >= snapshot.active).sort((a, b) => a.key.localeCompare(b.key)).map(row => <QueueRow key={row.key} row={row} index={row.position - start} now={row.position === snapshot.active} hot={row.key === selection.key} options={selection.options} grabbed={grabbed && row.key === selection.key}
              links={Object.fromEntries((['up', 'down'] as const).map(d => {
                const neighbor = snapshot.rows.find(item => item.position === row.position + (d === 'up' ? -1 : 1)) ?? row;
                return [d, idOf(neighbor)];
              }))}
              optionLinks={Object.fromEntries((['up', 'down'] as const).map(d => {
                const neighbor = snapshot.rows.find(item => item.position === row.position + (d === 'up' ? -1 : 1)) ?? row;
                return [d, idOf(neighbor, neighbor.position > snapshot.active)];
              }))}
              focus={options => { if (!grabbed) navigate(row.position, options, false); }}
              press={options => { if (busy.current) return; if (grabbed) drop(); else if (options) openMenu(row); else mutate(row, 'play'); }}
              direction={(direction, options) => {
                if (grabbed) { if (direction === 'up' || direction === 'down') mutate(row, 'move', direction === 'up' ? -1 : 1); return; }
                navigate(row.position + (direction === 'up' ? -1 : direction === 'down' ? 1 : 0), direction === 'left' ? false : direction === 'right' ? true : options);
              }} />)}
          </TvViewport>}
      </TvFocusRegion>
      {grabbed && <View style={[box(16, 504, 360, 28), { backgroundColor: tv.panel, justifyContent: 'center' }]}><TvText size={11.5} color={tv.accent} style={{ textAlign: 'center' }}>↑ ↓ Move · OK Drop · Back Finish</TvText></View>}
    </Animated.View>
    {menu && <TvPanel menu={menu} close={dismissMenu} />}
  </>;
}

function QueueRow({ row, index, now, hot, options, grabbed, links, optionLinks, focus, press, direction }: {
  row: Row; index: number; now: boolean; hot: boolean; options: boolean; grabbed: boolean; links: FocusLinks; optionLinks: FocusLinks;
  focus: (options: boolean) => void; press: (options: boolean) => void; direction: (direction: 'up' | 'down' | 'left' | 'right', options: boolean) => void;
}) {
  const tv = useTvTheme(); const reduced = useReducedMotion();
  const motion = useAnimatedStyle(() => ({ transform: [{ translateY: withTiming(index * 55, { duration: reduced ? 0 : 220, easing: Easing.out(Easing.cubic) }) }] }));
  const art = typeof row.track.astraArtworkData === 'string' ? row.track.astraArtworkData : typeof row.track.artwork === 'string' ? row.track.artwork : null;
  return <Animated.View style={[box(14, 15, 352, 49), { borderRadius: 8, backgroundColor: grabbed ? tv.fill : hot ? tv.hover : 'transparent', elevation: grabbed ? 10 : 0, boxShadow: grabbed ? '0px 12px 30px rgba(0,0,0,.5)' : undefined }, motion]}>
    {now && <TvText mono size={8.5} color={tv.accent} style={{ position: 'absolute', left: 50, top: -12, letterSpacing: 1 }}>NOW PLAYING</TvText>}
    <TvButton id={idOf(row)} label={`${now ? 'Now playing, ' : ''}${row.track.title}, ${row.track.artist}${grabbed ? ', moving' : ''}`} onFocus={() => focus(false)} onPress={() => press(false)} links={grabbed ? {} : { ...links, right: now ? undefined : idOf(row, true) }} onDirection={grabbed ? d => direction(d, false) : undefined} style={{ width: 310, height: 49, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8 }}>
      <TvArtwork uri={artworkThumbFromSource(art)} size={32} />
      <View style={{ flex: 1 }}><TvText numberOfLines={1} color={now ? tv.accent : hot ? tv.strong : tv.caption}>{row.track.title}</TvText><TvText size={11} color={tv.muted} numberOfLines={1}>{row.track.artist}</TvText></View>
      <TvText mono size={10.5} color={tv.muted}>{grabbed ? '↕' : playerTime(row.track.duration ?? 0)}</TvText>
    </TvButton>
    {!now && <TvButton id={idOf(row, true)} disabled={grabbed} label={`Options for ${row.track.title}`} onFocus={() => focus(true)} onPress={() => press(true)} links={{ ...optionLinks, left: idOf(row) }} style={box(318, 9, 28, 30)}>
      <TvText size={18} color={options && hot ? tv.strong : tv.muted} style={{ opacity: hot && !grabbed ? 1 : 0, textAlign: 'center' }}>···</TvText>
    </TvButton>}
    {grabbed && <View style={{ position: 'absolute', left: 0, top: 4, bottom: 4, width: 3, borderRadius: 2, backgroundColor: tv.accent }} />}
  </Animated.View>;
}
