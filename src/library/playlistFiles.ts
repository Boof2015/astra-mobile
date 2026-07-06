// M3U file IO (SAF export, document-picker import). The matching ladders live
// in importMatching.ts (pure, node-testable) and are re-exported here for the
// existing import sites.

import * as DocumentPicker from 'expo-document-picker';
import {
  StorageAccessFramework,
  readAsStringAsync,
  writeAsStringAsync,
} from 'expo-file-system/legacy';
import { parseM3u, serializeM3u, type M3uEntry, type M3uExportEntry } from '@/lib/m3u';

export {
  buildImportIndex,
  decodedDocPath,
  matchImportEntry,
  matchSyncEntry,
  normalizeEntryPath,
  type ImportMatch,
  type ImportMatchIndex,
  type SyncEntryQuery,
} from './importMatching';

// --- File IO -------------------------------------------------------------------

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim();
  return cleaned || 'Playlist';
}

export interface M3uExportResult {
  fileUri: string;
  entryCount: number;
}

/** Folder picker -> create .m3u8 -> write. Returns null if the picker is cancelled. */
export async function exportPlaylistM3u(
  name: string,
  entries: M3uExportEntry[]
): Promise<M3uExportResult | null> {
  const permission = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return null;

  const fileUri = await StorageAccessFramework.createFileAsync(
    permission.directoryUri,
    `${sanitizeFileName(name)}.m3u8`,
    // Matches the .m3u8 extension so SAF doesn't append another one.
    'application/vnd.apple.mpegurl'
  );
  await writeAsStringAsync(fileUri, serializeM3u(entries));
  return { fileUri, entryCount: entries.length };
}

/** Document picker -> parse. Returns null on cancel; throws on a non-M3U pick. */
export async function pickAndParseM3u(): Promise<{ name: string; entries: M3uEntry[] } | null> {
  const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0];
  // M3U mime types are unreliable across file managers — validate by name.
  if (!/\.m3u8?$/i.test(asset.name)) {
    throw new Error(`"${asset.name}" is not an .m3u/.m3u8 playlist`);
  }
  const content = await readAsStringAsync(asset.uri);
  const name = asset.name.replace(/\.m3u8?$/i, '').trim() || 'Imported playlist';
  return { name, entries: parseM3u(content) };
}
