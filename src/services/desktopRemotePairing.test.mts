import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeDesktopRemotePinInput,
  parseDesktopRemoteManualInput,
  parseDesktopRemotePairingInput,
} from './desktopRemotePairing.ts';

const fingerprint = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';

test('rejects browser and legacy HTTP pairing links on the native client', () => {
  assert.equal(
    parseDesktopRemotePairingInput('https://192.168.1.20:38402/remote/#pair=abcDEF_1234567890'),
    null
  );
  assert.equal(
    parseDesktopRemotePairingInput('http://192.168.1.20:38402/remote/#pair=abcDEF_1234567890'),
    null
  );
});

test('parses native pairing links without accepting missing base URLs', () => {
  assert.deepEqual(
    parseDesktopRemotePairingInput(
      'astra://desktop-remote/pair?baseUrl=http%3A%2F%2F10.0.0.8%3A38402&ticket=abcDEF_1234567890'
    ),
    null
  );
  assert.deepEqual(
    parseDesktopRemotePairingInput(
      `astra://desktop-remote?baseUrl=https%3A%2F%2F10.0.0.8%3A38402&ticket=abcDEF_1234567890&endpointUuid=endpoint-1&fingerprint=${encodeURIComponent(fingerprint)}&protocolVersion=3`
    ),
    {
      baseUrl: 'https://10.0.0.8:38402',
      ticket: 'abcDEF_1234567890',
      endpointUuid: 'endpoint-1',
      protocolVersion: 3,
      certificateFingerprint: fingerprint,
    }
  );
  assert.equal(parseDesktopRemotePairingInput('astra://desktop-remote/pair?ticket=abcDEF_1234567890'), null);
});

test('manual ticket parsing requires HTTPS, endpoint identity, and fingerprint', () => {
  assert.deepEqual(parseDesktopRemoteManualInput('https://desktop.local:38402/remote/', 'abcDEF_1234567890', 'endpoint-1', fingerprint), {
    baseUrl: 'https://desktop.local:38402',
    ticket: 'abcDEF_1234567890',
    endpointUuid: 'endpoint-1',
    protocolVersion: 3,
    certificateFingerprint: fingerprint,
  });
  assert.equal(parseDesktopRemoteManualInput('http://desktop.local:38402', 'abcDEF_1234567890', 'endpoint-1', fingerprint), null);
  assert.equal(parseDesktopRemoteManualInput('https://desktop.local:38402', 'short', 'endpoint-1', fingerprint), null);
});

test('PIN pairing accepts only six digits with optional spacing', () => {
  assert.equal(normalizeDesktopRemotePinInput('123456'), '123456');
  assert.equal(normalizeDesktopRemotePinInput('123 456'), '123456');
  assert.equal(normalizeDesktopRemotePinInput('12345'), null);
  assert.equal(normalizeDesktopRemotePinInput('12345x'), null);
});
