package expo.modules.astralibraryscanner.data

import android.net.Uri
import expo.modules.astralibraryscanner.TvMusicStorage

/** The caller already limits tracks to the selected source/folder ID. */
internal fun folderSubtreeContains(directoryPath: String, parentUri: String): Boolean {
  TvMusicStorage.scope(parentUri)?.let { parent ->
    // Whole-volume TV roots have an empty path. Their generated child nodes
    // start with '/', while MediaStore's relative paths do not.
    val directory = directoryPath.trim('/')
    val path = parent.path.trim('/')
    return directory.isEmpty() || path == directory || path.startsWith("$directory/")
  }
  // Preserve the SAF document-path matching used on phones and tablets.
  val path = runCatching {
    Uri.decode(parentUri.substringAfter("/document/")).substringAfter(':')
  }.getOrNull() ?: return false
  return path == directoryPath || path.startsWith("$directoryPath/")
}
