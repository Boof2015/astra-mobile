import { useTvTheme } from './useTvTheme';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { readAsStringAsync } from 'expo-file-system/legacy';
import { canPickTvDocuments } from '../../modules/astra-tv';
import { useEQStore } from '@/stores/eqStore';
import type { EQBandType, EQPreset } from '@/types/audio';
import { EQ_MAX_BANDS, EQ_PASS_FILTER_DEFAULT_Q, isPassEQBandType } from '@/audio/eq';
import { buildGraphicBands, GRAPHIC_BANDS } from '@/audio/graphicEq';
import { genEqId } from '@/audio/eqPresets';
import { parseAutoEQ } from '@/audio/autoEQParser';
import { encodeEQPresetQr, parseEQPresetFileContents } from '@/audio/eqShare';
import { bandColor, bandColorName, BAND_COLOR_NAMES, useBandPalette } from '@/components/eq/bandColors';
import { BAND_TYPE_LABEL, formatFreqHz, formatGain } from '@/components/eq/format';
import { TvButton, TvFocusRegion, useTvActive, useTvFocus } from './TvFocus';
import { TvNameFlow } from './TvNameFlow';
import { TvEqDevices, TvEqImportPreview, TvEqQr } from './TvEqFlows';
import { TvEqGraph } from './TvEqGraph';
import { useTvBackHandler } from './TvBack';
import { box, TvText } from './TvPrimitives';
import { stepEqBand, stepEqPreamp, stepEqQ, stepEqSlider, type EqDirection } from './eqInteraction';
import type { TvActions } from './tvCollections';
import type { TvMenuItem } from './TvPanel';

type Grab = { kind: 'band' | 'q'; id: string } | { kind: 'slider'; index: number } | { kind: 'preamp' };
type Flow = { kind: 'name'; after: 'save' | 'qr' | 'devices' } | { kind: 'qr'; name: string; value: string } | { kind: 'devices' | 'import'; preset: EQPreset } | { kind: 'loading' };
const tools = ['toggle', 'parametric', 'graphic', 'preset', 'preamp', 'more'] as const;
const toolId = (key: string) => `eq:tool:${key}`;
const bandId = (id: string) => `eq:band:${id}`;
const sliderId = (index: number) => `eq:slider:${index}`;
const sets = ['type', 'q', 'color', 'enabled', 'remove'] as const;
const grabbedId = (grab: Grab) => grab.kind === 'band' ? bandId(grab.id) : grab.kind === 'q' ? 'eq:set:q' : grab.kind === 'slider' ? sliderId(grab.index) : toolId('preamp');

function Toggle({ on }: { on: boolean }) {
  const tv = useTvTheme();
  return <View style={{ width: 29, height: 16, borderRadius: 9, backgroundColor: on ? tv.accent : '#323b4f', padding: 2, alignItems: on ? 'flex-end' : 'flex-start' }}><View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: on ? tv.surface : tv.muted }} /></View>;
}

export function TvEq({ actions, setImmersive }: { actions: TvActions; setImmersive: (value: boolean) => void }) {
  const tv = useTvTheme(); const palette = useBandPalette();
  const control = { height: 34, borderRadius: 9, paddingHorizontal: 13, borderWidth: 1, borderColor: tv.border, backgroundColor: 'rgba(124,146,196,.06)', flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 };
  const heldStyle = { borderColor: tv.accent, backgroundColor: 'rgba(169,192,255,.14)' };
  const eq = useEQStore(); const active = useTvActive(); const { focused, request } = useTvFocus();
  const [grab, setGrab] = useState<Grab | null>(null);
  const [flow, setFlow] = useState<Flow | null>(null); const flowSequence = useRef(0);
  const [lastTool, setLastTool] = useState('parametric'); const [lastSet, setLastSet] = useState('type');
  const [slider, setSlider] = useState(0); const [menuOrigin, setMenuOrigin] = useState('');
  const [basePreset, setBasePreset] = useState(eq.loaded ? eq.activePresetId : null);
  const selected = eq.bands.find(band => band.id === eq.activeBandId) ?? eq.bands[0];
  const index = Math.max(0, eq.bands.findIndex(band => band.id === selected?.id));
  const parametric = eq.mode === 'parametric';
  const graphicBands = useMemo(() => buildGraphicBands(eq.graphicGains).map((band, color) => ({ ...band, color })), [eq.graphicGains]);
  const bands = parametric ? eq.bands : graphicBands;
  const lower = parametric ? selected ? bandId(selected.id) : 'eq:add' : sliderId(slider);
  const activePreset = eq.presets.find(preset => preset.id === eq.activePresetId);
  const origin = eq.presets.find(preset => preset.id === basePreset);
  const presetLabel = activePreset?.name ?? (origin ? `${origin.name} · edited` : 'Custom');
  const { light, menu } = actions;
  useEffect(() => { if (active) light(null); }, [active, light]);
  useEffect(() => useEQStore.subscribe(state => {
    if (state.activePresetId) setBasePreset(state.activePresetId);
    setGrab(previous => !previous || previous.kind === 'preamp' || (previous.kind === 'slider'
      ? state.mode === 'graphic' : state.mode === 'parametric' && state.bands.some(band => band.id === previous.id)) ? previous : null);
  }), []);
  useEffect(() => { setImmersive(!!flow); return () => setImmersive(false); }, [flow, setImmersive]);
  useEffect(() => { if (flow?.kind === 'loading') request('eq:import:cancel'); }, [flow?.kind, request]);
  useEffect(() => {
    if (!active) return;
    if (grab && focused !== grabbedId(grab)) request(grabbedId(grab));
    else if (!grab && ((focused.startsWith('eq:band:') && (!parametric || !eq.bands.some(band => bandId(band.id) === focused)))
      || (focused.startsWith('eq:slider:') && parametric) || (focused.startsWith('eq:set:') && !parametric))) request(lower);
  }, [active, grab, focused, request, parametric, eq.bands, lower]);
  const closeFlow = () => { flowSequence.current++; Keyboard.dismiss(); setFlow(null); request(toolId('more')); };
  useTvBackHandler(active, () => {
    if (flow) { if (Keyboard.isVisible()) Keyboard.dismiss(); else closeFlow(); return true; }
    if (grab) { setGrab(null); return true; }
    return false;
  });
  const edit = (direction: EqDirection) => {
    if (!grab) return;
    const state = useEQStore.getState();
    if (grab.kind === 'preamp') { if (direction === 'left' || direction === 'right') state.setPreamp(stepEqPreamp(state.preamp, direction)); return; }
    if (grab.kind === 'slider') {
      const next = stepEqSlider(grab.index, state.graphicGains[grab.index], direction, GRAPHIC_BANDS.length);
      if (direction === 'left' || direction === 'right') { setSlider(next.index); setGrab({ kind: 'slider', index: next.index }); request(sliderId(next.index)); }
      else state.setGraphicGain(grab.index, next.gain);
      return;
    }
    const band = state.bands.find(item => item.id === grab.id); if (!band) return;
    if (grab.kind === 'q') { if (direction === 'left' || direction === 'right') state.updateBand(band.id, { Q: stepEqQ(band.Q, direction) }); }
    else { const patch = stepEqBand(band, direction); if (Object.keys(patch).length) state.updateBand(band.id, patch); }
  };
  const panel = (title: string, items: TvMenuItem[], opener: string, left: number, top: number, selected = 0, message?: string) => {
    setMenuOrigin(opener); menu({ title, items, opener, left, top, selected, message });
  };
  const showQr = (name: string) => {
    const state = useEQStore.getState();
    const preset: EQPreset = { id: 'tv-current', name, preamp: state.preamp, bands: state.mode === 'graphic' ? buildGraphicBands(state.graphicGains) : state.bands, isCustom: true,
      ...(state.mode === 'graphic' ? { mode: 'graphic', graphicGains: [...state.graphicGains] } : {}) };
    setFlow({ kind: 'qr', name, value: encodeEQPresetQr(preset) });
  };
  const startNamedAction = (after: 'save' | 'qr' | 'devices') => {
    if (after === 'qr' && activePreset) showQr(activePreset.name);
    else if (after === 'devices' && activePreset) setFlow({ kind: 'devices', preset: activePreset });
    else setFlow({ kind: 'name', after });
  };
  const importFile = async (format: 'astra' | 'autoeq') => {
    const sequence = ++flowSequence.current; setFlow({ kind: 'loading' });
    try {
      const available = await canPickTvDocuments();
      if (sequence !== flowSequence.current) return;
      if (!available) {
        closeFlow(); panel('File imports unavailable', [{ label: 'Done', run: () => {} }], toolId('more'), 600, 145, 0,
          'File imports need an Android document picker, which isn’t available on this TV.');
        return;
      }
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (sequence !== flowSequence.current) return;
      if (result.canceled || !result.assets?.[0]) { closeFlow(); return; }
      const asset = result.assets[0];
      const contents = await readAsStringAsync(asset.uri);
      const preset = format === 'astra' ? parseEQPresetFileContents(contents, genEqId) : parseAutoEQ(contents, asset.name);
      if (!preset.bands.length) throw new Error('This file contains no supported EQ filters.');
      if (sequence === flowSequence.current) setFlow({ kind: 'import', preset });
    } catch (error) {
      if (sequence !== flowSequence.current) return;
      closeFlow(); panel('Could not import preset', [{ label: 'Done', run: () => {} }], toolId('more'), 600, 145, 0, error instanceof Error ? error.message : 'Choose an Astra preset or an AutoEQ ParametricEQ text file.');
    }
  };
  const showMore = () => panel('Equalizer', [
    { label: 'Save as new preset…', icon: 'add-outline', run: () => startNamedAction('save') },
    { label: 'Import AutoEQ…', icon: 'download-outline', run: () => { void importFile('autoeq'); } },
    { label: 'Import Astra preset…', icon: 'download-outline', run: () => { void importFile('astra'); } },
    { label: 'Show preset as QR…', icon: 'qr-code-outline', run: () => startNamedAction('qr') },
    { label: 'Use for output devices…', icon: 'headset-outline', run: () => startNamedAction('devices') },
    { label: 'Reset to flat', icon: 'refresh-outline', run: eq.resetToFlat },
  ], toolId('more'), 659, 108);
  const settings = selected ? [
    { key: 'type', label: `Filter type, ${BAND_TYPE_LABEL[selected.type]}`, width: 178, run: () => {
      const types = Object.keys(BAND_TYPE_LABEL) as EQBandType[];
      panel('Filter type', types.map(type => ({ label: BAND_TYPE_LABEL[type], selected: selected.type === type, run: () => eq.updateBand(selected.id, { type, ...(isPassEQBandType(type) ? { gain: 0, Q: EQ_PASS_FILTER_DEFAULT_Q } : {}) }) })), 'eq:set:type', 125, 164, types.indexOf(selected.type));
    }, content: <><TvText color={tv.muted}>Type</TvText><TvText>{BAND_TYPE_LABEL[selected.type]}</TvText></> },
    { key: 'q', label: `Q, ${selected.Q.toFixed(2)}`, width: 116, run: () => setGrab(grab ? null : { kind: 'q', id: selected.id }), content: <><TvText color={tv.muted}>Q</TvText><TvText mono color={grab?.kind === 'q' ? tv.accent : tv.text}>{grab?.kind === 'q' ? '◀ ' : ''}{selected.Q.toFixed(2)}{grab?.kind === 'q' ? ' ▶' : ''}</TvText></> },
    { key: 'color', label: `Band color, ${bandColorName(selected)}`, width: 98, run: () => panel('Band color', BAND_COLOR_NAMES.map((label, color) => ({ label, swatch: palette.colors[color], selected: selected.color === color, run: () => eq.setBandColor(selected.id, color) })), 'eq:set:color', 440, 76, typeof selected.color === 'number' ? selected.color : 0), content: <><TvText color={tv.muted}>Color</TvText><View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: bandColor(palette, selected) }} /></> },
    { key: 'enabled', label: `Band ${selected.enabled ? 'on' : 'off'}`, width: 96, run: () => eq.updateBand(selected.id, { enabled: !selected.enabled }), content: <><TvText color={tv.muted}>Band</TvText><Toggle on={selected.enabled} /></> },
    { key: 'remove', label: 'Remove band', width: 104, disabled: eq.bands.length <= 1, run: () => {
      const next = eq.bands[index + 1] ?? eq.bands[index - 1];
      if (next) { eq.removeBand(selected.id); eq.selectBand(next.id); request(bandId(next.id)); }
    }, content: <><Ionicons name="trash-outline" size={14} color={tv.danger} /><TvText color={tv.danger}>Remove</TvText></> },
  ] : [];
  const graphSelection = parametric ? focused.startsWith('eq:band:') || focused.startsWith('eq:set:') || focused.startsWith('menu:') && menuOrigin.startsWith('eq:set:') ? selected?.id ?? null : null
    : focused.startsWith('eq:slider:') ? graphicBands[slider].id : null;
  const hint = grab?.kind === 'band' ? isPassEQBandType(selected?.type ?? 'peaking') ? '◀ ▶ frequency · OK or Back keeps the value' : '◀ ▶ frequency · ▲ ▼ gain · OK or Back keeps the values'
    : grab?.kind === 'q' ? '◀ wider · ▶ narrower · OK or Back keeps the value'
    : grab?.kind === 'preamp' ? '◀ ▶ preamp · OK or Back keeps the value'
    : grab?.kind === 'slider' ? '▲ ▼ gain · ◀ ▶ next slider, still adjusting · OK or Back when done'
    : focused.startsWith('eq:band:') ? 'OK to move this band on the graph · ▼ type, Q, color'
    : focused === 'eq:add' ? 'OK adds a band in the widest gap'
    : focused.startsWith('eq:slider:') ? 'OK to adjust · then ▲ ▼ changes gain and ◀ ▶ moves along without letting go'
    : focused === 'eq:set:q' ? 'OK to adjust how wide the band is'
    : focused.startsWith('eq:set:') ? 'OK to change this band · ▲ back to the band'
    : focused === toolId('preamp') ? 'OK to adjust the preamp'
    : focused === toolId('preset') ? 'OK opens presets'
    : focused === toolId('toggle') ? 'OK turns the equalizer on or off'
    : focused === toolId('more') ? 'Save, import, show as QR for your phone, use per output device, reset'
    : parametric ? 'Parametric: up to 10 bands you place yourself' : 'Graphic: five fixed sliders';
  const output = eq.activeOutputRoute?.kind === 'speaker' ? 'TV speakers' : eq.activeOutputRoute?.label ?? 'Default output';
  return <>
    <TvFocusRegion enabled={!flow}>
      <View style={box(51, 72, 858, 30)}>
        {tools.map((key, i) => {
          const left = [0, 116, 208, 294, 497, 635][i]; const width = [100, 88, 72, 195, 130, 64][i];
          const onPress = () => {
            if (key === 'toggle') eq.toggleEnabled();
            else if (key === 'parametric' || key === 'graphic') { setGrab(null); eq.setMode(key); }
            else if (key === 'preamp') setGrab(grab ? null : { kind: 'preamp' });
            else if (key === 'preset') panel('Presets', eq.presets.map(preset => ({ label: preset.name, selected: preset.id === eq.activePresetId, run: () => eq.applyPreset(preset.id) })), toolId('preset'), 345, 108, Math.max(0, eq.presets.findIndex(preset => preset.id === eq.activePresetId)));
            else showMore();
          };
          return <TvButton key={key} id={toolId(key)} label={key === 'toggle' ? `Equalizer ${eq.enabled ? 'on' : 'off'}` : key === 'preset' ? `Preset, ${presetLabel}` : key === 'preamp' ? `Preamp, ${formatGain(eq.preamp)} dB` : key === 'more' ? 'More EQ options' : key === 'parametric' ? 'Parametric' : 'Graphic'}
            onPress={onPress} onFocus={() => {
              // Reenabling the page after a panel can briefly focus its first
              // native child. That is not a new remembered toolbar destination.
              if (focused.startsWith('nav:') || focused.startsWith('eq:tool:') || focused.startsWith('eq:band:') || focused.startsWith('eq:slider:')) setLastTool(key);
            }} onDirection={key === 'preamp' && grab?.kind === 'preamp' ? edit : undefined}
            links={{ left: i ? toolId(tools[i - 1]) : undefined, right: i < tools.length - 1 ? toolId(tools[i + 1]) : undefined, up: 'nav:eq', down: lower }}
            style={[box(left, 0, width, 30), { paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: key === eq.mode ? tv.fill : 'transparent' }, grab?.kind === 'preamp' && key === 'preamp' && heldStyle]}>
            {key === 'toggle' ? <><TvText color={tv.muted}>Equalizer</TvText><Toggle on={eq.enabled} /></> : key === 'preset' ? <><TvText color={tv.muted}>Preset</TvText><TvText numberOfLines={1} style={{ flex: 1 }}>{presetLabel}</TvText></>
              : key === 'preamp' ? <><TvText color={tv.muted}>Preamp</TvText><TvText mono color={grab?.kind === 'preamp' ? tv.accent : tv.text}>{formatGain(eq.preamp)} dB</TvText></>
              : key === 'more' ? <><Ionicons name="ellipsis-horizontal" size={14} color={tv.muted} /><TvText color={tv.muted}>More</TvText></> : <TvText color={key === eq.mode ? tv.text : tv.muted}>{key === 'parametric' ? 'Parametric' : 'Graphic'}</TvText>}
          </TvButton>;
        })}
        <TvText mono size={9.5} color={tv.faint} numberOfLines={1} style={[box(713, 8, 145), { textAlign: 'right' }]}>OUTPUT · {output.toUpperCase()}</TvText>
      </View>
      <View style={box(51, 112, 858, parametric ? 206 : 150)}>
        <View style={{ opacity: eq.enabled ? 1 : .3 }}><TvEqGraph bands={bands} height={parametric ? 206 : 150} selected={graphSelection} grabbed={grab?.kind === 'band' || grab?.kind === 'slider'} graphic={!parametric} /></View>
        {!eq.enabled && <TvText size={14} color={tv.muted} style={[box(0, (parametric ? 206 : 150) / 2 - 10, 858), { textAlign: 'center' }]}>Equalizer is off</TvText>}
      </View>
      {parametric ? <>
        {eq.bands.map((band, i) => <TvButton key={band.id} id={bandId(band.id)} label={`Band ${i + 1}, ${formatFreqHz(band.frequency)}, ${formatGain(band.gain)} dB${band.enabled ? '' : ', off'}`}
          onFocus={() => eq.selectBand(band.id)} onPress={() => setGrab(grab ? null : { kind: 'band', id: band.id })} onDirection={grab?.kind === 'band' && grab.id === band.id ? edit : undefined}
          links={{ left: i ? bandId(eq.bands[i - 1].id) : undefined, right: i + 1 < eq.bands.length ? bandId(eq.bands[i + 1].id) : eq.bands.length < EQ_MAX_BANDS ? 'eq:add' : undefined, up: toolId(lastTool), down: `eq:set:${lastSet === 'remove' && eq.bands.length <= 1 ? 'type' : lastSet}` }}
          style={[box(51 + i * 78, 344, 72, 52), { borderRadius: 9, paddingLeft: 12, borderWidth: 1, borderColor: tv.border, backgroundColor: tv.hover }, grab?.kind === 'band' && grab.id === band.id && heldStyle]}>
          <View style={{ position: 'absolute', left: 0, top: 9, bottom: 9, width: 3, borderRadius: 2, backgroundColor: bandColor(palette, band), opacity: band.enabled ? 1 : .45 }} />
          <TvText mono size={12.5} color={band.enabled ? tv.caption : tv.faint}>{formatFreqHz(band.frequency).replace(' Hz', '').replace(' kHz', 'k')}</TvText>
          <TvText mono size={11} color={band.enabled ? tv.muted : tv.faint} style={{ marginTop: 4 }}>{isPassEQBandType(band.type) ? '—' : formatGain(band.gain)}</TvText>
        </TvButton>)}
        {eq.bands.length < EQ_MAX_BANDS && <TvButton id="eq:add" label="Add band" links={{ left: eq.bands.length ? bandId(eq.bands.at(-1)!.id) : undefined, up: toolId(lastTool) }} onPress={() => { eq.addBand(); const id = useEQStore.getState().activeBandId; if (id) request(bandId(id)); }}
          style={[box(51 + eq.bands.length * 78, 344, 72, 52), { borderRadius: 9, borderWidth: 1, borderStyle: 'dashed', borderColor: tv.border, alignItems: 'center' }]}><TvText size={12} color={tv.muted} style={{ textAlign: 'center' }}>+ Add{'\n'}band</TvText></TvButton>}
        {selected && <View style={[box(51, 412, 858, 34), { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
          <TvText mono size={10.5} color={tv.faint} style={{ width: 68, letterSpacing: 1.4 }}>BAND {index + 1}</TvText>
          {settings.map((setting, i) => <TvButton key={setting.key} id={`eq:set:${setting.key}`} label={setting.label} disabled={setting.disabled} onPress={setting.run} onFocus={() => setLastSet(setting.key)} onDirection={setting.key === 'q' && grab?.kind === 'q' ? edit : undefined}
            links={{ up: bandId(selected.id), left: i ? `eq:set:${sets[i - 1]}` : undefined, right: i + 1 < settings.length && !settings[i + 1].disabled ? `eq:set:${sets[i + 1]}` : undefined }}
            style={[control, { width: setting.width }, grab?.kind === 'q' && setting.key === 'q' && heldStyle]}>{setting.content}</TvButton>)}
        </View>}
      </> : GRAPHIC_BANDS.map((band, i) => {
        const gain = eq.graphicGains[i]; const y = 88 - gain / 12 * 50; const held = grab?.kind === 'slider' && grab.index === i; const color = palette.colors[i];
        return <TvButton key={band.key} id={sliderId(i)} label={`${band.label}, ${formatFreqHz(band.frequency)}, ${formatGain(gain)} dB`} onFocus={() => setSlider(i)} onPress={() => setGrab(grab ? null : { kind: 'slider', index: i })} onDirection={held ? edit : undefined}
          links={{ left: i ? sliderId(i - 1) : undefined, right: i + 1 < GRAPHIC_BANDS.length ? sliderId(i + 1) : undefined, up: toolId(lastTool) }}
          style={[box(76.8 + i * 171.6, 280, 120, 186), { borderRadius: 14, backgroundColor: held ? 'rgba(169,192,255,.12)' : focused === sliderId(i) ? tv.hover : 'transparent' }]} ringStyle={{ top: 0, bottom: 0, left: 0, right: 0, borderRadius: 14 }}>
          <TvText mono size={13} style={[box(0, 12, 120), { textAlign: 'center' }]}>{formatGain(gain)}</TvText>
          <View style={[box(58, 38, 4, 100), { borderRadius: 2, backgroundColor: 'rgba(124,146,196,.2)' }]} />
          <View style={[box(48, 88, 24, 1), { backgroundColor: tv.border }]} />
          <View style={[box(58, Math.min(y, 88), 4, Math.abs(y - 88)), { borderRadius: 2, backgroundColor: held ? tv.accent : color }]} />
          <View style={[box(51, y - 9, 18, 18), { borderRadius: 9, backgroundColor: held ? '#fff' : color, ...(held ? { boxShadow: '0 0 0 5px rgba(255,255,255,.15)' } : {}) }]} />
          <TvText weight="medium" style={[box(0, 150, 120), { textAlign: 'center' }]}>{band.label}</TvText>
          <TvText mono size={10.5} color={tv.faint} style={[box(0, 168, 120), { textAlign: 'center' }]}>{formatFreqHz(band.frequency)}</TvText>
        </TvButton>;
      })}
      <TvText size={12.5} color={tv.muted} style={box(51, 480, 858)}>{hint}</TvText>
    </TvFocusRegion>
    {flow && <TvFocusRegion enabled><View style={box(0, 0, 960, 540)}>
      {flow.kind === 'name' && <TvNameFlow labels={{ eyebrow: 'EQ PRESET', title: 'Name your preset', description: flow.after === 'devices' ? 'Save these settings before assigning them to output devices.' : 'Choose a name for these equalizer settings.', field: 'Preset name', verb: flow.after === 'qr' ? 'Show QR' : 'Save' }} cancel={closeFlow} submit={async name => {
        if (flow.after === 'qr') { Keyboard.dismiss(); showQr(name); }
        else { const id = eq.saveCustomPreset(name); if (flow.after === 'devices') { Keyboard.dismiss(); setFlow({ kind: 'devices', preset: useEQStore.getState().presets.find(item => item.id === id)! }); } else closeFlow(); }
      }} />}
      {flow.kind === 'qr' && <TvEqQr name={flow.name} value={flow.value} close={closeFlow} />}
      {flow.kind === 'devices' && <TvEqDevices preset={flow.preset} close={closeFlow} />}
      {flow.kind === 'import' && <TvEqImportPreview preset={flow.preset} save={() => { eq.importPreset(flow.preset); closeFlow(); }} cancel={closeFlow} />}
      {flow.kind === 'loading' && <View style={{ flex: 1, backgroundColor: tv.bg }}><TvText size={22} style={box(51, 90, 858)}>Choose a preset file</TvText><TvButton id="eq:import:cancel" label="Cancel file selection" onPress={closeFlow} style={[box(51, 150, 180, 38), { backgroundColor: tv.fill, alignItems: 'center' }]}><TvText>Cancel</TvText></TvButton></View>}
    </View></TvFocusRegion>}
  </>;
}
