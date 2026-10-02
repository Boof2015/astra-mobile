package expo.modules.astradiscord

import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import expo.modules.astracar.AstraCarPlaybackBridge
import expo.modules.astracar.AstraCarPlaybackSnapshot
import java.lang.ref.WeakReference
import java.util.concurrent.CopyOnWriteArraySet

/** Service-owned presence. Activity/React lifetimes only provide setup and settings. */
object DiscordPresenceManager {
  private val main = Handler(Looper.getMainLooper())
  private val worker by lazy {
    Handler(HandlerThread("AstraDiscord").apply { start() }.looper)
  }
  private var activity = WeakReference<Activity>(null)
  private var unsubscribe: (() -> Unit)? = null
  private var activeGeneration = 0L
  private var context: Context? = null
  private var sdkReady = false
  private val listeners = CopyOnWriteArraySet<(Map<String, Any?>) -> Unit>()
  @Volatile private var enabled = false
  @Volatile private var preferences = DiscordPreferences()
  private var latestSnapshot: AstraCarPlaybackSnapshot? = null
  private var artworkResolver: DiscordArtworkResolver? = null
  private var artworkQuery: DiscordArtworkQuery? = null
  private val retryArtwork = Runnable {
    if (enabled && preferences.coverArtEnabled && latestSnapshot?.state == "playing") {
      artworkQuery = null
      refreshArtwork()
    }
  }
  @Volatile private var current: Map<String, Any?> = mapOf(
    "available" to BuildConfig.SDK_AVAILABLE, "enabled" to false,
    "state" to "off", "message" to "Off", "lastUpdatedAt" to null,
    "settings" to preferences.toMap(), "artworkState" to "idle", "artworkProvider" to null,
  )
  private val controller by lazy {
    DiscordPresenceController(SdkTransport(), SystemClock::elapsedRealtime, System::currentTimeMillis) { state, message, acknowledged ->
      main.post {
        val next = current + mapOf(
          "enabled" to enabled, "settings" to preferences.toMap(),
          "state" to state, "message" to message,
          "lastUpdatedAt" to if (acknowledged) System.currentTimeMillis() else current["lastUpdatedAt"],
        )
        if (next != current) {
          if (next["state"] != current["state"]) Log.i("AstraDiscord", "status=$state")
          emit(next)
        }
      }
    }
  }
  private val tick = object : Runnable {
    override fun run() {
      worker.removeCallbacks(this)
      controller.tick()?.let { worker.postDelayed(this, it) }
    }
  }

  @Synchronized fun initialize(value: Context) {
    if (context != null) return
    context = value.applicationContext
    val stored = value.getSharedPreferences("astra_discord", Context.MODE_PRIVATE)
    enabled = BuildConfig.SDK_AVAILABLE && stored.getBoolean("enabled", false)
    preferences = DiscordPreferences().updated(stored.all)
    current = current + mapOf("enabled" to enabled, "state" to if (enabled) "idle" else "off",
      "message" to if (enabled) "Waiting for playback." else "Off", "settings" to preferences.toMap())
  }

  fun onActivityCreated(value: Activity) {
    initialize(value)
    activity = WeakReference(value)
    initializeActivity()
  }

  private fun initializeActivity() {
    check(Looper.myLooper() == Looper.getMainLooper())
    if (!enabled || !BuildConfig.SDK_AVAILABLE) return
    val value = activity.get()?.takeUnless { it.isDestroyed } ?: return
    try {
      DiscordSdkActivity.initialize(value)
      sdkReady = true
      val setting = enabled
      val presentation = preferences
      dispatch { enabled = setting; preferences = presentation; activityReady = true; retry() }
    } catch (error: Exception) {
      Log.w("AstraDiscord", "Activity initialization failed: ${error.javaClass.simpleName}")
    } catch (error: LinkageError) {
      Log.w("AstraDiscord", "SDK load failed: ${error.javaClass.simpleName}")
    }
  }

  fun setEnabled(value: Context, requested: Boolean) = configure(value, mapOf("enabled" to requested))

  fun configure(value: Context, updates: Map<String, Any?>) {
    check(Looper.myLooper() == Looper.getMainLooper())
    initialize(value)
    enabled = (updates["enabled"] as? Boolean ?: enabled) && BuildConfig.SDK_AVAILABLE
    preferences = preferences.updated(updates)
    val editor = value.getSharedPreferences("astra_discord", Context.MODE_PRIVATE).edit().putBoolean("enabled", enabled)
    preferences.toMap().forEach { (key, field) ->
      when (field) { is Boolean -> editor.putBoolean(key, field); is Int -> editor.putInt(key, field); is String -> editor.putString(key, field) }
    }
    editor.apply()
    emit(current + mapOf("enabled" to enabled, "settings" to preferences.toMap()))
    if (!sdkReady) initializeActivity()
    val setting = enabled
    val presentation = preferences
    dispatch { enabled = setting; preferences = presentation; activityReady = sdkReady; retry() }
    refreshArtwork()
  }

  /** Invoked by RNTP, including headless Bluetooth/Android Auto startup. */
  fun startService(value: Context, generation: Long) {
    check(Looper.myLooper() == Looper.getMainLooper())
    initialize(value)
    if (!BuildConfig.SDK_AVAILABLE) return
    activeGeneration = generation
    unsubscribe?.invoke()
    val setting = enabled
    val presentation = preferences
    dispatch { enabled = setting; preferences = presentation; serviceActive = true; activityReady = sdkReady; accept(null); retry() }
    initializeActivity()
    unsubscribe = AstraCarPlaybackBridge.subscribe {
      val snapshot = AstraCarPlaybackBridge.snapshot?.takeIf { it.generation == activeGeneration }
      latestSnapshot = snapshot
      dispatch { accept(snapshot) }
      refreshArtwork()
    }
  }

  fun stopService(generation: Long) {
    check(Looper.myLooper() == Looper.getMainLooper())
    if (generation != activeGeneration || !BuildConfig.SDK_AVAILABLE) return
    unsubscribe?.invoke()
    unsubscribe = null
    activeGeneration = 0
    latestSnapshot = null
    refreshArtwork()
    dispatch { serviceActive = false; accept(null) }
  }

  private fun refreshArtwork() {
    val snapshot = latestSnapshot
    val query = snapshot?.track?.takeIf {
      enabled && preferences.coverArtEnabled && activeGeneration != 0L && snapshot.state in listOf("playing", "paused", "loading")
    }?.let(DiscordArtworkQuery::from)
    if (query == artworkQuery) return
    main.removeCallbacks(retryArtwork)
    artworkQuery = query
    artworkResolver?.cancel()
    dispatch { artwork = null }
    emit(current + mapOf("artworkState" to if (query == null) "idle" else "loading", "artworkProvider" to null))
    if (query == null) return
    val resolver = artworkResolver ?: DiscordArtworkResolver(context!!).also { artworkResolver = it }
    resolver.resolve(query) { result ->
      if (artworkQuery != query) return@resolve
      emit(current + mapOf("artworkState" to result.state, "artworkProvider" to result.provider))
      dispatch { artwork = query to result.url }
      if (result.state == "unavailable") main.postDelayed(retryArtwork, 120_000)
    }
  }

  fun clearArtworkCache() {
    check(Looper.myLooper() == Looper.getMainLooper())
    // Initialize even if lookup is off so a saved cache can still be cleared.
    val resolver = artworkResolver ?: context?.let { DiscordArtworkResolver(it).also { artworkResolver = it } } ?: return
    resolver.clear()
    artworkQuery = null
    dispatch { artwork = null }
    emit(current + mapOf("artworkState" to "idle", "artworkProvider" to null))
    refreshArtwork()
  }

  private fun emit(next: Map<String, Any?>) {
    if (next == current) return
    current = next
    listeners.forEach { it(next) }
  }

  private fun dispatch(action: DiscordPresenceController.() -> Unit) {
    worker.post { controller.action(); worker.removeCallbacks(tick); tick.run() }
  }

  fun status(): Map<String, Any?> = current
  fun subscribe(listener: (Map<String, Any?>) -> Unit): () -> Unit {
    listeners.add(listener)
    return { listeners.remove(listener) }
  }
}
