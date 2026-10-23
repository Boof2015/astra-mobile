import type { AudioOutputRoute } from '../types/audio';

export interface DiagnosticFormat {
  sampleRate: number | null;
  encoding: string | null;
  channels: number | null;
  mimeType?: string | null;
}

export interface DiagnosticSource {
  codec?: string | null;
  trackId: string | null;
  entryId: string | null;
  title: string | null;
  artist: string | null;
  format: string | null;
  sampleRate: number | null;
  bitDepth: number | null;
  channels: number | null;
}

export interface DiagnosticProfile {
  encoding: string | null;
  sampleRates: number[];
  channelCounts: number[];
}

/** An Android 14+ preferred-mixer option a USB output offers. */
export interface MixerProfile {
  sampleRate: number;
  encoding: string | null;
  channels: number | null;
  bitPerfect: boolean;
}

/**
 * "direct": Android passes the stream to the device unmixed; "mixer": Android's mixer output;
 * "vendor": the phone's audio system retunes the output itself and apps can't read it (Samsung).
 */
export interface DeviceOutput extends DiagnosticFormat {
  path: 'direct' | 'mixer' | 'vendor';
}

export interface AudioDiagnosticsSnapshot {
  generation: number;
  state: 'playing' | 'paused' | 'loading' | 'stopped' | 'error';
  source: DiagnosticSource | null;
  stream: DiagnosticFormat | null;
  decoder: string | null;
  sinkInput: DiagnosticFormat | null;
  output: DiagnosticFormat | null;
  outputStatus: 'inactive' | 'observed' | 'pending' | 'unavailable';
  /** The hardware stream Android plays Astra through. */
  deviceOutput: DeviceOutput | null;
  route: AudioOutputRoute | null;
  routeProvenance: 'media-prediction' | 'connected-device-fallback' | 'unavailable';
  capabilities: {
    sampleRates: number[];
    encodings: string[];
    channelCounts: number[];
    profiles: DiagnosticProfile[] | null;
    /** null when Android cannot be asked; [] when this phone offers none. */
    mixer: MixerProfile[] | null;
    mixerUnavailableReason: 'not-usb' | 'android-version' | null;
  } | null;
  processing: { eqEnabled: boolean; preampDb: number | null; gainTargetDb: number | null };
  updatedAt: number;
}

export function formatSampleRate(rate: number): string {
  return `${Number((rate / 1000).toFixed(3))} kHz`;
}

export function formatEncoding(encoding: string | null): string {
  switch (encoding) {
    case 'pcm-8': return '8-bit PCM';
    case 'pcm-16': return '16-bit PCM';
    case 'pcm-24': return '24-bit PCM';
    case 'pcm-32': return '32-bit PCM';
    case 'pcm-float': return '32-bit float PCM';
    default: return encoding?.startsWith('encoded:') ? `Encoded format (${encoding.slice(8)})` : 'Not reported';
  }
}

export function formatChannels(channels: number): string {
  return channels === 1 ? 'Mono' : channels === 2 ? 'Stereo' : `${channels} channels`;
}

export function formatDiagnosticFormat(format: DiagnosticFormat | null): string {
  if (!format) return 'Not reported';
  return [
    format.sampleRate && format.sampleRate > 0 ? formatSampleRate(format.sampleRate) : null,
    format.encoding ? formatEncoding(format.encoding) : format.mimeType?.replace(/^audio\//, '').toUpperCase(),
    format.channels && format.channels > 0 ? formatChannels(format.channels) : null,
  ].filter(Boolean).join(' · ') || 'Not reported';
}

const LOSSY_FORMATS = /^(mp3|aac|m4a|mp4|ogg|oga|opus|vorbis|wma|ac3|eac3|e-ac-3|dts)$/i;
const LOSSY_CODECS = /(?:aac|mp4a|mp3|mpeg|opus|vorbis|wma|ac-?3|dts)/i;

function sourceContainer(source: DiagnosticSource): string {
  return source.format?.replace(/^\./, '') ?? '';
}

/** Lossy sources have no meaningful bit depth; a decoder's depth is not source precision. */
function isLossySource(source: DiagnosticSource): boolean {
  const losslessCodec = /^(alac|flac|pcm(?:_|-|$)|wavpack|ape)/i.test(source.codec ?? '');
  return !losslessCodec && (LOSSY_FORMATS.test(sourceContainer(source)) || LOSSY_CODECS.test(source.codec ?? ''));
}

export function formatDiagnosticSource(source: DiagnosticSource | null): string {
  if (!source) return 'No track loaded';
  return [
    sourceContainer(source).toUpperCase(),
    source.sampleRate && source.sampleRate > 0 ? formatSampleRate(source.sampleRate) : null,
    source.bitDepth && source.bitDepth > 0 && !isLossySource(source) ? `${source.bitDepth}-bit` : null,
    source.channels && source.channels > 0 ? formatChannels(source.channels) : null,
  ].filter(Boolean).join(' · ') || 'Format not reported';
}

/** Short pill tokens in the track-list badge style ("FLAC", "24-BIT", "96 kHz"). */
export function encodingBadge(encoding: string | null): string | null {
  switch (encoding) {
    case 'pcm-8': return '8-BIT';
    case 'pcm-16': return '16-BIT';
    case 'pcm-24': return '24-BIT';
    case 'pcm-32': return '32-BIT';
    case 'pcm-float': return 'FLOAT';
    default: return encoding?.startsWith('encoded:') ? 'ENCODED' : null;
  }
}

export function channelBadge(channels: number): string {
  return channels === 1 ? 'MONO' : channels === 2 ? 'STEREO' : `${channels} CH`;
}

export function formatBadges(format: DiagnosticFormat | null): string[] {
  if (!format) return [];
  return [
    format.sampleRate && format.sampleRate > 0 ? formatSampleRate(format.sampleRate) : null,
    format.encoding ? encodingBadge(format.encoding) : format.mimeType?.replace(/^audio\//, '').toUpperCase() ?? null,
    format.channels && format.channels > 0 ? channelBadge(format.channels) : null,
  ].filter((badge): badge is string => !!badge);
}

export function sourceBadges(source: DiagnosticSource | null): string[] {
  if (!source) return [];
  return [
    sourceContainer(source).toUpperCase() || null,
    source.sampleRate && source.sampleRate > 0 ? formatSampleRate(source.sampleRate) : null,
    source.bitDepth && source.bitDepth > 0 && !isLossySource(source) ? `${source.bitDepth}-BIT` : null,
    source.channels && source.channels > 0 ? channelBadge(source.channels) : null,
  ].filter((badge): badge is string => !!badge);
}

/** How Astra's stream reaches the device, in words; null when Android reports nothing. */
export function deviceOutputPath(snapshot: AudioDiagnosticsSnapshot | null): string | null {
  switch (snapshot?.deviceOutput?.path) {
    case 'direct': return 'Direct to the device, skipping Android’s mixer';
    case 'mixer': return 'Through Android’s mixer';
    case 'vendor': return 'Your phone’s audio system sets this rate itself and doesn’t report it to apps';
    default: return null;
  }
}

export interface OutputComparison {
  text: string;
  /** True when some stage converts the sample rate. */
  changed: boolean;
}

export function outputComparison(snapshot: AudioDiagnosticsSnapshot | null): string | null {
  return compareOutput(snapshot)?.text ?? null;
}

/** Native ownership checks already ensure these observations belong to this source. */
export function compareOutput(snapshot: AudioDiagnosticsSnapshot | null): OutputComparison | null {
  if (!snapshot || snapshot.outputStatus !== 'observed' || snapshot.state !== 'playing') return null;
  const source = snapshot.source?.sampleRate;
  const stream = snapshot.stream?.sampleRate;
  const output = snapshot.output?.sampleRate;
  if (!source || source <= 0 || !output || output <= 0) return null;
  if (stream && stream !== source) {
    return { text: `File ${formatSampleRate(source)} · received stream ${formatSampleRate(stream)} · Astra output ${formatSampleRate(output)}`, changed: true };
  }
  if (source !== output) return { text: `Sample rate changes: ${Number((source / 1000).toFixed(3))} → ${formatSampleRate(output)}`, changed: true };
  if (snapshot.deviceOutput?.path === 'direct') return { text: 'Direct to device · no Android mixing or resampling', changed: false };
  const device = snapshot.deviceOutput?.sampleRate;
  if (!device || device <= 0) return { text: 'Sample rate matches at Astra output', changed: false };
  return device === output
    ? { text: 'Sample rate matches at Android output', changed: false }
    : { text: `Android resamples ${Number((output / 1000).toFixed(3))} → ${formatSampleRate(device)}`, changed: true };
}

export function formatDeviceOutput(snapshot: AudioDiagnosticsSnapshot | null): string {
  const output = snapshot?.deviceOutput ?? null;
  if (output?.path === 'vendor') return 'Not reported · your phone’s audio system sets this rate itself';
  const format = formatDiagnosticFormat(output);
  if (!output || format === 'Not reported') return format;
  return `${format} · ${output.path === 'direct' ? 'Direct' : 'Android mixer'}`;
}

function mixerProfiles(snapshot: AudioDiagnosticsSnapshot | null, kind: 'match' | 'bit-perfect'): MixerProfile[] | null {
  return snapshot?.capabilities?.mixer?.filter((p) => p.bitPerfect === (kind === 'bit-perfect')) ?? null;
}

/** Lists every offered rate rather than a range: a gap (no 44.1 kHz) decides whether matching helps. */
export function mixerSupport(snapshot: AudioDiagnosticsSnapshot | null, kind: 'match' | 'bit-perfect'): string {
  const capabilities = snapshot?.capabilities;
  if (!capabilities) return 'Not reported';
  if (capabilities.mixerUnavailableReason === 'not-usb') return 'USB DACs only';
  if (capabilities.mixerUnavailableReason === 'android-version') return 'Needs Android 14 or newer';
  const profiles = mixerProfiles(snapshot, kind);
  if (profiles == null) return 'Not reported';
  const rates = [...new Set(profiles.map((p) => p.sampleRate))].filter((r) => r > 0).sort((a, b) => a - b);
  if (!rates.length) return 'Not offered by this phone';
  return `Available · ${rates.map((r) => Number((r / 1000).toFixed(3))).join(' · ')} kHz`;
}

export function mixerEncodings(snapshot: AudioDiagnosticsSnapshot | null, kind: 'match' | 'bit-perfect'): string | null {
  const encodings = [...new Set(mixerProfiles(snapshot, kind)?.map((p) => p.encoding) ?? [])].filter((e): e is string => e != null);
  return encodings.length ? encodings.map(formatEncoding).join(' · ') : null;
}

export function outputDescription(snapshot: AudioDiagnosticsSnapshot | null): string {
  if (!snapshot) return 'Not available';
  if (snapshot.state === 'stopped') return 'No active output';
  if (snapshot.state === 'error') return 'Playback unavailable';
  const output = snapshot.outputStatus === 'observed' ? snapshot.output : null;
  if (snapshot.state === 'paused') return output ? `${formatDiagnosticFormat(output)} · paused configuration` : 'Paused · no observed configuration';
  if (snapshot.state === 'loading') return 'Buffering · waiting for current output';
  return output ? formatDiagnosticFormat(output) : snapshot.outputStatus === 'pending' ? 'Waiting for current output' : 'Not reported';
}

export function capabilityList<T>(values: T[] | null | undefined, format: (value: T) => string): string {
  if (values == null) return 'Not reported';
  return values.length ? values.map(format).join(' · ') : 'No fixed list reported';
}
