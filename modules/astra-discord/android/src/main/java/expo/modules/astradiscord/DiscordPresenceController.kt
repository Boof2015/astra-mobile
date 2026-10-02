package expo.modules.astradiscord

import expo.modules.astracar.AstraCarPlaybackSnapshot
import expo.modules.astracar.AstraCarSnapshotPolicy
import kotlin.math.abs

data class DiscordReceipt(val request: Long, val successful: Boolean)
interface DiscordTransport {
  fun open()
  fun publish(request: Long, activity: DiscordActivity)
  fun clear()
  fun poll(): List<DiscordReceipt>
  fun close()
}

/** Single-worker policy. No Activity, React instance, Android clock, or network is needed in tests. */
class DiscordPresenceController(
  private val transport: DiscordTransport,
  private val monotonic: () -> Long,
  private val wallTime: () -> Long,
  private val status: (String, String, Boolean) -> Unit,
) {
  companion object {
    const val PAUSE_CLEAR_MS = 5 * 60_000L
    fun text(value: String): String {
      val clean = value.replace('\u0000', ' ').trim()
      val points = clean.codePoints().toArray()
      val limited = if (points.size > 128) String(points, 0, 127) + "…" else clean
      return if (points.size == 1) limited + "\u200B" else limited
    }
    fun equivalent(a: DiscordActivity?, b: DiscordActivity): Boolean = a != null &&
      a.copy(start = b.start, end = b.end) == b && abs(a.start - b.start) <= 1 && abs(a.end - b.end) <= 1
  }

  var enabled = false
  var serviceActive = false
  var activityReady = false
  private var presentation: DiscordActivity? = null
  var preferences = DiscordPreferences()
    set(value) { if (field != value) presentation = null; field = value }
  var artwork: Pair<DiscordArtworkQuery, String?>? = null
    set(value) { if (field != value) presentation = null; field = value }
  private var snapshot: AstraCarPlaybackSnapshot? = null
  private var pausedAt: Long? = null
  private var opened = false
  private var drainingUntil: Long? = null
  private var lastPublished: DiscordActivity? = null
  private var lastSent = Long.MIN_VALUE / 2
  private var nextAttempt = 0L
  private var failures = 0
  private var serial = 0L
  private var pending: Pair<Long, DiscordActivity>? = null
  private var pendingAt = 0L
  private var hadPresence = false

  fun accept(next: AstraCarPlaybackSnapshot?) {
    if (next != null && snapshot != null && !AstraCarSnapshotPolicy.accepts(snapshot, next)) return
    if (snapshot?.state != next?.state || snapshot?.track != next?.track) presentation = null
    if (next?.state == "paused") {
      if (snapshot?.state != "paused" || snapshot?.track?.entryId != next.track?.entryId) pausedAt = monotonic()
    } else pausedAt = null
    snapshot = next
  }

  /** Explicit user retry / service start; failure backoff otherwise survives playback events. */
  fun retry() { nextAttempt = 0; failures = 0; lastPublished = null }

  private fun desired(now: Long): DiscordActivity? {
    if (!enabled || !serviceActive) return null
    val value = snapshot ?: return null
    val track = value.track ?: return null
    if (value.state !in setOf("playing", "paused", "loading")) return null
    if (value.state == "paused" && preferences.pauseClearMinutes > 0 &&
      now - (pausedAt ?: now) >= preferences.pauseClearMinutes * 60_000L) return null
    // Reuse formatting and URLs while only the native playback clock advances.
    var activity = presentation ?: run {
      val title = text(track.title).ifEmpty { "Unknown track" }
      val artist = track.artist.trim()
      val state = text(when (value.state) {
        "paused" -> if (artist.isEmpty()) "Paused" else "Paused • $artist"
        "loading" -> if (artist.isEmpty()) "Loading" else "Loading • $artist"
        else -> artist
      })
      val cover = artwork?.takeIf { it.first == DiscordArtworkQuery.from(track) }?.second
      DiscordPresentation.decorate(DiscordActivity(title, state), track, preferences, cover).also { presentation = it }
    }
    if (value.state == "playing" && value.durationMs > 0 && value.speed.isFinite() && value.speed > 0) {
      val position = AstraCarSnapshotPolicy.position(value, now)
      val start = ((wallTime() - position / value.speed.toDouble()) / 1000).toLong().coerceAtLeast(1)
      val end = start + (value.durationMs / value.speed.toDouble() / 1000).toLong().coerceAtLeast(1)
      activity = activity.copy(start = start, end = end)
    }
    return activity
  }

  private fun unavailable(now: Long, message: String) {
    failures = (failures + 1).coerceAtMost(5)
    nextAttempt = now + (2_000L shl (failures - 1)).coerceAtMost(30_000)
    pending = null
    lastPublished = null
    status("unavailable", message, false)
  }

  /** Returns the next wakeup delay, or null when no background work remains. */
  fun tick(): Long? {
    val now = monotonic()
    val desired = desired(now)
    try {
      if (opened) {
        for (receipt in transport.poll()) {
          val request = pending
          if (request == null || receipt.request != request.first) continue
          pending = null
          if (receipt.successful) {
            lastPublished = request.second
            failures = 0
            nextAttempt = 0
            if (desired != null && equivalent(request.second, desired)) {
              status("active", "Presence sent to Discord.", true)
            }
          } else unavailable(now, "Discord is unavailable. Open Discord and make sure you’re signed in.")
        }
      }
      if (desired == null) {
        pending = null // A late acknowledgement must never reactivate cleared presence.
        lastPublished = null
        if (opened && hadPresence) {
          transport.clear()
          hadPresence = false
          drainingUntil = now + 1_000
        }
        status(if (enabled) "idle" else "off", if (enabled) "Waiting for playback." else "Off", false)
        if (opened && now >= (drainingUntil ?: now)) {
          transport.close()
          opened = false
          drainingUntil = null
        }
        return if (opened) 50 else null
      }
      if (!activityReady) {
        status("waiting", "Open Astra to initialize the Discord connection.", false)
        return null
      }
      drainingUntil = null
      if (now < nextAttempt) return if (opened) 50 else nextAttempt - now
      if (!opened) { transport.open(); opened = true }
      if (pending != null && now - pendingAt >= 10_000) {
        unavailable(now, "Discord did not acknowledge the update. Retrying automatically.")
        return 50
      }
      // No per-position publication. Refresh occasionally to recover a restarted Discord client.
      if (pending == null && now - lastSent >= 1_000 &&
        (!equivalent(lastPublished, desired) || now - lastSent >= 30_000)) {
        val id = ++serial
        pending = id to desired
        pendingAt = now
        lastSent = now
        hadPresence = true
        transport.publish(id, desired)
        status("updating", "Updating Discord…", false)
      }
      return 50
    } catch (error: Exception) {
      runCatching { if (opened) transport.close() }
      opened = false
      hadPresence = false
      unavailable(now, "Discord connection failed. Retrying automatically.")
      return if (desired != null) nextAttempt - now else null
    } catch (error: LinkageError) {
      status("error", "Discord could not load on this device.", false)
      return null
    }
  }
}
