package expo.modules.astracar

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicLong

/** RNTP publishes here on the player looper, even when React has no active tasks. */
object AstraCarPlaybackBridge {
  private val generations = AtomicLong()
  private val main = Handler(Looper.getMainLooper())
  private val listeners = LinkedHashSet<() -> Unit>()
  private var queueReader: ((Int, Int) -> List<AstraCarTrack>)? = null
  private var ownerGeneration = 0L
  private var attached = false
  var snapshot: AstraCarPlaybackSnapshot? = null
    private set
  var shuffle = false
    private set
  var repeat = "none"
    private set
  var queueSessionId: String? = null
    private set
  var artworkRevision = 0L
    private set
  var commandError: String? = null
    private set

  fun attach(reader: (Int, Int) -> List<AstraCarTrack>): Long {
    check(Looper.myLooper() == Looper.getMainLooper())
    ownerGeneration = generations.incrementAndGet()
    queueReader = reader
    attached = true
    return ownerGeneration
  }

  fun restore(value: AstraCarPlaybackSnapshot) = onMain {
    if (attached || snapshot != null) return@onMain
    snapshot = value.copy(state = if (value.track != null) "paused" else "stopped", speed = 0f)
    // Browsing must not make an old resume card newer than the phone's saved session.
    changed()
  }

  fun publish(context: Context, value: AstraCarPlaybackSnapshot) {
    onMain {
      if (!attached || value.generation != ownerGeneration || !AstraCarSnapshotPolicy.accepts(snapshot, value)) return@onMain
      val previous = snapshot
      snapshot = value
      commandError = null
      // Persist a resume card, never an independently "playing" session. No per-tick disk work.
      if (previous?.track != value.track || previous?.state != value.state || kotlin.math.abs((previous?.positionMs ?: 0) - value.positionMs) > 1000) {
        AstraCarNowPlayingStore.save(context, value)
      }
      changed()
    }
  }

  fun detach(context: Context, generation: Long) {
    onMain {
      if (ownerGeneration != generation) return@onMain
      val previous = snapshot
      queueReader = null
      attached = false
      snapshot = previous?.copy(
        sequence = previous.sequence + 1,
        state = if (previous.track != null) "paused" else "stopped",
        positionMs = AstraCarSnapshotPolicy.position(previous, SystemClock.elapsedRealtime()),
        speed = 0f,
        queueCount = if (previous.track?.sessionId == null) 0 else previous.queueCount,
        updatedAt = SystemClock.elapsedRealtime(),
      )
      snapshot?.let { AstraCarNowPlayingStore.save(context, it) }
      changed()
    }
  }

  fun setContext(context: Context, shuffle: Boolean, repeat: String, sessionId: String?) = onMain {
    if (this.shuffle == shuffle && this.repeat == repeat && queueSessionId == sessionId) return@onMain
    this.shuffle = shuffle
    this.repeat = repeat.takeIf { it in setOf("none", "all", "one") } ?: "none"
    queueSessionId = sessionId
    context.getSharedPreferences("astra_car_now_playing", Context.MODE_PRIVATE).edit()
      .putBoolean("shuffle", shuffle).putString("repeat", this.repeat).apply()
    changed()
  }

  fun restoreContext(context: Context) {
    if (attached) return
    val prefs = context.getSharedPreferences("astra_car_now_playing", Context.MODE_PRIVATE)
    shuffle = prefs.getBoolean("shuffle", false)
    repeat = prefs.getString("repeat", "none") ?: "none"
  }

  fun reportError(message: String?) = onMain {
    commandError = message
    changed()
  }

  fun subscribe(listener: () -> Unit): () -> Unit {
    check(Looper.myLooper() == Looper.getMainLooper())
    listeners.add(listener)
    listener()
    return { listeners.remove(listener) }
  }

  suspend fun readQueue(offset: Int, limit: Int): List<AstraCarTrack> = withContext(Dispatchers.Main.immediate) {
    queueReader?.invoke(offset.coerceAtLeast(0), limit.coerceIn(0, 100)).orEmpty()
  }

  fun refresh() = onMain { artworkRevision++; changed() }

  private fun changed() { listeners.toList().forEach { it() } }
  private fun onMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post(block)
  }
}
