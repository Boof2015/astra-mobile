package expo.modules.astracar

import android.content.Context
import android.net.Uri

/**
 * content:// URI scheme served by [AstraCarArtworkProvider]. Android Auto only loads
 * artwork from `content://` (and `android.resource://`) URIs — never `file://` or
 * `http(s)://` — so every browse-list icon and now-playing art URI routes through here.
 */
object AstraCarArtwork {
  // Must match android:authorities="${applicationId}.astracar.artwork" in the manifest.
  // context.packageName resolves to the applicationId at runtime.
  private const val AUTHORITY_SUFFIX = ".astracar.artwork"

  const val ART_ID_PLACEHOLDER = "__ASTRA_ART_ID__"

  const val QUERY_FULL = "full"

  // Bump to change every art URI string. The Auto host (gearhead) caches image-load
  // FAILURES in Glide keyed by URI+size; URIs from the earlier builds (where the grant
  // was missing) are otherwise byte-identical and keep serving the cached SecurityException
  // instead of retrying. A version param makes them fresh URIs so they re-fetch.
  private const val CACHE_VERSION = "1"

  fun authority(context: Context): String = context.packageName + AUTHORITY_SUFFIX

  /**
   * Local cached artwork, resolved by the scanner's md5 file name (hash). `full=true`
   * requests the full-res `artwork/<hash>` (for now-playing); the default prefers the
   * 128px `artwork-thumbs/` file (fine for small browse-list icons).
   */
  fun localUri(context: Context, hash: String, full: Boolean = false): Uri =
    base(context)
      .appendPath("local")
      .appendPath(hash)
      .appendQueryParameter("v", CACHE_VERSION)
      .apply { if (full) appendQueryParameter(QUERY_FULL, "1") }
      .build()

  /** Remote (Subsonic/Jellyfin) cover art, downloaded + cached on demand. */
  fun remoteUri(context: Context, sourceId: Long, artworkSourceId: String): Uri =
    base(context)
      .appendPath("remote")
      .appendPath(sourceId.toString())
      .appendPath(artworkSourceId)
      .appendQueryParameter("v", CACHE_VERSION)
      .build()

  private fun base(context: Context): Uri.Builder =
    Uri.Builder().scheme("content").authority(authority(context))
}
