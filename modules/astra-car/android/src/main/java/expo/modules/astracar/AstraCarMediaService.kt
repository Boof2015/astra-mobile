package expo.modules.astracar

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.MediaBrowserCompat.MediaItem
import android.util.Log
import androidx.media.MediaBrowserServiceCompat

private const val TAG = "AstraCarMedia"

class AstraCarMediaService : MediaBrowserServiceCompat() {
  private lateinit var mediaSession: MediaSessionCompat
  private lateinit var catalog: AstraCarCatalog

  override fun onCreate() {
    super.onCreate()
    catalog = AstraCarCatalog(this)
    mediaSession = MediaSessionCompat(this, "AstraCar").apply {
      setCallback(
        object : MediaSessionCompat.Callback() {
          override fun onPlay() {
            AstraCarCommandService.startTransport(this@AstraCarMediaService, "play")
          }

          override fun onPause() {
            AstraCarCommandService.startTransport(this@AstraCarMediaService, "pause")
          }

          override fun onStop() {
            AstraCarCommandService.startTransport(this@AstraCarMediaService, "pause")
          }

          override fun onSkipToNext() {
            AstraCarCommandService.startTransport(this@AstraCarMediaService, "next")
          }

          override fun onSkipToPrevious() {
            AstraCarCommandService.startTransport(this@AstraCarMediaService, "previous")
          }

          override fun onSeekTo(pos: Long) {
            AstraCarCommandService.startSeek(this@AstraCarMediaService, pos)
          }

          override fun onPlayFromMediaId(mediaId: String?, extras: Bundle?) {
            AstraCarCommandService.startPlayFromMediaId(this@AstraCarMediaService, mediaId)
          }

          override fun onPlayFromSearch(query: String?, extras: Bundle?) {
            AstraCarCommandService.startPlayFromSearch(this@AstraCarMediaService, query, extras)
          }

          override fun onCustomAction(action: String?, extras: Bundle?) {
            if (action == AstraCarFavoriteAction.TOGGLE) {
              AstraCarCommandService.startFavoriteAction(this@AstraCarMediaService)
            } else {
              super.onCustomAction(action, extras)
            }
          }
        },
      )
      applyAstraState(AstraCarNowPlayingStore.load(this@AstraCarMediaService))
    }
    sessionToken = mediaSession.sessionToken
    AstraCarNowPlayingStore.attach(this)
  }

  override fun onGetRoot(
    clientPackageName: String,
    clientUid: Int,
    rootHints: Bundle?,
  ): BrowserRoot {
    // The art provider is exported=false; the framework does NOT auto-grant browse-item
    // icon URIs to the Auto host on every head unit (observed SecurityException from
    // gearhead). Explicitly grant the connecting client read access to our art subtrees.
    grantArtworkAccess(clientPackageName)
    return BrowserRoot(AstraCarMediaIds.root, null)
  }

  private fun grantArtworkAccess(clientPackageName: String) {
    val authority = AstraCarArtwork.authority(this)
    val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
    for (path in listOf("local", "remote")) {
      runCatching {
        grantUriPermission(clientPackageName, Uri.parse("content://$authority/$path"), flags)
      }.onFailure { Log.w(TAG, "grantUriPermission failed for $clientPackageName/$path", it) }
    }
  }

  override fun onLoadChildren(parentId: String, result: Result<MutableList<MediaItem>>) {
    loadChildren(parentId, null, result)
  }

  override fun onLoadChildren(
    parentId: String,
    result: Result<MutableList<MediaItem>>,
    options: Bundle,
  ) {
    loadChildren(parentId, options, result)
  }

  override fun onLoadItem(itemId: String, result: Result<MediaItem>) {
    result.detach()
    Thread {
      val item = runCatching { catalog.loadItem(itemId) }
        .onFailure { Log.e(TAG, "loadItem failed for $itemId", it) }
        .getOrNull()
      runCatching { result.sendResult(item) }
        .onFailure { Log.e(TAG, "sendResult(item) failed for $itemId", it) }
    }.start()
  }

  fun applyNowPlaying(state: AstraCarNowPlayingState) {
    if (this::mediaSession.isInitialized) {
      mediaSession.applyAstraState(state)
    }
  }

  override fun onDestroy() {
    AstraCarNowPlayingStore.detach(this)
    if (this::mediaSession.isInitialized) {
      mediaSession.release()
    }
    super.onDestroy()
  }

  private fun loadChildren(
    parentId: String,
    options: Bundle?,
    result: Result<MutableList<MediaItem>>,
  ) {
    result.detach()
    Thread {
      val items = runCatching { catalog.loadChildren(parentId, options).toMutableList() }
        .onFailure { Log.e(TAG, "loadChildren failed for $parentId", it) }
        .getOrDefault(mutableListOf())
      runCatching { result.sendResult(items) }
        .onFailure { Log.e(TAG, "sendResult failed for $parentId (${items.size} items)", it) }
    }.start()
  }
}
