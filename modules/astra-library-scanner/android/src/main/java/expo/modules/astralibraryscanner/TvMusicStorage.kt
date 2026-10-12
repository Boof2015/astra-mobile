package expo.modules.astralibraryscanner

import android.Manifest
import android.app.UiModeManager
import android.content.ContentProvider
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.ParcelFileDescriptor
import android.os.storage.StorageManager
import android.provider.MediaStore
import expo.modules.astralibraryscanner.data.ScanCancelledException
import java.io.FileNotFoundException
import java.util.concurrent.atomic.AtomicBoolean

/** TV scopes are durable volume/path identities. MediaStore IDs are only used
 * when opening bytes: Android may assign a different ID after reindexing a USB. */
object TvMusicStorage {
  const val SCHEME = "astra-media"
  data class Scope(val volume: String, val path: String, val exact: Boolean = false)
  data class Volume(val id: String, val label: String, val root: String)

  fun isTv(context: Context): Boolean =
    (context.getSystemService(Context.UI_MODE_SERVICE) as UiModeManager).currentModeType == Configuration.UI_MODE_TYPE_TELEVISION

  fun hasAccess(context: Context): Boolean = isTv(context) && context.checkSelfPermission(
    if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_AUDIO else Manifest.permission.READ_EXTERNAL_STORAGE
  ) == PackageManager.PERMISSION_GRANTED

  fun scope(uri: String): Scope? {
    val parsed = Uri.parse(uri)
    if (parsed.scheme != SCHEME) return null
    val volume = parsed.authority?.takeIf { it.isNotBlank() } ?: return null
    val path = parsed.path.orEmpty().trim('/')
    return Scope(volume, if (path.isEmpty()) "" else "$path/", parsed.getQueryParameter("exact") == "1")
  }

  fun folderUri(volume: String, path: String): String = Uri.Builder().scheme(SCHEME)
    .authority(volume).appendPath(path.trim('/')).build().toString()

  @Suppress("DEPRECATION")
  fun volumes(context: Context): List<Volume> {
    if (!isTv(context)) return emptyList()
    val storage = context.getSystemService(Context.STORAGE_SERVICE) as StorageManager
    val indexed = if (Build.VERSION.SDK_INT >= 29) MediaStore.getExternalVolumeNames(context) else null
    return storage.storageVolumes.mapNotNull { volume ->
      if (volume.state != Environment.MEDIA_MOUNTED && volume.state != Environment.MEDIA_MOUNTED_READ_ONLY) return@mapNotNull null
      val id = if (volume.isPrimary) "external_primary" else volume.uuid?.lowercase() ?: return@mapNotNull null
      if (indexed != null && id !in indexed) return@mapNotNull null
      val root = if (Build.VERSION.SDK_INT >= 30) volume.directory?.absolutePath
        else if (volume.isPrimary) Environment.getExternalStorageDirectory().absolutePath else "/storage/${volume.uuid}"
      Volume(id, if (volume.isPrimary) "Internal storage" else volume.getDescription(context), root ?: return@mapNotNull null)
    }
  }

  fun available(context: Context, uri: String): Boolean {
    val value = scope(uri) ?: return false
    return hasAccess(context) && volumes(context).any { it.id == value.volume }
  }

  private fun requireVolume(context: Context, id: String): Volume {
    check(isTv(context)) { "TV music access is only available on Android TV." }
    check(hasAccess(context)) { "Allow music access to scan this storage device." }
    return volumes(context).find { it.id == id } ?: error("Storage device is disconnected. Reconnect it to scan your music.")
  }

  private fun collection(volume: String): Uri = if (Build.VERSION.SDK_INT >= 29)
    MediaStore.Audio.Media.getContentUri(volume) else MediaStore.Audio.Media.EXTERNAL_CONTENT_URI

  private fun audioUri(context: Context, volume: String, path: String): String = Uri.Builder()
    .scheme("content").authority("${context.packageName}.tv-audio").appendPath(volume).appendPath(path).build().toString()

  @Suppress("DEPRECATION")
  fun files(context: Context, value: Scope, extensions: Set<String>?, cancelled: AtomicBoolean? = null): List<Map<String, Any?>> {
    val volume = requireVolume(context, value.volume)
    val modern = Build.VERSION.SDK_INT >= 29
    val location = if (modern) MediaStore.Audio.Media.RELATIVE_PATH else MediaStore.Audio.Media.DATA
    val projection = arrayOf(MediaStore.Audio.Media.DISPLAY_NAME, location, MediaStore.Audio.Media.SIZE,
      MediaStore.Audio.Media.DATE_MODIFIED, MediaStore.Audio.Media.MIME_TYPE)
    val result = mutableListOf<Map<String, Any?>>()
    // Query only audio locations. All tags, cover art and analysis come from Astra.
    val cursor = context.contentResolver.query(collection(value.volume), projection, null, null, null)
      ?: error("Android could not read the music index. Try again.")
    cursor.use {
      while (it.moveToNext()) {
        if (cancelled?.get() == true) throw ScanCancelledException()
        val name = it.getString(0) ?: continue
        val raw = it.getString(1) ?: if (modern) "" else continue
        val path = if (modern) raw.trim('/').let { parent -> if (parent.isEmpty()) "" else "$parent/" } else {
          if (!raw.startsWith("${volume.root}/")) continue
          raw.removePrefix("${volume.root}/").substringBeforeLast('/', "").let { parent -> if (parent.isEmpty()) "" else "$parent/" }
        }
        if (value.exact && path != value.path || !value.exact && !path.startsWith(value.path)) continue
        if (extensions != null && name.substringAfterLast('.', "").lowercase() !in extensions) continue
        result += mapOf("uri" to audioUri(context, value.volume, path + name), "name" to name,
          "relativePath" to path, "volume" to value.volume, "parentUri" to folderUri(value.volume, path),
          "size" to if (it.isNull(2)) null else it.getLong(2),
          "lastModified" to if (it.isNull(3)) 0L else it.getLong(3) * 1000,
          "mimeType" to it.getString(4))
      }
    }
    // A removed drive or revoked permission is an error, never an empty scan.
    requireVolume(context, value.volume)
    return result
  }

  fun discover(context: Context, extensions: Set<String>): List<Map<String, Any?>> {
    check(hasAccess(context)) { "Allow music access to find music on this TV." }
    return volumes(context).map { volume ->
      val grouped = files(context, Scope(volume.id, ""), extensions).groupingBy { it["relativePath"] as String }.eachCount()
      mapOf("id" to volume.id, "label" to volume.label, "folders" to grouped.toSortedMap().map { (path, count) ->
        mapOf("path" to path, "count" to count, "uri" to "${folderUri(volume.id, path)}?exact=1")
      })
    }
  }

  /** Resolve the current Android index entry on every open, including after a
   * cold start. Never cache a MediaStore row ID as a playlist/favorite identity. */
  @Suppress("DEPRECATION")
  fun resolve(context: Context, uri: Uri): Uri {
    val parts = uri.pathSegments
    if (uri.authority != "${context.packageName}.tv-audio" || parts.size != 2) throw FileNotFoundException("Invalid TV music location")
    val volume = requireVolume(context, parts[0]); val fullPath = parts[1]
    val name = fullPath.substringAfterLast('/')
    val path = fullPath.substringBeforeLast('/', "").let { if (it.isEmpty()) "" else "$it/" }
    val modern = Build.VERSION.SDK_INT >= 29
    val relative = MediaStore.Audio.Media.RELATIVE_PATH
    val where = if (!modern) "${MediaStore.Audio.Media.DATA} = ?"
      else if (path.isEmpty()) "($relative = '' OR $relative = '/' OR $relative IS NULL) AND ${MediaStore.Audio.Media.DISPLAY_NAME} = ?"
      else "$relative = ? AND ${MediaStore.Audio.Media.DISPLAY_NAME} = ?"
    val args = if (!modern) arrayOf("${volume.root}/$fullPath") else if (path.isEmpty()) arrayOf(name) else arrayOf(path, name)
    val collection = collection(volume.id)
    context.contentResolver.query(collection, arrayOf(MediaStore.Audio.Media._ID), where, args, null)?.use {
      if (it.moveToFirst()) return ContentUris.withAppendedId(collection, it.getLong(0))
    }
    throw FileNotFoundException("This music file is no longer available. Rescan its storage device.")
  }
}

/** Private, read-only adapter for Astra's existing content-URI readers/player. */
class TvAudioProvider : ContentProvider() {
  override fun onCreate() = true
  override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor? {
    if (mode != "r") throw FileNotFoundException("TV music access is read-only")
    val context = requireNotNull(context)
    return context.contentResolver.openFileDescriptor(TvMusicStorage.resolve(context, uri), "r")
  }
  override fun getType(uri: Uri): String? {
    val context = requireNotNull(context)
    return context.contentResolver.getType(TvMusicStorage.resolve(context, uri))
  }
  override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? {
    val context = requireNotNull(context)
    return context.contentResolver.query(TvMusicStorage.resolve(context, uri), projection, null, null, null)
  }
  override fun insert(uri: Uri, values: ContentValues?): Uri? = throw UnsupportedOperationException("Read-only")
  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = throw UnsupportedOperationException("Read-only")
  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = throw UnsupportedOperationException("Read-only")
}
