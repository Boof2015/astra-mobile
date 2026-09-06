package expo.modules.astralibraryscanner

import android.content.Context
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.provider.OpenableColumns
import android.system.Os
import android.system.OsConstants
import android.system.StructPollfd
import androidx.annotation.Keep
import java.io.File
import java.io.IOException
import java.util.concurrent.atomic.AtomicBoolean

internal fun isDecodableArtwork(bytes: ByteArray): Boolean = runCatching {
  val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
  BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
  bounds.outWidth > 0 && bounds.outHeight > 0
}.getOrDefault(false)

/** Plain JNI payload. No artwork or audio bytes cross the React Native bridge. */
@Keep
internal class NativeTagData {
  @JvmField var properties: Array<String> = emptyArray()
  @JvmField var pictures: Array<ByteArray> = emptyArray()
  @JvmField var durationMs: Int = 0
  @JvmField var bitrate: Int = 0
  @JvmField var sampleRate: Int = 0
  @JvmField var channels: Int = 0
  @JvmField var bitsPerSample: Int = 0
  @JvmField var codecMime: String? = null

  fun picture(): ByteArray? = pictures.firstOrNull(::isDecodableArtwork)
}

@Keep
internal object NativeTagReader {
  init { System.loadLibrary("astratags") }

  private external fun readDescriptor(
    fd: Int, name: String, offset: Long, length: Long,
    cancelled: AtomicBoolean, timeoutMs: Int,
  ): NativeTagData?

  fun read(
    context: Context,
    uri: Uri,
    name: String? = null,
    cancelled: AtomicBoolean = AtomicBoolean(false),
    timeoutMs: Int = 12_000,
  ): NativeTagData? {
    val deadline = SystemClock.elapsedRealtime() + timeoutMs
    fun remaining(): Int {
      if (cancelled.get()) throw IOException("Metadata read cancelled")
      val remaining = deadline - SystemClock.elapsedRealtime()
      if (remaining <= 0) throw IOException("Metadata read timed out")
      return remaining.toInt()
    }
    val displayName = name ?: runCatching {
      context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        ?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }
    }.getOrNull() ?: uri.lastPathSegment.orEmpty()
    context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { asset ->
      val descriptor = asset.parcelFileDescriptor
      val seekable = runCatching { Os.lseek(descriptor.fileDescriptor, 0, OsConstants.SEEK_CUR) }.isSuccess
      if (seekable) {
        return readDescriptor(descriptor.fd, displayName, asset.startOffset, asset.declaredLength, cancelled, remaining())
      }
      // Pipe-backed document providers cannot seek. Poll between bounded reads so
      // cancellation works even when a provider stops producing bytes.
      val temp = File.createTempFile("astra-tags-", ".tmp", context.cacheDir)
      try {
        temp.outputStream().use { output ->
          val buffer = ByteArray(64 * 1024)
          val poll = StructPollfd().apply {
            fd = descriptor.fileDescriptor
            events = OsConstants.POLLIN.toShort()
          }
          var skipped = 0L
          var written = 0L
          while (true) {
            val waitMs = minOf(remaining(), 100)
            if (Os.poll(arrayOf(poll), waitMs) == 0) continue
            if (poll.revents.toInt() and (OsConstants.POLLERR or OsConstants.POLLNVAL) != 0) {
              throw IOException("Document provider failed during metadata read")
            }
            val count = Os.read(descriptor.fileDescriptor, buffer, 0, buffer.size)
            if (count == 0) break
            val skip = minOf(count.toLong(), (asset.startOffset - skipped).coerceAtLeast(0)).toInt()
            skipped += skip
            val available = if (asset.declaredLength >= 0) {
              minOf((count - skip).toLong(), asset.declaredLength - written).toInt()
            } else count - skip
            if (available > 0) { output.write(buffer, skip, available); written += available }
            if (asset.declaredLength >= 0 && written >= asset.declaredLength) break
          }
        }
        ParcelFileDescriptor.open(temp, ParcelFileDescriptor.MODE_READ_ONLY).use { local ->
          return readDescriptor(local.fd, displayName, 0, temp.length(), cancelled, remaining())
        }
      } finally { temp.delete() }
    }
    throw IOException("Cannot open metadata source")
  }
}
