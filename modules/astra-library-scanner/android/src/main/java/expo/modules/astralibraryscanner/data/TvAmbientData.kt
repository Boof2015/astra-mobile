package expo.modules.astralibraryscanner.data

import androidx.room.ColumnInfo
import java.util.Calendar
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Qualified listening sessions, not the separate legacy recent-play counter. */
data class AmbientTrackHistory(
  @ColumnInfo(name = "track_path") val path: String,
  val plays: Long,
  val weekPlays: Long,
  val firstPlayedAt: Long,
  val lastPlayedAt: Long,
)

private data class AmbientAlbumHistory(
  var plays: Long = 0, var weekPlays: Long = 0,
  var firstPlayedAt: Long = Long.MAX_VALUE, var lastPlayedAt: Long = 0,
)

/** All aggregation stays off the JS thread. Only one album crosses the bridge;
 * no history sessions, full track rows, artwork bytes or credentials do. */
internal object TvAmbientData {
  suspend fun moment(
    user: UserDao, catalog: CatalogDao, playingPath: String, artist: String,
    grouping: String, excluded: List<String>,
  ): Map<String, Any?>? = withContext(Dispatchers.IO) {
    val now = System.currentTimeMillis()
    val weekStart = Calendar.getInstance().apply {
      set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
      add(Calendar.DAY_OF_YEAR, -((get(Calendar.DAY_OF_WEEK) - firstDayOfWeek + 7) % 7))
    }.timeInMillis
    val revision = catalog.getRevision()
    val playing = catalog.getActiveTrack(playingPath)
    val albums = catalog.getAllAlbumSummaries(revision).filter { it.identityKey != playing?.albumIdentityKey }
    if (albums.isEmpty()) return@withContext null
    val seen = excluded.toHashSet()
    val unseen = albums.filter { it.identityKey !in seen }
    val reset = unseen.isEmpty()
    val pool = if (!reset) unseen else albums.filter { it.identityKey != excluded.lastOrNull() }.ifEmpty { albums }
    val related = if (artist.isBlank()) emptySet() else catalog.getArtistAlbumPage(
      revision, grouping, ArtistResolve.identityKey(artist), 0, Int.MAX_VALUE,
    ).map { it.identityKey }.toHashSet()
    val favorites = user.getFavorites().map { it.trackPath }.toHashSet()
    val enabled = user.getSetting(LISTENING_HISTORY_ENABLED_KEY) != "0"
    val generation = if (enabled) user.getListeningHistoryMeta()?.generation else null
    val history = if (generation == null) emptyMap() else user.getAmbientTrackHistory(generation, weekStart, now).associateBy { it.path }
    val albumHistory = mutableMapOf<String, AmbientAlbumHistory>()
    val favoriteCounts = mutableMapOf<String, Int>()
    (favorites + history.keys).chunked(400).forEach { paths ->
      catalog.getActiveTracks(paths).forEach { track ->
        val key = track.albumIdentityKey
        if (track.path in favorites) favoriteCounts[key] = (favoriteCounts[key] ?: 0) + 1
        history[track.path]?.let { fact ->
          val aggregate = albumHistory.getOrPut(key) { AmbientAlbumHistory() }
          aggregate.plays += fact.plays; aggregate.weekPlays += fact.weekPlays
          aggregate.firstPlayedAt = minOf(aggregate.firstPlayedAt, fact.firstPlayedAt)
          aggregate.lastPlayedAt = maxOf(aggregate.lastPlayedAt, fact.lastPlayedAt)
        }
      }
    }
    val day = 86_400_000L
    fun reason(album: AlbumSummaryEntity): String {
      val fact = albumHistory[album.identityKey]
      return when {
        album.identityKey in related -> "related"
        (favoriteCounts[album.identityKey] ?: 0) > 0 -> "favorite"
        fact != null && fact.plays >= 5 && now - fact.lastPlayedAt >= 60 * day -> "forgotten"
        album.latestAddedAt > now - 14 * day -> "added"
        fact != null && fact.weekPlays >= 3 -> "repeat"
        else -> "collection"
      }
    }
    val order = listOf("related", "favorite", "forgotten", "added", "repeat", "collection")
    // Shuffle within a reason, with no repeat until the collection is exhausted.
    val album = pool.shuffled().minBy { order.indexOf(reason(it)) }
    val fact = albumHistory[album.identityKey]
    mapOf(
      "album" to album.toBridgeMap(), "reason" to reason(album), "relatedArtist" to artist,
      "favoriteTracks" to (favoriteCounts[album.identityKey] ?: 0),
      "historyEnabled" to enabled, "plays" to (fact?.plays ?: 0).toDouble(),
      "weekPlays" to (fact?.weekPlays ?: 0).toDouble(),
      "firstPlayedAt" to fact?.firstPlayedAt?.toDouble(), "lastPlayedAt" to fact?.lastPlayedAt?.toDouble(),
      "reset" to reset,
    )
  }
}
