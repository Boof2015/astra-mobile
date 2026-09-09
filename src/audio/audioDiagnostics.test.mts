import assert from 'node:assert/strict';
import test from 'node:test';
import { capabilityList, formatDiagnosticFormat, formatDiagnosticSource, formatEncoding, outputComparison, outputDescription, type AudioDiagnosticsSnapshot } from './audioDiagnostics.ts';

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
