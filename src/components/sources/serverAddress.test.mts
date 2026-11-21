import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultServerName, describeConnectError, parseServerAddress } from './serverAddress.ts';

test('accepts http(s) addresses with a port and trims trailing slashes', () => {
  assert.deepEqual(parseServerAddress('  http://192.168.1.50:4533/ '), {
    ok: true,
    baseUrl: 'http://192.168.1.50:4533',
    hostname: '192.168.1.50',
  });
  assert.equal(defaultServerName('https://music.home.lan'), 'music.home.lan');
});

test('rejects missing schemes, other schemes and embedded logins', () => {
  assert.equal(parseServerAddress('').ok, false);
  assert.equal(parseServerAddress('192.168.1.50:4533').ok, false);
  assert.equal(parseServerAddress('ftp://nas.local').ok, false);
  const withLogin = parseServerAddress('http://lena:secret@nas.local:4533');
  assert.equal(withLogin.ok, false);
  assert.match(withLogin.ok ? '' : withLogin.message, /login/);
  assert.equal(defaultServerName('nope'), null);
});

test('auth failures read as a login problem', () => {
  assert.match(describeConnectError(new Error('Subsonic request failed (401)'), 'subsonic', 'nas'), /username and password/);
  assert.match(describeConnectError(new Error('Wrong username or password.'), 'subsonic', 'nas'), /username and password/);
  assert.match(describeConnectError(new Error('Jellyfin authentication failed (401)'), 'jellyfin', 'nas'), /^Jellyfin/);
});

test('network failures name the host', () => {
  const abort = new Error('Aborted');
  abort.name = 'AbortError';
  assert.match(describeConnectError(abort, 'subsonic', 'nas.local'), /Couldn’t reach nas\.local/);
  assert.match(describeConnectError(new TypeError('Network request failed'), 'jellyfin', null), /Couldn’t reach the server/);
});

test('a non-server answer says so; unknown messages pass through', () => {
  assert.match(describeConnectError(new Error('Subsonic request failed (404)'), 'subsonic', 'nas'), /doesn’t look like a Subsonic server/);
  assert.equal(describeConnectError(new Error('Server is in maintenance'), 'subsonic', 'nas'), 'Server is in maintenance');
});
