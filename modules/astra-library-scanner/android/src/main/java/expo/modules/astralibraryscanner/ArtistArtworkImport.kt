package expo.modules.astralibraryscanner

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.security.MessageDigest
import kotlin.math.max
import kotlin.math.roundToInt

internal const val MAX_IMPORTED_ARTWORK_BYTES = 12 * 1024 * 1024

internal fun readImportedArtworkBytes(
  input: InputStream,
  maximumBytes: Int = MAX_IMPORTED_ARTWORK_BYTES,
): ByteArray {
  val output = ByteArrayOutputStream(minOf(maximumBytes, 64 * 1024))
  val buffer = ByteArray(32 * 1024)
  var total = 0
  while (true) {
    val read = input.read(buffer)
    if (read < 0) break
    total += read
    require(total <= maximumBytes) { "Choose an image smaller than 12 MB" }
    output.write(buffer, 0, read)
  }
  return output.toByteArray()
}

internal class ImportedArtworkCache(
  private val artworkDirectory: File,
  private val thumbnailDirectory: File,
  private val thumbnailSize: Int = 128,
) {
  fun cache(bytes: ByteArray): String {
    require(bytes.isNotEmpty()) { "The selected image is empty" }
    val extension = supportedExtension(bytes)
      ?: error("Choose a JPEG, PNG, or WebP image")
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    require(bounds.outWidth > 0 && bounds.outHeight > 0) {
      "The selected file is not a valid image"
    }
    require(bounds.outWidth <= 16_384 && bounds.outHeight <= 16_384) {
      "The selected image dimensions are too large"
    }

    artworkDirectory.mkdirs()
    thumbnailDirectory.mkdirs()
    val fileName = md5Hex(bytes) + extension
    publishAtomically(bytes, File(artworkDirectory, fileName))
    publishThumbnail(bytes, fileName)
    return fileName
  }

  private fun publishAtomically(bytes: ByteArray, target: File) {
    if (target.isFile) return
    val temporary = File(artworkDirectory, "${target.name}.tmp-${System.nanoTime()}")
    try {
      FileOutputStream(temporary).use { output ->
        output.write(bytes)
        output.fd.sync()
      }
      if (!temporary.renameTo(target) && !target.isFile) {
        error("The image could not be cached")
      }
    } finally {
      if (temporary.exists()) temporary.delete()
    }
  }

  private fun publishThumbnail(bytes: ByteArray, artworkHash: String) {
    val target = File(
      thumbnailDirectory,
      "${artworkHash.substringBeforeLast('.', artworkHash)}.jpg",
    )
    if (target.isFile) return
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    val options = BitmapFactory.Options().apply {
      var sample = 1
      while (max(bounds.outWidth, bounds.outHeight) / sample > thumbnailSize * 2) sample *= 2
      inSampleSize = sample
      inPreferredConfig = Bitmap.Config.RGB_565
    }
    val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
      ?: error("The selected file is not a valid image")
    val largest = max(decoded.width, decoded.height)
    val thumbnail = if (largest <= thumbnailSize) {
      decoded
    } else {
      val scale = thumbnailSize.toFloat() / largest
      Bitmap.createScaledBitmap(
        decoded,
        max(1, (decoded.width * scale).roundToInt()),
        max(1, (decoded.height * scale).roundToInt()),
        true,
      )
    }
    val temporary = File(thumbnailDirectory, "${target.name}.tmp-${System.nanoTime()}")
    try {
      FileOutputStream(temporary).use { output ->
        require(thumbnail.compress(Bitmap.CompressFormat.JPEG, 84, output)) {
          "The artist image thumbnail could not be created"
        }
        output.fd.sync()
      }
      if (!temporary.renameTo(target) && !target.isFile) {
        error("The artist image thumbnail could not be cached")
      }
    } finally {
      if (temporary.exists()) temporary.delete()
      if (thumbnail !== decoded && !decoded.isRecycled) decoded.recycle()
      if (!thumbnail.isRecycled) thumbnail.recycle()
    }
  }

  private fun supportedExtension(bytes: ByteArray): String? = when {
    bytes.size >= 2 && bytes[0] == 0xFF.toByte() && bytes[1] == 0xD8.toByte() -> ".jpg"
    bytes.size >= 8 &&
      bytes[0] == 0x89.toByte() && bytes[1] == 0x50.toByte() &&
      bytes[2] == 0x4E.toByte() && bytes[3] == 0x47.toByte() -> ".png"
    bytes.size >= 12 &&
      bytes[0] == 'R'.code.toByte() && bytes[1] == 'I'.code.toByte() &&
      bytes[2] == 'F'.code.toByte() && bytes[3] == 'F'.code.toByte() &&
      bytes[8] == 'W'.code.toByte() && bytes[9] == 'E'.code.toByte() &&
      bytes[10] == 'B'.code.toByte() && bytes[11] == 'P'.code.toByte() -> ".webp"
    else -> null
  }

  private fun md5Hex(bytes: ByteArray): String =
    MessageDigest.getInstance("MD5").digest(bytes).joinToString("") { "%02x".format(it) }
}
