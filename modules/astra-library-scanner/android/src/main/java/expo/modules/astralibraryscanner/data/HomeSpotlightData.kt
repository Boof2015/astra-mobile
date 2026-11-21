package expo.modules.astralibraryscanner.data

import androidx.room.withTransaction
import androidx.sqlite.db.SimpleSQLiteQuery
import kotlin.random.Random
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

internal const val HOME_SPOTLIGHT_HISTORY_LIMIT = 20

internal data class HomeSpotlightIdentity(val kind: String, val key: String, val groupingMode: String? = null) {
  fun toBridgeMap(): Map<String, Any?> = mapOf("kind" to kind, "key" to key, "groupingMode" to groupingMode)

  companion object {
    fun parse(value: Any?): HomeSpotlightIdentity? {
      val fields = value as? Map<*, *> ?: return null
      val key = (fields["key"] as? String)?.takeIf { it.isNotBlank() } ?: return null
      return when (fields["kind"]) {
        "album" -> HomeSpotlightIdentity("album", key)
        "artist" -> (fields["groupingMode"] as? String)?.takeIf { it == "astra" || it == "fileTags" }
          ?.let { HomeSpotlightIdentity("artist", key, it) }
        else -> null
      }
    }
  }
}

// A projection, not a list of summary rows. Even history validation returns <= 20 keys.
data class HomeSpotlightKey(val key: String)

internal data class HomeSpotlightSelection(
  val identity: HomeSpotlightIdentity,
  val revision: Long,
  val album: AlbumSummaryEntity? = null,
  val artist: ArtistSummaryEntity? = null,
)

/** Use the existing summary indexes for ordering; never sort the catalog randomly.
 * The offset walks an index, but only one identity and one summary are materialized. */
internal class HomeSpotlightQuery(
  kind: String, revision: Long, includeSingles: Boolean, grouping: String, includeCollaborations: Boolean,
) {
  private val album = kind == "album"
  private val key = if (album) "identity_key" else "artist_key"
  private val args = mutableListOf<Any>(revision)
  private val from: String

  init {
    val predicates = mutableListOf("revision = ?")
    if (album) {
      if (!includeSingles) predicates += "is_single = 0"
    } else {
      predicates += "grouping_mode = ?"
      args += grouping
      if (!includeCollaborations) predicates += "is_collaboration = 0"
      // Matches Home's existing resolved-primary-artist filter.
      if (grouping == "astra" && !includeCollaborations) predicates += "primary_track_count > 0"
    }
    from = "FROM ${if (album) "album_summaries" else "artist_summaries"} WHERE ${predicates.joinToString(" AND ")}"
  }

  fun count() = SimpleSQLiteQuery("SELECT COUNT(*) $from", args.toTypedArray())

  fun matching(keys: List<String>) = SimpleSQLiteQuery(
    "SELECT $key AS `key` $from AND $key IN (${keys.joinToString(",") { "?" }})",
    (args + keys).toTypedArray(),
  )

  fun pick(excluded: List<String>, offset: Long): SimpleSQLiteQuery {
    val exclusion = if (excluded.isEmpty()) "" else " AND $key NOT IN (${excluded.joinToString(",") { "?" }})"
    return SimpleSQLiteQuery(
      "SELECT $key AS `key` $from$exclusion ORDER BY name_sort_key, $key LIMIT 1 OFFSET ?",
      (args + excluded + offset).toTypedArray(),
    )
  }
}

/** One small cache, invalidated by DB identity, catalog revision, or browse preferences. */
internal class HomeSpotlightData {
  private data class CountKey(
    val database: AstraCatalogDatabase, val revision: Long, val singles: Boolean, val grouping: String, val collaborations: Boolean,
  )
  private var countKey: CountKey? = null
  private var counts = 0L to 0L
  private val mutex = Mutex()

  suspend fun select(
    database: AstraCatalogDatabase,
    includeSingles: Boolean,
    grouping: String,
    includeCollaborations: Boolean,
    recent: List<HomeSpotlightIdentity>,
    retain: HomeSpotlightIdentity? = null,
    random: Random = Random.Default,
  ): HomeSpotlightSelection? = mutex.withLock {
    // Counts and offsets must see the same published revision, even during a scan.
    database.withTransaction {
      val dao = database.catalogDao()
      val revision = dao.getRevision()
      val albumQuery = HomeSpotlightQuery("album", revision, includeSingles, grouping, includeCollaborations)
      val artistQuery = HomeSpotlightQuery("artist", revision, includeSingles, grouping, includeCollaborations)

      suspend fun hydrate(identity: HomeSpotlightIdentity): HomeSpotlightSelection? =
        if (identity.kind == "album") {
          dao.getAlbumSummary(revision, identity.key)?.let { HomeSpotlightSelection(identity, revision, album = it) }
        } else {
          dao.getArtistSummary(revision, grouping, identity.key)?.let { HomeSpotlightSelection(identity, revision, artist = it) }
        }

      if (retain != null && (retain.kind == "album" || retain.groupingMode == grouping)) {
        val query = if (retain.kind == "album") albumQuery else artistQuery
        if (dao.getHomeSpotlightKeys(query.matching(listOf(retain.key))).isNotEmpty()) {
          return@withTransaction hydrate(retain)
        }
      }

      val nextCountKey = CountKey(database, revision, includeSingles, grouping, includeCollaborations)
      if (countKey != nextCountKey) {
        counts = dao.runDynamicCountQuery(albumQuery.count()) to dao.runDynamicCountQuery(artistQuery.count())
        countKey = nextCountKey
      }
      // Preserve the most recent occurrence of each identity, oldest first.
      val history = recent.asReversed().distinct().take(HOME_SPOTLIGHT_HISTORY_LIMIT).asReversed()
      val albumKeys = history.filter { it.kind == "album" }.map { it.key }
      val artistKeys = history.filter { it.kind == "artist" && it.groupingMode == grouping }.map { it.key }
      val seenAlbums = if (albumKeys.isEmpty()) emptyList() else dao.getHomeSpotlightKeys(albumQuery.matching(albumKeys)).map { it.key }
      val seenArtists = if (artistKeys.isEmpty()) emptyList() else dao.getHomeSpotlightKeys(artistQuery.matching(artistKeys)).map { it.key }
      val freshAlbums = counts.first - seenAlbums.size
      val freshArtists = counts.second - seenArtists.size
      val identity = when {
        freshAlbums > 0 || freshArtists > 0 -> {
          val album = freshAlbums > 0 && (freshArtists == 0L || random.nextBoolean())
          val query = if (album) albumQuery else artistQuery
          val excluded = if (album) seenAlbums else seenArtists
          val size = if (album) freshAlbums else freshArtists
          val key = dao.getHomeSpotlightKeys(query.pick(excluded, random.nextLong(size))).firstOrNull()?.key
            ?: return@withTransaction null
          HomeSpotlightIdentity(if (album) "album" else "artist", key, if (album) null else grouping)
        }
        else -> history.firstOrNull {
          if (it.kind == "album") it.key in seenAlbums else it.groupingMode == grouping && it.key in seenArtists
        } ?: return@withTransaction null
      }
      hydrate(identity)
    }
  }
}
