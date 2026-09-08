package expo.modules.astracar

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.net.Uri
import android.os.Bundle
import android.os.IBinder
import android.support.v4.media.MediaBrowserCompat.MediaItem
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.util.Log
import androidx.media.MediaBrowserServiceCompat
import androidx.room.InvalidationTracker
import expo.modules.astralibraryscanner.data.AstraLibraryRepository
import kotlinx.coroutines.*

class AstraCarMediaService : MediaBrowserServiceCompat() {
  private lateinit var session: MediaSessionCompat
  private lateinit var presenter: AstraCarSessionPresenter
  private lateinit var catalog: AstraCarCatalog
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private val io = Dispatchers.IO.limitedParallelism(4)
  private val subscriptions = LinkedHashSet<String>()
  private val actionLimits = mutableMapOf<String, Int>()
  private val queueIds = LinkedHashMap<String, Long>()
  private var queueIdCounter = 0L
  private var queueTargets = emptyMap<Long, String>()
  private var favorite = false
  private var activeQueueId = MediaSessionCompat.QueueItem.UNKNOWN_ID.toLong()
  private var queueCount = 0L
  private var queuePosition = 0L
  private var artworkRevision = -1L
  private var queueBrowseKey: List<Any?>? = null
  private var derivedJob: Job? = null
  private var invalidationJob: Job? = null
  private var unsubscribe: (() -> Unit)? = null
  private var userObserver: InvalidationTracker.Observer? = null
  private var catalogObserver: InvalidationTracker.Observer? = null
  private var userTracker: InvalidationTracker? = null
  private var catalogTracker: InvalidationTracker? = null
  private var bound = false
  private var displayedQueue = emptyList<MediaSessionCompat.QueueItem>()
  private val connection = object : ServiceConnection {
    override fun onServiceConnected(name: ComponentName, binder: IBinder) {
      (binder as? AstraCarCommandService.LocalBinder)?.service?.initialize()
    }
    override fun onServiceDisconnected(name: ComponentName) = Unit
  }

  override fun onCreate() {
    super.onCreate()
    AstraCarPlaybackBridge.restoreContext(this)
    catalog = AstraCarCatalog(this)
    session = MediaSessionCompat(this, "AstraCar").apply {
      setCallback(object : MediaSessionCompat.Callback() {
        override fun onPlay() = command("play")
        override fun onPause() = command("pause")
        override fun onStop() = command("pause")
        override fun onSkipToNext() = command("next")
        override fun onSkipToPrevious() = command("previous")
        override fun onSeekTo(pos: Long) = AstraCarCommandService.startSeek(this@AstraCarMediaService, pos)
        override fun onPlayFromMediaId(mediaId: String?, extras: Bundle?) = AstraCarCommandService.startPlayFromMediaId(this@AstraCarMediaService, mediaId)
        override fun onPlayFromSearch(query: String?, extras: Bundle?) = AstraCarCommandService.startPlayFromSearch(this@AstraCarMediaService, query, extras)
        override fun onSkipToQueueItem(id: Long) {
          val target = queueTargets[id]
          if (target == null) AstraCarPlaybackBridge.reportError("This queue item is no longer available.")
          else AstraCarCommandService.startPlayFromMediaId(this@AstraCarMediaService, target)
        }
        override fun onSetShuffleMode(shuffleMode: Int) {
          if (shuffleMode in listOf(PlaybackStateCompat.SHUFFLE_MODE_NONE, PlaybackStateCompat.SHUFFLE_MODE_ALL)) {
            dispatch("setShuffle", "enabled", shuffleMode == PlaybackStateCompat.SHUFFLE_MODE_ALL)
          }
        }
        override fun onSetRepeatMode(repeatMode: Int) {
          val value = when (repeatMode) {
            PlaybackStateCompat.REPEAT_MODE_NONE -> "none"
            PlaybackStateCompat.REPEAT_MODE_ALL -> "all"
            PlaybackStateCompat.REPEAT_MODE_ONE -> "one"
            else -> return
          }
          dispatch("setRepeat", "repeat", value)
        }
        override fun onCustomAction(action: String?, extras: Bundle?) {
          when (action) {
            "shuffleOn" -> dispatch("setShuffle", "enabled", true)
            "shuffleOff" -> dispatch("setShuffle", "enabled", false)
            "cycleRepeat" -> command("cycleRepeat")
            AstraCarFavoriteAction.TOGGLE -> command("toggleFavorite")
            else -> super.onCustomAction(action, extras)
          }
        }
      })
      packageManager.getLaunchIntentForPackage(packageName)?.let {
        setSessionActivity(PendingIntent.getActivity(this@AstraCarMediaService, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
      }
      setQueueTitle("Queue")
    }
    presenter = AstraCarSessionPresenter(this, session)
    sessionToken = session.sessionToken
    unsubscribe = AstraCarPlaybackBridge.subscribe {
      render()
      refreshDerivedState()
      val live = AstraCarPlaybackBridge.snapshot
      val key = listOf(live?.generation, live?.track, live?.queueCount)
      if (queueBrowseKey != key) {
        queueBrowseKey = key
        notifyChildrenChanged(AstraCarMediaIds.section("queue"))
      }
      if (artworkRevision != AstraCarPlaybackBridge.artworkRevision) {
        artworkRevision = AstraCarPlaybackBridge.artworkRevision
        invalidate(emptySet())
      }
    }
    bound = bindService(Intent(this, AstraCarCommandService::class.java), connection, Context.BIND_AUTO_CREATE)
    scope.launch {
      try {
        val repository = AstraLibraryRepository.get(this@AstraCarMediaService)
        withContext(io) { repository.initialize(); catalog.queue.restoreCard() }
        userObserver = object : InvalidationTracker.Observer("favorites", "playback_history", "playlists", "playlist_tracks", "playback_queue_entries", "settings") {
          override fun onInvalidated(tables: Set<String>) = invalidate(tables)
        }.also {
          userTracker = repository.userDb().invalidationTracker
          userTracker?.addObserver(it)
        }
        catalogObserver = object : InvalidationTracker.Observer("catalog_meta", "tracks", "album_summaries", "artist_summaries", "track_user_facts") {
          override fun onInvalidated(tables: Set<String>) = invalidate(tables)
        }.also {
          catalogTracker = repository.catalogDb().invalidationTracker
          catalogTracker?.addObserver(it)
        }
        refreshDerivedState()
      } catch (error: Exception) { Log.e(TAG, "Unable to observe car library", error) }
    }
  }

  private fun command(name: String) = AstraCarCommandService.startTransport(this, name)
  private fun dispatch(command: String, key: String, value: Any) = AstraCarCommandService.dispatch(this, Bundle().apply {
    putString("command", command)
    if (value is Boolean) putBoolean(key, value) else putString(key, value.toString())
  })

  override fun onGetRoot(clientPackageName: String, clientUid: Int, rootHints: Bundle?): BrowserRoot {
    val limit = (rootHints?.getInt(AstraCarBrowseActions.LIMIT, 0) ?: 0).coerceIn(0, 2)
    actionLimits[clientPackageName] = limit
    val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
    for (path in listOf("local", "remote")) runCatching {
      grantUriPermission(clientPackageName, Uri.parse("content://${AstraCarArtwork.authority(this)}/$path"), flags)
    }.onFailure { Log.w(TAG, "Unable to grant car artwork access") }
    return BrowserRoot(AstraCarMediaIds.root, Bundle().apply {
      putBoolean("android.media.browse.SEARCH_SUPPORTED", true)
      putBoolean("android.media.browse.CONTENT_STYLE_SUPPORTED", true)
      putInt("android.media.browse.CONTENT_STYLE_BROWSABLE_HINT", 1)
      putInt("android.media.browse.CONTENT_STYLE_PLAYABLE_HINT", 1)
      putParcelableArrayList(AstraCarBrowseActions.ROOT_ACTIONS, AstraCarBrowseActions.root(this@AstraCarMediaService, limit))
    })
  }

  private fun actionLimit(): Int = runCatching { actionLimits[currentBrowserInfo.packageName] ?: 0 }.getOrDefault(0)
  override fun onSubscribe(parentId: String, options: Bundle?) { subscriptions.add(parentId) }
  override fun onUnsubscribe(parentId: String) { subscriptions.remove(parentId) }
  override fun onLoadChildren(parentId: String, result: Result<MutableList<MediaItem>>) = loadChildren(parentId, null, result)
  override fun onLoadChildren(parentId: String, result: Result<MutableList<MediaItem>>, options: Bundle) = loadChildren(parentId, options, result)

  private fun loadChildren(parentId: String, options: Bundle?, result: Result<MutableList<MediaItem>>) {
    val limit = actionLimit()
    result.detach()
    scope.launch {
      try { result.sendResult(withContext(io) { catalog.loadChildren(parentId, options, limit).toMutableList() }) }
      catch (error: CancellationException) { throw error }
      catch (error: Exception) { Log.e(TAG, "Car browse failed", error); result.sendResult(null) }
    }
  }

  override fun onLoadItem(itemId: String, result: Result<MediaItem>) {
    val limit = actionLimit()
    result.detach()
    scope.launch {
      try { result.sendResult(withContext(io) { catalog.loadItem(itemId, limit) }) }
      catch (error: CancellationException) { throw error }
      catch (error: Exception) { Log.e(TAG, "Car item unavailable", error); result.sendResult(null) }
    }
  }

  override fun onSearch(query: String, extras: Bundle?, result: Result<MutableList<MediaItem>>) {
    val limit = actionLimit()
    result.detach()
    scope.launch {
      try { result.sendResult(withContext(io) { catalog.search(query, limit).toMutableList() }) }
      catch (error: CancellationException) { throw error }
      catch (error: Exception) { Log.e(TAG, "Car search failed", error); result.sendResult(null) }
    }
  }

  override fun onCustomAction(action: String, extras: Bundle?, result: Result<Bundle>) {
    val media = AstraCarMediaIds.decode(extras?.getString(AstraCarBrowseActions.MEDIA_ID))
    if (action !in listOf("playNext", "addToQueue") || media?.kind !in listOf("track", "album", "artist", "playlist")) {
      result.sendError(Bundle().apply { putString("message", "This action is unavailable.") }); return
    }
    result.detach()
    AstraCarCommandService.dispatch(this, Bundle().apply {
      putString("command", "enqueue"); putString("placement", if (action == "playNext") "next" else "end")
      putBundle("media", AstraCarMediaIds.toBundle(media!!))
    }) { error ->
      val response = Bundle().apply { putString("message", error ?: "Added to queue") }
      if (error == null) result.sendResult(response) else result.sendError(response)
    }
  }

  private fun render() {
    val snapshot = AstraCarPlaybackBridge.snapshot ?: AstraCarNowPlayingStore.load(this)
    presenter.apply(snapshot, favorite, activeQueueId,
      hasNext = snapshot.track != null && (queuePosition + 1 < queueCount || AstraCarPlaybackBridge.repeat == "all"),
      hasPrevious = snapshot.track != null)
  }

  private fun refreshDerivedState() {
    derivedJob?.cancel()
    derivedJob = scope.launch {
      try {
        val repository = AstraLibraryRepository.get(this@AstraCarMediaService)
        withContext(io) { repository.initialize() }
        val snapshot = catalog.queue.current()
        val path = snapshot.track?.path
        val count = withContext(io) { catalog.queue.count() }
        val position = snapshot.track?.let { track ->
          withContext(io) { catalog.queue.resolve(track.sessionId ?: "native:${snapshot.generation}", track.entryId) }
        } ?: 0L
        val start = (position - 10).coerceAtLeast(0)
        val tracks = withContext(io) { catalog.queue.page(start, 100) }
        val nextFavorite = path != null && withContext(io) { repository.userDb().userDao().isFavorite(path) }
        val items = mutableListOf<MediaSessionCompat.QueueItem>()
        val targets = mutableMapOf<Long, String>()
        for (track in tracks) {
          val description = catalog.queueItem(track).description
          val id = description.mediaId!!
          val queueId = queueIds.getOrPut(id) { ++queueIdCounter }
          targets[queueId] = id
          items += MediaSessionCompat.QueueItem(description, queueId)
        }
        ensureActive()
        favorite = nextFavorite
        queueCount = count
        queuePosition = position
        queueTargets = targets
        // Discard mappings outside the published window, but never recycle their numeric IDs.
        queueIds.keys.retainAll(targets.values.toSet())
        val active = snapshot.track
        val activeId = active?.let { AstraCarMediaIds.encode(AstraCarMediaId("queueEntry", key = it.entryId, session = it.sessionId ?: "native:${snapshot.generation}")) }
        activeQueueId = queueIds[activeId] ?: MediaSessionCompat.QueueItem.UNKNOWN_ID.toLong()
        val changed = displayedQueue.map { listOf(it.queueId, it.description.mediaId, it.description.title, it.description.subtitle, it.description.iconUri) } != items.map { listOf(it.queueId, it.description.mediaId, it.description.title, it.description.subtitle, it.description.iconUri) }
        if (changed) { displayedQueue = items; session.setQueue(items) }
        render()
      } catch (error: CancellationException) { throw error }
      catch (error: Exception) { Log.e(TAG, "Car queue refresh failed", error) }
    }
  }

  private fun invalidate(@Suppress("UNUSED_PARAMETER") tables: Set<String>) {
    scope.launch {
      refreshDerivedState()
      // Native debounce remains runnable with the phone locked and JS timers suspended.
      invalidationJob?.cancel()
      invalidationJob = launch {
        delay(150)
        subscriptions.toList().forEach { notifyChildrenChanged(it) }
      }
    }
  }

  override fun onDestroy() {
    unsubscribe?.invoke()
    scope.cancel()
    userObserver?.let { userTracker?.removeObserver(it) }
    catalogObserver?.let { catalogTracker?.removeObserver(it) }
    if (bound) unbindService(connection)
    session.release()
    super.onDestroy()
  }
  companion object { private const val TAG = "AstraCarMedia" }
}
