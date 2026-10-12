import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceScope, deviceSelectionLabel, selectDevice, toggleMusicFolder, scopeDevice, type MusicDevice } from './musicSelection.ts';

const internal: MusicDevice = { id: 'external_primary', label: 'Internal storage', folders: [
  { uri: 'astra-media://external_primary/Music%2FAlbums?exact=1', path: 'Music/Albums/', count: 4 },
  { uri: 'astra-media://external_primary/Music%2FSingles?exact=1', path: 'Music/Singles/', count: 2 },
] };
const usb: MusicDevice = { id: '1234-abcd', label: 'USB drive', folders: [
  { uri: 'astra-media://1234-abcd/Music?exact=1', path: 'Music/', count: 10 },
] };

test('whole-device and individual-folder choices coexist without overlapping scopes', () => {
  const selected = selectDevice([internal.folders[0].uri, usb.folders[0].uri], usb, true);
  assert.deepEqual(selected, [internal.folders[0].uri, deviceScope(usb.id)]);
  assert.equal(deviceSelectionLabel(selected, usb), 'All folders');
  assert.equal(deviceSelectionLabel(selected, internal), '1 folder selected');
});
test('unchecking a folder after Use all expands that device only', () => {
  const selected = toggleMusicFolder([deviceScope(internal.id), deviceScope(usb.id)], internal, internal.folders[0]);
  assert.deepEqual(selected, [deviceScope(usb.id), internal.folders[1].uri]);
  assert.equal(deviceSelectionLabel(selected, internal), '1 folder selected');
});
test('whole-device selection is retained when new folders are discovered', () => {
  const selected = selectDevice([], internal, true);
  const expanded = { ...internal, folders: [...internal.folders, { uri: 'new', path: 'New/', count: 2 }] };
  assert.equal(deviceSelectionLabel(selected, expanded), 'All folders');
  assert.equal(deviceSelectionLabel(selected, usb), 'None selected');
});
test('clearing one device leaves other devices selected', () => {
  assert.deepEqual(selectDevice([deviceScope(internal.id), usb.folders[0].uri], internal, false), [usb.folders[0].uri]);
});
test('a folder can be toggled without duplicate paths', () => {
  const once = toggleMusicFolder([], internal, internal.folders[0]);
  assert.deepEqual(toggleMusicFolder(once, internal, internal.folders[0]), []);
  assert.equal(scopeDevice('content://com.android.externalstorage.documents/tree/primary%3AMusic'), null);
  assert.equal(scopeDevice(internal.folders[0].uri), internal.id);
});
