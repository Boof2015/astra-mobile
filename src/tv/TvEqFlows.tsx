import { useEffect, useState } from 'react';
import { View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import type { EQPreset } from '@/types/audio';
import { useEQStore } from '@/stores/eqStore';
import { formatGain } from '@/components/eq/format';
import { TvButton, useTvFocus } from './TvFocus';
import { box, tv, TvText } from './TvPrimitives';
import { TvEqGraph } from './TvEqGraph';

export function TvEqQr({ name, value, close }: { name: string; value: string; close: () => void }) {
  const { request } = useTvFocus();
  useEffect(() => { request('eq:flow:done'); }, [request]);
  return <View style={{ flex: 1, backgroundColor: tv.bg }}>
    <TvText size={28} weight="semibold" numberOfLines={1} style={box(51, 57, 858)}>Share {name}</TvText>
    <TvText color={tv.muted} style={box(51, 102, 858)}>Scan this code with Astra on your phone to import the preset.</TvText>
    <View style={[box(340, 147, 280, 280), { padding: 14, backgroundColor: '#fff', borderRadius: 12 }]}>
      <QRCode value={value} size={252} color="#000" backgroundColor="#fff" quietZone={8} ecl="M" />
    </View>
    <TvButton id="eq:flow:done" label="Done" onPress={close} style={[box(400, 461, 160, 38), { backgroundColor: tv.fill, alignItems: 'center' }]}><TvText>Done</TvText></TvButton>
  </View>;
}

export function TvEqImportPreview({ preset, save, cancel }: { preset: EQPreset; save: () => void; cancel: () => void }) {
  const { request } = useTvFocus();
  useEffect(() => { request('eq:flow:import'); }, [request]);
  return <View style={{ flex: 1, backgroundColor: tv.bg }}>
    <TvText mono size={10.5} color={tv.accent} style={box(51, 54, 858)}>IMPORT PRESET</TvText>
    <TvText size={28} weight="semibold" numberOfLines={1} style={box(51, 81, 858)}>{preset.name}</TvText>
    <TvText color={tv.muted} style={box(51, 126, 858)}>{preset.mode === 'graphic' ? 'Graphic' : 'Parametric'} · {preset.bands.length} bands · Preamp {formatGain(preset.preamp)} dB</TvText>
    <View style={box(51, 180, 858, 206)}><TvEqGraph bands={preset.bands} height={206} selected={null} grabbed={false} /></View>
    <TvButton id="eq:flow:import" label="Import and apply" onPress={save} links={{ right: 'eq:flow:cancel' }} style={[box(51, 450, 180, 38), { backgroundColor: tv.fill, alignItems: 'center' }]}><TvText color={tv.accent}>Import and apply</TvText></TvButton>
    <TvButton id="eq:flow:cancel" label="Cancel" onPress={cancel} links={{ left: 'eq:flow:import' }} style={[box(247, 450, 120, 38), { backgroundColor: tv.fill, alignItems: 'center' }]}><TvText>Cancel</TvText></TvButton>
  </View>;
}

export function TvEqDevices({ preset, close }: { preset: EQPreset; close: () => void }) {
  const eq = useEQStore(); const { request, focused } = useTvFocus();
  const [selected, setSelected] = useState(() => new Set(Object.keys(eq.devicePresetAssignments).filter(key => eq.devicePresetAssignments[key] === preset.id)));
  const [deviceIndex, setDeviceIndex] = useState(0);
  const devices = Object.values(eq.knownOutputDevices).sort((a, b) => a.key === eq.activeOutputRoute?.key ? -1 : b.key === eq.activeOutputRoute?.key ? 1 : b.lastSeenAt - a.lastSeenAt || a.label.localeCompare(b.label));
  const initial = devices.length ? `eq:device:${devices[0].key}` : 'eq:devices:save';
  useEffect(() => { request(initial); }, [request, initial]);
  const start = Math.max(0, Math.min(deviceIndex - 2, devices.length - 5));
  return <View style={{ flex: 1, backgroundColor: tv.bg }}>
    <TvText size={28} weight="semibold" numberOfLines={1} style={box(51, 57, 858)}>Use {preset.name} for output devices</TvText>
    <TvText color={tv.muted} style={box(51, 102, 858)}>This preset will load when a selected output becomes active.</TvText>
    {!devices.length && <TvText color={tv.muted} style={box(51, 160, 858)}>Connect an audio output to make it available here.</TvText>}
    <View style={[box(51, 151, 858, 284), { overflow: 'hidden' }]}>
      {devices.slice(start, start + 5).map((device, at) => {
        const i = start + at; const assigned = eq.presets.find(item => item.id === eq.devicePresetAssignments[device.key]);
        const name = device.kind === 'speaker' ? 'TV speakers' : device.label;
        return <TvButton key={device.key} id={`eq:device:${device.key}`} onFocus={() => setDeviceIndex(i)} label={`${name}${device.key === eq.activeOutputRoute?.key ? ', current output' : ''}, ${selected.has(device.key) ? 'selected' : 'not selected'}`}
          links={{ up: i ? `eq:device:${devices[i - 1].key}` : undefined, down: i + 1 < devices.length ? `eq:device:${devices[i + 1].key}` : 'eq:devices:save' }}
          onPress={() => setSelected(previous => { const next = new Set(previous); if (next.has(device.key)) next.delete(device.key); else next.add(device.key); return next; })}
          style={[box(4, 4 + at * 55, 850, 49), { paddingHorizontal: 14, backgroundColor: focused === `eq:device:${device.key}` ? tv.fill : 'rgba(124,146,196,.05)', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
          <View><TvText size={15}>{name}{device.key === eq.activeOutputRoute?.key ? ' · Current' : ''}</TvText><TvText size={11.5} color={tv.muted}>{assigned ? `Assigned to ${assigned.name}` : 'No automatic preset'}</TvText></View>
          <TvText size={20} color={selected.has(device.key) ? tv.accent : tv.muted}>{selected.has(device.key) ? '☑' : '□'}</TvText>
        </TvButton>;
      })}
    </View>
    <TvButton id="eq:devices:save" label="Save assignments" onPress={() => { eq.assignPresetToDevices(preset.id, [...selected]); close(); }} links={{ up: devices.length ? `eq:device:${devices.at(-1)!.key}` : undefined, right: 'eq:devices:cancel' }} style={[box(51, 458, 180, 38), { backgroundColor: tv.fill, alignItems: 'center' }]}><TvText color={tv.accent}>Save assignments</TvText></TvButton>
    <TvButton id="eq:devices:cancel" label="Cancel" onPress={close} links={{ left: 'eq:devices:save', up: devices.length ? `eq:device:${devices.at(-1)!.key}` : undefined }} style={[box(247, 458, 120, 38), { backgroundColor: tv.fill, alignItems: 'center' }]}><TvText>Cancel</TvText></TvButton>
  </View>;
}
