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

private const val TAG = "AstraCarArt"

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
    // Credential-bearing remote artwork URLs live only in SecureStore. Remote
    // covers are fetched by the app and become available here once cached as
    // normal local artwork; the provider never reads or persists credentials.
    return null
  }

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
