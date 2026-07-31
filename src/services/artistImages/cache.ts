import {
  cacheDirectory,
  deleteAsync,
  downloadAsync,
} from 'expo-file-system/legacy';
import { AstraLibraryScanner } from '../../../modules/astra-library-scanner';

export async function cacheRemoteArtistImage(imageUrl: string): Promise<string> {
  if (!cacheDirectory) throw new Error('The image cache is unavailable.');
  const temporaryUri =
    `${cacheDirectory}artist-image-${Date.now()}-` +
    `${Math.random().toString(36).slice(2)}.download`;
  try {
    const result = await downloadAsync(imageUrl, temporaryUri);
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Image download failed (${result.status}).`);
    }
    return await AstraLibraryScanner.cacheArtworkFromUri(result.uri);
  } finally {
    await deleteAsync(temporaryUri, { idempotent: true }).catch(() => undefined);
  }
}
