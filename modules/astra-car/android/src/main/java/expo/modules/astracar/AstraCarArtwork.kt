package expo.modules.astracar

import android.content.Context
import android.net.Uri
import java.io.File

object AstraCarArtwork {
  const val ART_ID_PLACEHOLDER = "__ASTRA_ART_ID__"
  const val QUERY_FULL = "full"
  fun authority(context: Context): String = context.packageName + ".astracar.artwork"
  fun placeholder(context: Context): Uri =
    Uri.parse("android.resource://${context.packageName}/drawable/ic_astra_artwork_placeholder")

  fun localUri(context: Context, hash: String, full: Boolean = false): Uri =
    base(context).appendPath("local").appendPath(hash)
      .appendQueryParameter("v", localFile(context, hash, full)?.let { "${it.lastModified()}:${it.length()}" } ?: "0")
      .apply { if (full) appendQueryParameter(QUERY_FULL, "1") }.build()

  fun remoteUri(context: Context, sourceId: Long, artworkSourceId: String, full: Boolean = true): Uri =
    base(context).appendPath("remote").appendPath(sourceId.toString()).appendPath(artworkSourceId)
      .appendQueryParameter("v", AstraCarArtworkCache.version(context, sourceId))
      .appendQueryParameter("ready", AstraCarArtworkCache.cached(context, sourceId, artworkSourceId, full)?.lastModified()?.toString() ?: "0")
      .apply { if (full) appendQueryParameter(QUERY_FULL, "1") }.build()

  fun readyRemoteUri(context: Context, sourceId: Long, artId: String, full: Boolean): Uri {
    AstraCarArtworkCache.prefetch(context.applicationContext, sourceId, artId, full)
    return if (AstraCarArtworkCache.cached(context, sourceId, artId, full) != null) remoteUri(context, sourceId, artId, full)
    else placeholder(context)
  }

  fun forTrack(context: Context, track: AstraCarTrack, full: Boolean = true): Uri {
    val hash = track.artwork?.takeIf { it.startsWith("file://") }?.let { Uri.parse(it).lastPathSegment }
    if (hash != null && localFile(context, hash, full) != null) return localUri(context, hash, full)
    if (track.sourceId != null && !track.artworkSourceId.isNullOrBlank()) {
      return readyRemoteUri(context, track.sourceId, track.artworkSourceId, full)
    }
    return placeholder(context)
  }

  fun localFile(context: Context, hash: String?, full: Boolean): File? {
    if (hash.isNullOrBlank() || !hash.matches(Regex("[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9]+)?"))) return null
    val original = File(File(context.filesDir, "artwork"), hash)
    val thumb = File(File(context.filesDir, "artwork-thumbs"), "${hash.substringBeforeLast('.', hash)}.jpg")
    return (if (full) listOf(original, thumb) else listOf(thumb, original)).firstOrNull { it.isFile && it.length() > 0 }
  }

  private fun base(context: Context) = Uri.Builder().scheme("content").authority(authority(context))
}
