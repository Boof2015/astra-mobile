// Artwork cache lives in the app's files dir; the native scanner writes
// md5-named files (desktop convention) and tracks store the file name.

import { AstraLibraryScanner } from '../../modules/astra-library-scanner';

let artworkDir: string | null = null;

export function artworkUri(hash: string): string {
  if (!artworkDir) {
    artworkDir = AstraLibraryScanner.getArtworkDirPath();
  }
  return `file://${artworkDir}/${hash}`;
}
