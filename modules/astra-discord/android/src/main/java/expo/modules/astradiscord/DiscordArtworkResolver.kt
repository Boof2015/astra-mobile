package expo.modules.astradiscord

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CancellationException
import java.util.concurrent.Executors
import java.util.concurrent.Future

/** Main-thread owner; HTTP work never runs on the playback, UI, or SDK callback threads. */
class DiscordArtworkResolver(context: Context) {
  private val main = Handler(Looper.getMainLooper())
  private val network = Executors.newSingleThreadExecutor { Thread(it, "AstraDiscordArtwork") }
  private val storage = context.getSharedPreferences("astra_discord_artwork_v1", Context.MODE_PRIVATE)
  private val cache = DiscordArtworkCache(System::currentTimeMillis)
  private var generation = 0L
  private var task: Future<*>? = null
  private var request: Request? = null
  private var nextMusicBrainzAt = 0L // Accessed only by the single network worker.

  init {
    runCatching {
      JSONArray(storage.getString("entries", "[]")).objects().takeLast(256).forEach {
        val query = it.getJSONObject("query")
        val url = it.string("url").takeIf { value -> DiscordArtworkPolicy.publicImage(value) != null }
        val state = it.string("state")
        if (state == "not-found" || state == "found" && url != null) cache.restore(DiscordArtworkCache.Entry(
          DiscordArtworkQuery(query.string("album"), query.string("artist"), query.string("albumArtist"), query.string("title")),
          DiscordArtworkResult(state, url, it.string("provider").ifBlank { null }), it.optLong("expires"),
        ))
      }
    }
  }

  private fun persist() {
    val entries = JSONArray()
    cache.saved().forEach { entry ->
      entries.put(JSONObject().put("query", JSONObject().put("album", entry.query.album).put("artist", entry.query.artist)
        .put("albumArtist", entry.query.albumArtist).put("title", entry.query.title))
        .put("state", entry.result.state).put("url", entry.result.url).put("provider", entry.result.provider).put("expires", entry.expires))
    }
    storage.edit().putString("entries", entries.toString()).apply()
  }

  fun cancel() {
    generation++
    request?.cancel()
    request = null
    task?.cancel(true)
    task = null
  }

  fun clear() { cancel(); cache.clear(); storage.edit().clear().apply() }

  fun resolve(query: DiscordArtworkQuery, callback: (DiscordArtworkResult) -> Unit) {
    cancel()
    cache.get(query)?.let { callback(it); return }
    val epoch = generation
    val active = Request()
    request = active
    task = network.submit {
      val result = try {
        DiscordArtworkLookup { address ->
          active.check()
          if (address.startsWith("https://musicbrainz.org/")) {
            val delay = nextMusicBrainzAt - SystemClock.elapsedRealtime()
            if (delay > 0) Thread.sleep(delay)
            active.check()
            nextMusicBrainzAt = SystemClock.elapsedRealtime() + 1_100
          }
          active.fetch(address)
        }.resolve(query)
      } catch (_: CancellationException) { return@submit }
      catch (_: InterruptedException) { return@submit }
      catch (_: Exception) { DiscordArtworkResult("unavailable") }
      main.post {
        if (epoch != generation) return@post
        request = null; task = null
        cache.put(query, result)
        persist()
        callback(result)
      }
    }
  }

  private class Request {
    @Volatile private var cancelled = false
    @Volatile private var connection: HttpURLConnection? = null
    private val deadline = SystemClock.elapsedRealtime() + 40_000
    fun cancel() { cancelled = true; connection?.disconnect() }
    fun check() {
      if (cancelled || Thread.currentThread().isInterrupted) throw CancellationException()
      if (SystemClock.elapsedRealtime() >= deadline) throw IOException("Lookup timed out")
    }
    fun fetch(address: String): JSONObject? {
      check()
      val conn = URL(address).openConnection() as HttpURLConnection
      connection = conn
      conn.connectTimeout = 4_000
      conn.readTimeout = 4_000
      conn.setRequestProperty("Accept", "application/json")
      conn.setRequestProperty("User-Agent", "Astra-Mobile-Discord/0.1 (https://github.com/Boof2015/astra-mobile)")
      try {
        check()
        val status = conn.responseCode
        if (status == 404) return null
        if (status !in 200..299) throw IOException("Artwork provider unavailable")
        val bytes = conn.inputStream.use { input ->
          val output = java.io.ByteArrayOutputStream()
          val buffer = ByteArray(8192)
          while (true) {
            check()
            val read = input.read(buffer)
            if (read < 0) break
            if (output.size() + read > 1_048_576) throw IOException("Artwork response too large")
            output.write(buffer, 0, read)
          }
          output.toByteArray()
        }
        return JSONObject(String(bytes, Charsets.UTF_8))
      } finally { conn.disconnect(); connection = null }
    }
  }
}
