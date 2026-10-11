package expo.modules.astralibraryscanner

import android.content.Context
import android.net.Uri
import android.system.Os
import android.system.OsConstants
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** A byte-bound check independent of vendor extractors that clamp WAV duration at EOF. */
internal object WaveContainerBounds {
  fun isTruncated(context: Context, uri: Uri): Boolean {
    if (uri.scheme !in listOf("file", "content")) return false
    return try {
      context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { asset ->
        val stat = Os.fstat(asset.fileDescriptor)
        // Do not consume pipes or treat their zero stat size as a file length.
        if (!OsConstants.S_ISREG(stat.st_mode)) return false
        val remaining = (stat.st_size - asset.startOffset).coerceAtLeast(0)
        val available = if (asset.declaredLength >= 0) minOf(remaining, asset.declaredLength) else remaining
        if (available < 12) return false // Leave unrecognizable headers to the decoder.
        val header = ByteArray(12)
        var count = 0
        while (count < header.size) {
          val read = Os.pread(asset.fileDescriptor, header, count, header.size - count, asset.startOffset + count)
          if (read <= 0) return false
          count += read
        }
        exceedsAvailableBytes(header, available)
      } ?: false
    } catch (_: Exception) {
      // Uninspectable sources retain the normal platform-decoder path.
      false
    }
  }

  internal fun exceedsAvailableBytes(header: ByteArray, available: Long): Boolean {
    if (header.size < 12 || available < 0 || String(header, 8, 4, Charsets.US_ASCII) != "WAVE") return false
    val order = when (String(header, 0, 4, Charsets.US_ASCII)) {
      "RIFF" -> ByteOrder.LITTLE_ENDIAN
      "RIFX" -> ByteOrder.BIG_ENDIAN
      else -> return false // RF64/Wave64 and other formats have different size headers.
    }
    val size = ByteBuffer.wrap(header, 4, 4).order(order).int.toLong() and 0xffff_ffffL
    // Unfinalized/unknown sizes do not establish a bound. A sized RIFF includes
    // WAVE and all subchunks, but excludes its own 8-byte ID/size prefix.
    return size != 0L && size != 0xffff_ffffL && size + 8 > available
  }
}
