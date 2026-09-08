package expo.modules.astracar

import kotlinx.coroutines.*
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

/** Credentials are process-local. Only opaque cache versions and image bytes reach disk. */
object AstraCarArtworkCache {
  private val sources = ConcurrentHashMap<Long, String>()
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO.limitedParallelism(2))
  private val browseScope = CoroutineScope(SupervisorJob() + Dispatchers.IO.limitedParallelism(2))
  private val downloads = ConcurrentHashMap<String, Boolean>()
  private val attempted = ConcurrentHashMap<String, Long>()
  private val locks = Array(16) { Any() }
  private const val MAX_DOWNLOAD = 12 * 1024 * 1024
  private const val MAX_CACHE = 64L * 1024 * 1024

  fun register(context: Context, sourceId: Long, template: String?) {
    val prefs = context.getSharedPreferences("astra_car_art_versions", Context.MODE_PRIVATE)
    if (template == null) {
      sources.remove(sourceId)
      prefs.edit().remove(sourceId.toString()).apply()
    } else {
      require(URL(template).protocol in listOf("http", "https"))
      require(template.contains(AstraCarArtwork.ART_ID_PLACEHOLDER))
      sources[sourceId] = template
      prefs.edit().putString(sourceId.toString(), digest(template)).apply()
    }
    AstraCarPlaybackBridge.refresh()
  }

  fun version(context: Context, sourceId: Long): String = context
    .getSharedPreferences("astra_car_art_versions", Context.MODE_PRIVATE)
    .getString(sourceId.toString(), "pending") ?: "pending"

  private fun destination(context: Context, key: String): File =
    File(File(context.cacheDir, "astra-car-art").apply { mkdirs() }, "$key.jpg")

  private fun remoteKey(context: Context, sourceId: Long, artId: String, full: Boolean) =
    digest("$sourceId:${version(context, sourceId)}:$artId:$full")

  fun cached(context: Context, sourceId: Long, artId: String, full: Boolean): File? =
    destination(context, remoteKey(context, sourceId, artId, full)).takeIf { it.isFile && it.length() > 0 }

  fun prefetch(context: Context, sourceId: Long, artId: String, full: Boolean) {
    if (cached(context, sourceId, artId, full) != null || !sources.containsKey(sourceId)) return
    if (!full && downloads.size >= 128) return
    val key = remoteKey(context, sourceId, artId, full)
    val now = android.os.SystemClock.elapsedRealtime()
    if (now - (attempted[key] ?: -120_000L) < 60_000 || downloads.putIfAbsent(key, true) != null) return
    attempted[key] = now
    (if (full) scope else browseScope).launch {
      try {
        for (attempt in 0..2) {
          if (key != remoteKey(context, sourceId, artId, full)) return@launch
          if (remote(context, sourceId, artId, full) != null) return@launch
          if (attempt < 2) delay(if (attempt == 0) 5_000 else 30_000)
        }
      } finally {
        downloads.remove(key)
        if (attempted.size > 1024) attempted.entries.removeAll { now - it.value > 60_000 }
      }
    }
  }

  fun remote(context: Context, sourceId: Long, artId: String, full: Boolean): File? {
    if (!full) {
      cached(context, sourceId, artId, false)?.let { return it }
      val version = version(context, sourceId)
      val original = remote(context, sourceId, artId, true) ?: return null
      if (version != version(context, sourceId)) return null
      val key = remoteKey(context, sourceId, artId, false)
      synchronized(locks[(key.hashCode() and Int.MAX_VALUE) % locks.size]) {
        val thumbnail = destination(context, key)
        if (thumbnail.isFile) return thumbnail
        if (resize(original, thumbnail, 128)) { prune(thumbnail.parentFile!!, thumbnail); return thumbnail }
        return null
      }
    }
    val key = remoteKey(context, sourceId, artId, full)
    val target = destination(context, key)
    synchronized(locks[(key.hashCode() and Int.MAX_VALUE) % locks.size]) {
      if (target.isFile && target.length() > 0) return target
      val template = sources[sourceId] ?: return null
      val version = version(context, sourceId)
      val url = template.replace(AstraCarArtwork.ART_ID_PLACEHOLDER, Uri.encode(artId))
      val temporary = File.createTempFile("download-", ".tmp", target.parentFile)
      try {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = 5_000
        connection.readTimeout = 5_000
        try {
          if (connection.responseCode !in 200..299) return null
          connection.inputStream.use { input ->
            temporary.outputStream().use { output ->
              val bytes = ByteArray(8192)
              var count = 0
              val deadline = System.nanoTime() + 10_000_000_000L
              while (true) {
                val read = input.read(bytes)
                if (read < 0) break
                count += read
                check(count <= MAX_DOWNLOAD && System.nanoTime() < deadline) { "Artwork download limit" }
                output.write(bytes, 0, read)
              }
            }
          }
        } finally { connection.disconnect() }
        if (version != version(context, sourceId) || template != sources[sourceId]) return null
        if (!resize(temporary, target, if (full) 512 else 128)) return null
        prune(target.parentFile!!, target)
        AstraCarPlaybackBridge.refresh()
        return target
      } catch (_: Exception) {
        // Never log authenticated URLs (including exception messages from network clients).
        return null
      } finally { temporary.delete() }
    }
  }

  fun local(context: Context, source: File, full: Boolean): File? {
    val key = digest("local:${source.name}:${source.lastModified()}:${source.length()}:$full")
    val target = destination(context, key)
    synchronized(locks[(key.hashCode() and Int.MAX_VALUE) % locks.size]) {
      if (target.isFile && target.length() > 0) return target
      return if (resize(source, target, if (full) 512 else 128)) {
        prune(target.parentFile!!, target)
        target
      } else null
    }
  }

  private fun resize(source: File, target: File, edge: Int): Boolean {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(source.path, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return false
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > edge * 2) sample *= 2
    val decoded = BitmapFactory.decodeFile(source.path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return false
    val ratio = minOf(1f, edge.toFloat() / maxOf(decoded.width, decoded.height))
    val bitmap = if (ratio < 1) Bitmap.createScaledBitmap(decoded,
      (decoded.width * ratio).toInt().coerceAtLeast(1), (decoded.height * ratio).toInt().coerceAtLeast(1), true) else decoded
    val temporary = File.createTempFile("image-", ".tmp", target.parentFile)
    return try {
      temporary.outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it)) }
      check(temporary.renameTo(target))
      true
    } finally {
      temporary.delete()
      if (bitmap !== decoded) bitmap.recycle()
      decoded.recycle()
    }
  }

  private fun prune(directory: File, keep: File) {
    val files = directory.listFiles()?.filter { it.extension == "jpg" }?.sortedBy { it.lastModified() }.orEmpty()
    var total = files.sumOf { it.length() }
    for (file in files) {
      if (total <= MAX_CACHE) break
      if (file != keep) { val size = file.length(); if (file.delete()) total -= size }
    }
  }

  private fun digest(value: String): String = MessageDigest.getInstance("SHA-256")
    .digest(value.toByteArray()).joinToString("") { "%02x".format(it) }
}
