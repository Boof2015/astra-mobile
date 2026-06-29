package expo.modules.astracar

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.util.Log
import java.io.File
import java.io.FileNotFoundException
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

private const val TAG = "AstraCarArt"
private const val DOWNLOAD_TIMEOUT_MS = 8_000

/**
 * Serves artwork to Android Auto as `content://` URIs (the only scheme Auto accepts).
 * `openFile` runs on a binder pool thread (never the main thread), so the bounded remote
 * download here can't ANR the browse UI.
 *
 *   content://<authority>/local/<hash>                      -> cached scanner file
 *   content://<authority>/remote/<sourceId>/<artworkSourceId> -> server cover (download + cache)
 */
class AstraCarArtworkProvider : ContentProvider() {
  override fun onCreate(): Boolean = true

  override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
    val ctx = context ?: throw FileNotFoundException("No context")
    val segments = uri.pathSegments
    val full = uri.getQueryParameter(AstraCarArtwork.QUERY_FULL) != null
    val file = when (segments.firstOrNull()) {
      "local" -> localFile(ctx, segments.getOrNull(1), full)
      "remote" -> remoteFile(ctx, segments.getOrNull(1)?.toLongOrNull(), segments.getOrNull(2))
      else -> null
    }
    if (file == null) {
      Log.w(TAG, "openFile miss for $uri")
      throw FileNotFoundException("No artwork for $uri")
    }
    Log.d(TAG, "openFile hit for $uri -> ${file.absolutePath}")
    return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
  }

  private fun localFile(ctx: Context, hash: String?, full: Boolean): File? {
    val clean = hash?.trim().orEmpty()
    if (clean.isEmpty()) return null
    val dot = clean.lastIndexOf('.')
    val stem = if (dot > 0) clean.substring(0, dot) else clean
    val thumb = File(File(ctx.filesDir, "artwork-thumbs"), "$stem.jpg")
    val original = File(File(ctx.filesDir, "artwork"), clean)
    // Now-playing wants full-res (128px thumbs look blurry on the now-playing card);
    // browse icons prefer the small thumb. Each falls back to the other if missing.
    val ordered = if (full) listOf(original, thumb) else listOf(thumb, original)
    return ordered.firstOrNull { it.exists() }
  }

  private fun remoteFile(ctx: Context, sourceId: Long?, artworkSourceId: String?): File? {
    if (sourceId == null || artworkSourceId.isNullOrBlank()) return null
    val cacheDir = File(ctx.cacheDir, "astra-car-art").apply { mkdirs() }
    val cacheFile = File(cacheDir, sha1("$sourceId:$artworkSourceId") + ".img")
    if (cacheFile.exists() && cacheFile.length() > 0) return cacheFile

    // art_auth is a full cover-art URL template with an id placeholder, built by JS from
    // the (well-tested) Subsonic/Jellyfin URL builders so the provider stays auth-agnostic.
    val template = artAuthTemplate(ctx, sourceId) ?: return null
    val url = template.replace(AstraCarArtwork.ART_ID_PLACEHOLDER, Uri.encode(artworkSourceId))
    return runCatching {
      download(url, cacheFile)
      cacheFile.takeIf { it.length() > 0 }
    }.onFailure { Log.w(TAG, "remote art download failed for $sourceId/$artworkSourceId", it) }
      .getOrNull()
  }

  private fun artAuthTemplate(ctx: Context, sourceId: Long): String? =
    AstraCarDb.openReadable(ctx)?.use { db ->
      db.rawQuery(
        "SELECT art_auth FROM remote_sources WHERE id = ? LIMIT 1",
        arrayOf(sourceId.toString()),
      ).use { cursor ->
        if (cursor.moveToFirst() && !cursor.isNull(0)) cursor.getString(0) else null
      }
    }?.takeIf { it.isNotBlank() }

  private fun download(url: String, dest: File) {
    val connection = (URL(url).openConnection() as HttpURLConnection).apply {
      connectTimeout = DOWNLOAD_TIMEOUT_MS
      readTimeout = DOWNLOAD_TIMEOUT_MS
      instanceFollowRedirects = true
    }
    try {
      if (connection.responseCode !in 200..299) {
        throw FileNotFoundException("HTTP ${connection.responseCode}")
      }
      val tmp = File(dest.absolutePath + ".tmp")
      connection.inputStream.use { input -> FileOutputStream(tmp).use(input::copyTo) }
      if (!tmp.renameTo(dest)) {
        tmp.copyTo(dest, overwrite = true)
        tmp.delete()
      }
    } finally {
      connection.disconnect()
    }
  }

  private fun sha1(value: String): String =
    MessageDigest.getInstance("SHA-1")
      .digest(value.toByteArray())
      .joinToString("") { "%02x".format(it) }

  override fun getType(uri: Uri): String = "image/*"

  override fun query(
    uri: Uri,
    projection: Array<out String>?,
    selection: String?,
    selectionArgs: Array<out String>?,
    sortOrder: String?,
  ): Cursor? = null

  override fun insert(uri: Uri, values: ContentValues?): Uri? = null

  override fun update(
    uri: Uri,
    values: ContentValues?,
    selection: String?,
    selectionArgs: Array<out String>?,
  ): Int = 0

  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0
}
