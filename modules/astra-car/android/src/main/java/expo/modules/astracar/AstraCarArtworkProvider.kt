package expo.modules.astracar

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import java.io.FileNotFoundException

/** Android calls openFile on a binder worker. Neither decoding nor networking uses the main looper. */
class AstraCarArtworkProvider : ContentProvider() {
  override fun onCreate() = true
  override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
    if (mode != "r") throw FileNotFoundException("Artwork is read only")
    val ctx = context ?: throw FileNotFoundException("No context")
    val parts = uri.pathSegments
    val full = uri.getQueryParameter(AstraCarArtwork.QUERY_FULL) == "1"
    val file = when (parts.firstOrNull()) {
      "local" -> AstraCarArtwork.localFile(ctx, parts.getOrNull(1), full)?.let { AstraCarArtworkCache.local(ctx, it, full) }
      "remote" -> parts.getOrNull(1)?.toLongOrNull()?.let { id ->
        parts.getOrNull(2)?.takeIf { it.isNotBlank() }?.let { AstraCarArtworkCache.remote(ctx, id, it, full) }
      }
      else -> null
    } ?: throw FileNotFoundException("Artwork unavailable")
    return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
  }
  override fun getType(uri: Uri) = "image/jpeg"
  override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null
  override fun insert(uri: Uri, values: ContentValues?): Uri? = null
  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0
  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
}
