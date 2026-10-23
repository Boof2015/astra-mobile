import assert from 'node:assert/strict';
import test from 'node:test';
import { capabilityList, channelBadge, compareOutput, deviceOutputPath, encodingBadge, formatBadges, sourceBadges, formatDeviceOutput, formatDiagnosticFormat, formatDiagnosticSource, formatEncoding, mixerEncodings, mixerSupport, outputComparison, outputDescription, type AudioDiagnosticsSnapshot } from './audioDiagnostics.ts';

const snapshot: AudioDiagnosticsSnapshot = {
  generation: 1, state: 'playing', source: { trackId: '1', entryId: 'one', title: 'Song', artist: 'Artist', format: 'flac', sampleRate: 96000, bitDepth: 24, channels: 2 },
  stream: { sampleRate: 96000, encoding: null, channels: 2, mimeType: 'audio/flac' },
  decoder: 'decoder', sinkInput: null, output: { sampleRate: 48000, encoding: 'pcm-16', channels: 2 },
  outputStatus: 'observed', deviceOutput: null, route: null, routeProvenance: 'unavailable', capabilities: null,
  processing: { eqEnabled: false, preampDb: 0, gainTargetDb: 0 }, updatedAt: 1,
};

test('source and output show independent bit depths and distinguish float', () => {
  assert.equal(formatDiagnosticSource(snapshot.source), 'FLAC · 96 kHz · 24-bit · Stereo');
  assert.equal(outputDescription(snapshot), '48 kHz · 16-bit PCM · Stereo');
  assert.equal(formatEncoding('pcm-float'), '32-bit float PCM');
  assert.equal(formatEncoding('pcm-32'), '32-bit PCM');
  assert.equal(formatDiagnosticFormat(null), 'Not reported');
  assert.equal(formatDiagnosticFormat({ sampleRate: -1, encoding: null, channels: -1 }), 'Not reported');
});

test('lossy formats do not inherit a decoder bit depth as source precision', () => {
  assert.equal(formatDiagnosticSource({ ...snapshot.source!, format: 'mp3', sampleRate: 44100, bitDepth: 16 }), 'MP3 · 44.1 kHz · Stereo');
  assert.match(formatDiagnosticSource({ ...snapshot.source!, format: 'm4a', codec: 'alac' }), /24-bit/);
  assert.doesNotMatch(formatDiagnosticSource({ ...snapshot.source!, format: 'm4a', codec: 'aac' }), /24-bit/);
  assert.doesNotMatch(formatDiagnosticSource({ ...snapshot.source!, format: 'mp3', codec: 'audio/mpeg' }), /24-bit/);
});

test('rate comparisons require current observations and distinguish a transcoded stream', () => {
  assert.equal(outputComparison(snapshot), 'Sample rate changes: 96 → 48 kHz');
  assert.equal(outputComparison({ ...snapshot, output: { ...snapshot.output!, sampleRate: 96000 } }), 'Sample rate matches at Astra output');
  for (const state of ['paused', 'stopped', 'loading', 'error'] as const) assert.equal(outputComparison({ ...snapshot, state }), null);
  assert.equal(outputComparison({ ...snapshot, outputStatus: 'pending' }), null);
  assert.equal(outputComparison({ ...snapshot, source: { ...snapshot.source!, sampleRate: null } }), null);
  assert.match(outputComparison({ ...snapshot, stream: { ...snapshot.stream!, sampleRate: 48000 } })!, /File 96 kHz · received stream 48 kHz/);
});

test('paused, stopped, buffering, unavailable and unenumerated values remain explicit', () => {
  assert.match(outputDescription({ ...snapshot, state: 'paused' }), /paused configuration/);
  assert.equal(outputDescription({ ...snapshot, state: 'stopped' }), 'No active output');
  assert.match(outputDescription({ ...snapshot, state: 'loading' }), /Buffering/);
  assert.equal(outputDescription(null), 'Not available');
  assert.equal(formatDiagnosticSource(null), 'No track loaded');
  assert.equal(capabilityList([], String), 'No fixed list reported');
  assert.equal(capabilityList(null, String), 'Not reported');
  assert.equal(capabilityList([1, 2], String), '1 · 2');
});

const usb = (mixer: NonNullable<AudioDiagnosticsSnapshot['capabilities']>['mixer'], mixerUnavailableReason: 'not-usb' | 'android-version' | null = null): AudioDiagnosticsSnapshot => ({
  ...snapshot, capabilities: { sampleRates: [], encodings: [], channelCounts: [], profiles: null, mixer, mixerUnavailableReason },
});

test('android output reports the hardware stream format and its path', () => {
  assert.equal(formatDeviceOutput(null), 'Not reported');
  assert.equal(formatDeviceOutput(snapshot), 'Not reported');
  assert.equal(formatDeviceOutput({ ...snapshot, deviceOutput: { sampleRate: 0, encoding: null, channels: null, path: 'mixer' } }), 'Not reported');
  assert.equal(formatDeviceOutput({ ...snapshot, deviceOutput: { sampleRate: 48000, encoding: 'pcm-24', channels: 2, path: 'mixer' } }), '48 kHz · 24-bit PCM · Stereo · Android mixer');
  assert.equal(formatDeviceOutput({ ...snapshot, deviceOutput: { sampleRate: 96000, encoding: 'pcm-16', channels: 2, path: 'direct' } }), '96 kHz · 16-bit PCM · Stereo · Direct');
  assert.match(formatDeviceOutput({ ...snapshot, deviceOutput: { sampleRate: null, encoding: null, channels: null, path: 'vendor' } }), /^Not reported · /);
  const vendor = { ...snapshot, output: { ...snapshot.output!, sampleRate: 96000 }, deviceOutput: { sampleRate: null, encoding: null, channels: null, path: 'vendor' as const } };
  assert.equal(outputComparison(vendor), 'Sample rate matches at Astra output');
});

test('android resampling is named only once astra output matches the file', () => {
  const matched = { ...snapshot, output: { ...snapshot.output!, sampleRate: 96000 } };
  const device = (sampleRate: number, path: 'direct' | 'mixer' = 'mixer') => ({ sampleRate, encoding: 'pcm-24', channels: 2, path });
  assert.equal(outputComparison({ ...matched, deviceOutput: device(96000, 'direct') }), 'Direct to device · no Android mixing or resampling');
  assert.equal(outputComparison({ ...snapshot, deviceOutput: device(48000, 'direct') }), 'Sample rate changes: 96 → 48 kHz');
  assert.equal(outputComparison({ ...matched, deviceOutput: device(48000) }), 'Android resamples 96 → 48 kHz');
  assert.equal(outputComparison({ ...matched, deviceOutput: device(96000) }), 'Sample rate matches at Android output');
  assert.equal(outputComparison({ ...snapshot, deviceOutput: device(44100) }), 'Sample rate changes: 96 → 48 kHz');
});

test('mixer support separates behaviors and explains why it is unavailable', () => {
  const profiles = [
    { sampleRate: 44100, encoding: 'pcm-16', channels: 2, bitPerfect: true },
    { sampleRate: 44100, encoding: 'pcm-24', channels: 2, bitPerfect: false },
    { sampleRate: 48000, encoding: 'pcm-24', channels: 2, bitPerfect: false },
    { sampleRate: 96000, encoding: 'pcm-32', channels: 2, bitPerfect: false },
    { sampleRate: 96000, encoding: 'pcm-16', channels: 2, bitPerfect: true },
  ];
  assert.equal(mixerSupport(usb(profiles), 'match'), 'Available · 44.1 · 48 · 96 kHz');
  assert.equal(mixerSupport(usb(profiles), 'bit-perfect'), 'Available · 44.1 · 96 kHz');
  assert.equal(mixerEncodings(usb(profiles), 'match'), '24-bit PCM · 32-bit PCM');
  assert.equal(mixerEncodings(usb(profiles), 'bit-perfect'), '16-bit PCM');
  assert.equal(mixerSupport(usb(profiles.filter((p) => !p.bitPerfect)), 'bit-perfect'), 'Not offered by this phone');
  assert.equal(mixerSupport(usb([]), 'match'), 'Not offered by this phone');
  assert.equal(mixerEncodings(usb([]), 'match'), null);
  assert.equal(mixerSupport(usb(null, 'not-usb'), 'match'), 'USB DACs only');
  assert.equal(mixerSupport(usb(null, 'android-version'), 'bit-perfect'), 'Needs Android 14 or newer');
  assert.equal(mixerSupport(usb(null), 'match'), 'Not reported');
  assert.equal(mixerSupport(snapshot, 'match'), 'Not reported');
});

test('badges are short tokens and keep lossy sources free of a bit depth', () => {
  assert.deepEqual(sourceBadges(snapshot.source), ['FLAC', '96 kHz', '24-BIT', 'STEREO']);
  assert.deepEqual(sourceBadges({ ...snapshot.source!, format: 'mp3', sampleRate: 44100, bitDepth: 16 }), ['MP3', '44.1 kHz', 'STEREO']);
  assert.deepEqual(sourceBadges(null), []);
  assert.deepEqual(formatBadges(snapshot.output), ['48 kHz', '16-BIT', 'STEREO']);
  assert.deepEqual(formatBadges(snapshot.stream), ['96 kHz', 'FLAC', 'STEREO']);
  assert.deepEqual(formatBadges({ sampleRate: -1, encoding: null, channels: null }), []);
  assert.equal(encodingBadge('pcm-float'), 'FLOAT');
  assert.equal(encodingBadge('encoded:7'), 'ENCODED');
  assert.equal(encodingBadge(null), null);
  assert.equal(channelBadge(6), '6 CH');
});

test('comparison flags conversions and device paths read as words', () => {
  assert.deepEqual(compareOutput(snapshot), { text: 'Sample rate changes: 96 → 48 kHz', changed: true });
  const matched = { ...snapshot, output: { ...snapshot.output!, sampleRate: 96000 } };
  assert.equal(compareOutput(matched)?.changed, false);
  assert.equal(compareOutput({ ...matched, deviceOutput: { sampleRate: 48000, encoding: null, channels: null, path: 'mixer' } })?.changed, true);
  assert.equal(deviceOutputPath(snapshot), null);
  assert.match(deviceOutputPath({ ...snapshot, deviceOutput: { sampleRate: null, encoding: null, channels: null, path: 'vendor' } })!, /sets this rate itself/);
  assert.match(deviceOutputPath({ ...snapshot, deviceOutput: { sampleRate: 96000, encoding: 'pcm-16', channels: 2, path: 'direct' } })!, /^Direct/);
});
