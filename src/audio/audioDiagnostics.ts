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

export interface AudioDiagnosticsSnapshot {
  generation: number;
  state: 'playing' | 'paused' | 'loading' | 'stopped' | 'error';
  source: DiagnosticSource | null;
  stream: DiagnosticFormat | null;
  decoder: string | null;
  sinkInput: DiagnosticFormat | null;
  output: DiagnosticFormat | null;
  outputStatus: 'inactive' | 'observed' | 'pending' | 'unavailable';
  deviceOutput: null;
  route: AudioOutputRoute | null;
  routeProvenance: 'media-prediction' | 'connected-device-fallback' | 'unavailable';
  capabilities: {
    sampleRates: number[];
    encodings: string[];
    channelCounts: number[];
    profiles: DiagnosticProfile[] | null;
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

export function formatDiagnosticSource(source: DiagnosticSource | null): string {
  if (!source) return 'No track loaded';
  const format = source.format?.replace(/^\./, '') ?? '';
  const losslessCodec = /^(alac|flac|pcm(?:_|-|$)|wavpack|ape)/i.test(source.codec ?? '');
  const lossy = !losslessCodec && (LOSSY_FORMATS.test(format) || LOSSY_CODECS.test(source.codec ?? ''));
  return [
    format.toUpperCase(),
    source.sampleRate && source.sampleRate > 0 ? formatSampleRate(source.sampleRate) : null,
    source.bitDepth && source.bitDepth > 0 && !lossy ? `${source.bitDepth}-bit` : null,
    source.channels && source.channels > 0 ? formatChannels(source.channels) : null,
  ].filter(Boolean).join(' · ') || 'Format not reported';
}

/** Native ownership checks already ensure these observations belong to this source. */
export function outputComparison(snapshot: AudioDiagnosticsSnapshot | null): string | null {
  if (!snapshot || snapshot.outputStatus !== 'observed' || snapshot.state !== 'playing') return null;
  const source = snapshot.source?.sampleRate;
  const stream = snapshot.stream?.sampleRate;
  const output = snapshot.output?.sampleRate;
  if (!source || source <= 0 || !output || output <= 0) return null;
  if (stream && stream !== source) {
    return `File ${formatSampleRate(source)} · received stream ${formatSampleRate(stream)} · Astra output ${formatSampleRate(output)}`;
  }
  return source === output ? 'Sample rate matches at Astra output' : `Sample rate changes: ${Number((source / 1000).toFixed(3))} → ${formatSampleRate(output)}`;
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
