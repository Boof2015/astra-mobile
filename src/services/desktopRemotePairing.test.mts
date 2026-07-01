import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeDesktopRemotePinInput,
  parseDesktopRemoteManualInput,
  parseDesktopRemotePairingInput,
} from './desktopRemotePairing.ts';

test('parses current PWA pairing URL format', () => {
  assert.deepEqual(
    parseDesktopRemotePairingInput('http://192.168.1.20:38402/remote/#pair=abcDEF_1234567890'),
    {
      baseUrl: 'http://192.168.1.20:38402',
      ticket: 'abcDEF_1234567890',
    }
  );
});

test('parses native pairing links without accepting missing base URLs', () => {
  assert.deepEqual(
    parseDesktopRemotePairingInput(
      'astra://desktop-remote/pair?baseUrl=http%3A%2F%2F10.0.0.8%3A38402&ticket=abcDEF_1234567890'
    ),
    {
      baseUrl: 'http://10.0.0.8:38402',
      ticket: 'abcDEF_1234567890',
    }
  );
  assert.equal(parseDesktopRemotePairingInput('astra://desktop-remote/pair?ticket=abcDEF_1234567890'), null);
});

test('manual pairing requires a reachable http base URL and ticket-shaped code', () => {
  assert.deepEqual(parseDesktopRemoteManualInput('http://desktop.local:38402/remote/', 'abcDEF_1234567890'), {
    baseUrl: 'http://desktop.local:38402',
    ticket: 'abcDEF_1234567890',
  });
  assert.equal(parseDesktopRemoteManualInput('ftp://desktop.local', 'abcDEF_1234567890'), null);
  assert.equal(parseDesktopRemoteManualInput('http://desktop.local:38402', 'short'), null);
});

test('PIN pairing accepts only six digits with optional spacing', () => {
  assert.equal(normalizeDesktopRemotePinInput('123456'), '123456');
  assert.equal(normalizeDesktopRemotePinInput('123 456'), '123456');
  assert.equal(normalizeDesktopRemotePinInput('12345'), null);
  assert.equal(normalizeDesktopRemotePinInput('12345x'), null);
});
