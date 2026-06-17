// Waveform peak cache — offline RMS bins for the M3 waveform seek bar.
// Keyed by track path (SAF URI), mirroring favorites/playlists (no FK, so a row
// survives folder removal and resolves again on re-grant). Peaks are normalized
// to [0, 1] and stored as a tightly-packed Float32 little-endian blob.

import type { LibraryDatabase } from './database';

export async function getWaveformPeaks(
  db: LibraryDatabase,
  trackPath: string
): Promise<Float32Array | null> {
  const row = await db.get<{ peaks: ArrayBuffer | ArrayBufferView }>(
    'SELECT peaks FROM waveform_peaks WHERE track_path = ?',
    [trackPath]
  );
  return row ? toFloat32(row.peaks) : null;
}

export async function putWaveformPeaks(
  db: LibraryDatabase,
  trackPath: string,
  peaks: Float32Array
): Promise<void> {
  // Bind the typed-array view directly (a valid ArrayBufferView Scalar); copy to
  // a tight view first if it's a window into a larger buffer.
  const tight =
    peaks.byteOffset === 0 && peaks.byteLength === peaks.buffer.byteLength
      ? peaks
      : peaks.slice();
  await db.run(
    `INSERT INTO waveform_peaks (track_path, bins, peaks, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(track_path) DO UPDATE SET
       bins = excluded.bins, peaks = excluded.peaks, created_at = excluded.created_at`,
    [trackPath, peaks.length, tight, Date.now()]
  );
}

function toFloat32(blob: ArrayBuffer | ArrayBufferView): Float32Array {
  if (blob instanceof Float32Array) return blob;
  if (ArrayBuffer.isView(blob)) {
    return new Float32Array(blob.buffer, blob.byteOffset, Math.floor(blob.byteLength / 4));
  }
  return new Float32Array(blob);
}
