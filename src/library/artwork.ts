// Artwork cache lives in the app's files dir; the native scanner writes
// md5-named files (desktop convention) and tracks store the file name.

import { AstraLibraryScanner } from '../../modules/astra-library-scanner';

let artworkDir: string | null = null;
let artworkThumbDir: string | null = null;

type ArtworkThumbScanner = {
  getArtworkThumbDirPath?: () => string;
  ensureArtworkThumbnails?: (hashes: string[]) => Promise<number>;
};

function getArtworkDir(): string {
  if (!artworkDir) {
    artworkDir = AstraLibraryScanner.getArtworkDirPath();
  }
  return artworkDir;
}

function fallbackArtworkThumbDir(): string {
  const dir = getArtworkDir();
  return dir.endsWith('/artwork') ? `${dir.slice(0, -'/artwork'.length)}/artwork-thumbs` : `${dir}-thumbs`;
}

function getArtworkThumbDir(): string {
  if (!artworkThumbDir) {
    const scanner = AstraLibraryScanner as unknown as ArtworkThumbScanner;
    artworkThumbDir = scanner.getArtworkThumbDirPath?.() ?? fallbackArtworkThumbDir();
  }
  return artworkThumbDir;
}

function artworkThumbFileName(hash: string): string {
  const dot = hash.lastIndexOf('.');
  const stem = dot > 0 ? hash.slice(0, dot) : hash;
  return `${stem}.jpg`;
}

export function artworkUri(hash: string): string {
  return `file://${getArtworkDir()}/${hash}`;
}

export function artworkThumbUri(hash: string): string {
  return `file://${getArtworkThumbDir()}/${artworkThumbFileName(hash)}`;
}

export async function ensureArtworkThumbnails(
  hashes: readonly (string | null | undefined)[]
): Promise<number> {
  const unique = new Set<string>();
  for (const hash of hashes) {
    const cleanHash = hash?.trim();
    if (cleanHash) unique.add(cleanHash);
  }
  if (unique.size === 0) return 0;

  const scanner = AstraLibraryScanner as unknown as ArtworkThumbScanner;
  return scanner.ensureArtworkThumbnails?.([...unique]) ?? 0;
}
