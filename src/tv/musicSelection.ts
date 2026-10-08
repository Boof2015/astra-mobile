export type MusicFolder = { uri: string; path: string; count: number };
export type MusicDevice = { id: string; label: string; folders: MusicFolder[]; unavailable?: boolean };
export const deviceScope = (id: string) => `astra-media://${id}/`;
export const scopeDevice = (uri: string) => /^astra-media:\/\/([^/]+)\//.exec(uri)?.[1] ?? null;
export const isTvMusicScope = (uri: string) => scopeDevice(uri) !== null;

export function selectDevice(selection: string[], device: MusicDevice, selected: boolean): string[] {
  const remaining = selection.filter(uri => scopeDevice(uri) !== device.id);
  return selected ? [...remaining, deviceScope(device.id)] : remaining;
}

export function toggleMusicFolder(selection: string[], device: MusicDevice, folder: MusicFolder): string[] {
  if (selection.includes(deviceScope(device.id))) {
    return [...selection.filter(uri => scopeDevice(uri) !== device.id), ...device.folders.filter(item => item.uri !== folder.uri).map(item => item.uri)];
  }
  return selection.includes(folder.uri) ? selection.filter(uri => uri !== folder.uri) : [...selection, folder.uri];
}

export function deviceSelectionLabel(selection: string[], device: MusicDevice) {
  if (selection.includes(deviceScope(device.id))) return 'All folders';
  const count = selection.filter(uri => scopeDevice(uri) === device.id).length;
  return count ? `${count} ${count === 1 ? 'folder' : 'folders'} selected` : 'None selected';
}
