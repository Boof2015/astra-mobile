import { useTvAmbientBlock } from './ambientState';
import { useTvTheme } from './useTvTheme';
import { useCallback, useEffect, useRef, useState } from 'react';
import { findNodeHandle, Keyboard, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AstraLibraryData } from '../../modules/astra-library-scanner';
import { showTvKeyboard } from '../../modules/astra-tv';
import { useSettingsStore } from '@/stores/settingsStore';
import { useLibraryStore } from '@/stores/libraryStore';
import { usePlaylistStore } from '@/stores/playlistStore';
import { fonts } from '@/theme/typography';
import { useTvBackHandler } from './TvBack';
import { TvButton, TvFocusRegion, useTvActive, useTvFocus } from './TvFocus';
import { TvSearchResults, type SearchRequest } from './TvSearchResults';
import { box, TvText } from './TvPrimitives';
import { highlightedName, parseSearchHistory, rememberSearch, searchSuggestions, type SearchName } from './searchModel';
import type { TvActions } from './tvCollections';

const historyKey = 'tv.search.recent';
const icons = { Artist: 'person-outline', Album: 'disc-outline', Playlist: 'list-outline', Track: 'musical-note-outline', Recent: 'time-outline' } as const;

export function TvSearch({ actions, setEntry }: { actions: TvActions; setEntry: (key: string) => void }) {
  const tv = useTvTheme();
  const active = useTvActive(); const { focused, request, activate } = useTvFocus();
  const input = useRef<TextInput>(null);
  const [draft, setDraft] = useState(''); const draftRef = useRef('');
  const [editing, setEditing] = useState(false); const editingRef = useRef(false);
  const [keyboard, setKeyboard] = useState(false);
  useTvAmbientBlock(active && (editing || keyboard));
  const [submitted, setSubmitted] = useState<SearchRequest | null>(null);
  const sequence = useRef(0);
  const [resultEntry, setResultEntry] = useState('search:field');
  const [validation, setValidation] = useState('');
  const [names, setNames] = useState<{ query: string; items: SearchName[]; error?: string } | null>(null);
  const [recent, setRecent] = useState<string[]>([]); const recentRef = useRef<string[]>([]);
  const historyWrites = useRef(Promise.resolve());
  const pendingFocus = useRef(false); const readyEntry = useRef<string | null>(null);
  const includeSingles = useSettingsStore(s => s.includeSingles);
  const grouping = useSettingsStore(s => s.artistGroupingMode);
  const collaborations = useLibraryStore(s => s.includeCollabArtists);
  const playlists = usePlaylistStore(s => s.playlists);
  const query = draft.trim();
  const showResults = !!submitted && query === submitted.query && !editing;
  const { light } = actions;
  useEffect(() => { if (active) { setEntry('search:field'); if (!showResults) light(null); } }, [active, showResults, setEntry, light]);
  useEffect(() => {
    let alive = true;
    void AstraLibraryData.getSettings([historyKey]).then(values => {
      if (!alive) return;
      const saved = parseSearchHistory(values[historyKey]);
      const merged = recentRef.current.slice().reverse().reduce(rememberSearch, saved);
      recentRef.current = merged; setRecent(merged);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const focusReady = useCallback((entry: string) => {
    readyEntry.current = entry; setResultEntry(entry);
    if (pendingFocus.current && !editingRef.current && !Keyboard.isVisible()) { pendingFocus.current = false; request(entry); }
  }, [request]);
  useEffect(() => {
    if (!active) return;
    const shown = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      editingRef.current = false; input.current?.blur(); setEditing(false); setKeyboard(false);
      if (pendingFocus.current) { if (readyEntry.current) focusReady(readyEntry.current); }
      else request('search:field');
    });
    return () => { shown.remove(); hidden.remove(); };
  }, [active, request, focusReady]);
  useEffect(() => {
    if (!active || !editing) return;
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [active, editing]);
  useEffect(() => {
    if (!active || showResults || !query) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void AstraLibraryData.getTvSearchNames(query, includeSingles, grouping, collaborations).then(items => {
        if (!cancelled) setNames({ query, items });
      }).catch(() => { if (!cancelled) setNames({ query, items: [], error: 'Suggestions unavailable. You can still search.' }); });
    }, 120);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [active, showResults, query, includeSingles, grouping, collaborations]);
  const submit = (value: string) => {
    const text = value.trim();
    if (!text) { setValidation('Type something first'); return; }
    const next = { id: ++sequence.current, query: text, includeSingles, grouping, collaborations };
    setSubmitted(next); setDraft(text); draftRef.current = text; setResultEntry('search:field');
    pendingFocus.current = true; readyEntry.current = null; editingRef.current = false;
    setEditing(false); setValidation(''); input.current?.blur(); Keyboard.dismiss();
    const history = rememberSearch(recentRef.current, text); recentRef.current = history; setRecent(history);
    historyWrites.current = historyWrites.current.catch(() => {}).then(() => AstraLibraryData.setSettings({ [historyKey]: JSON.stringify(history) })).catch(() => {});
  };
  const startTyping = () => { pendingFocus.current = false; editingRef.current = true; setEditing(true); setValidation(''); };
  useTvBackHandler(active, () => {
    if (editingRef.current || Keyboard.isVisible()) {
      pendingFocus.current = false; input.current?.blur(); Keyboard.dismiss();
      editingRef.current = false; setEditing(false); setKeyboard(false); request('search:field'); return true;
    }
    if (focused.startsWith('search:') && focused !== 'search:field' && focused !== 'search:submit') { request('search:field'); return true; }
    return false;
  });
  const candidates: SearchName[] = [...(names?.query === query ? names.items : []), { name: 'Favorites', kind: 'Playlist' }, ...playlists.map(p => ({ name: p.name, kind: 'Playlist' as const }))];
  const suggestions = query ? searchSuggestions(query, candidates, editing || keyboard ? 4 : 6) : recent.slice(0, editing || keyboard ? 4 : 5).map(name => ({ name, kind: 'Recent' as const, indices: [] as number[] }));
  const entry = showResults ? resultEntry : suggestions.length ? 'search:suggestion:0' : undefined;
  return <>
    <TvButton id="search:field" label="Search query" links={{ up: 'nav:search', right: query ? 'search:submit' : undefined, down: entry }} onPress={startTyping}
      style={[box(51, 76, 740, 48), { borderRadius: 12, borderWidth: 1, borderColor: editing ? tv.accent : tv.border, backgroundColor: editing ? 'rgba(169,192,255,.1)' : tv.hover, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }]} ringStyle={{ top: -5, bottom: -5, left: -5, right: -5, borderRadius: 16 }}>
      <Ionicons name="search-outline" size={18} color={tv.muted} />
      <TextInput ref={input} value={draft} editable={active} focusable={active && editing} showSoftInputOnFocus={editing}
        onChangeText={value => { draftRef.current = value; setDraft(value); setValidation(''); }}
        onFocus={() => { activate('search:field'); if (editingRef.current) void showTvKeyboard(findNodeHandle(input.current)).catch(() => {}); }}
        onSubmitEditing={() => submit(draftRef.current)} submitBehavior="submit" returnKeyType="search" returnKeyLabel="Search"
        autoCorrect={false} accessibilityLabel="Search query input" placeholder="Artists, albums, tracks, playlists" placeholderTextColor={tv.faint}
        style={{ flex: 1, color: tv.strong, fontFamily: fonts.sans.regular, fontSize: 17, padding: 0 }} />
    </TvButton>
    <TvButton id="search:submit" label="Search library" disabled={!query} links={{ left: 'search:field', up: 'nav:search', down: entry }} onPress={() => submit(draftRef.current)}
      style={[box(801, 76, 108, 48), { borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(169,192,255,.3)', backgroundColor: 'rgba(169,192,255,.16)' }]} ringStyle={{ top: -5, bottom: -5, left: -5, right: -5, borderRadius: 16 }}><TvText size={14} weight="medium" color={tv.accent}>Search</TvText></TvButton>
    {!showResults && <View style={box(51, 140, 858)}>
      <TvText mono size={10.5} color={validation ? tv.accent : tv.faint} style={{ marginLeft: 14, marginBottom: 8, letterSpacing: 1.4 }}>
        {validation || (query ? suggestions.length ? 'SUGGESTIONS' : names?.query === query ? names.error ?? 'No suggestions · Search still looks everywhere' : 'Looking for names…' : recent.length ? 'RECENT SEARCHES' : 'SEARCH YOUR COLLECTION')}
      </TvText>
      {suggestions.map((suggestion, i) => <TvButton key={`${i}:${suggestion.name}`} id={`search:suggestion:${i}`} label={`${suggestion.name}, ${suggestion.kind === 'Recent' ? 'Recent search' : suggestion.kind}`}
        links={{ up: i ? `search:suggestion:${i - 1}` : 'search:field', down: i < suggestions.length - 1 ? `search:suggestion:${i + 1}` : undefined }} onPress={() => submit(suggestion.name)}
        style={{ height: 38, borderRadius: 9, paddingHorizontal: 14, gap: 12, flexDirection: 'row', alignItems: 'center', backgroundColor: focused === `search:suggestion:${i}` ? tv.hover : 'transparent' }} ringStyle={{ top: 0, bottom: 0, left: 0, right: 0, borderRadius: 9 }}>
        <Ionicons name={icons[suggestion.kind]} size={15} color={tv.faint} />
        <TvText size={15} color={tv.muted} numberOfLines={1} style={{ flex: 1 }}>{highlightedName(suggestion.name, suggestion.indices).map((run, at) => <TvText key={at} size={15} weight={run.strong ? 'semibold' : 'regular'} color={run.strong ? tv.strong : tv.muted}>{run.text}</TvText>)}</TvText>
        {suggestion.kind !== 'Recent' && <TvText size={12} color={tv.faint}>{suggestion.kind}</TvText>}
      </TvButton>)}
    </View>}
    {submitted && <TvFocusRegion enabled={showResults}><View style={[box(0, 0, 960, 540), { display: showResults ? 'flex' : 'none' }]}>
      <TvSearchResults key={submitted.id} search={submitted} actions={actions} ready={focusReady} />
    </View></TvFocusRegion>}
  </>;
}
