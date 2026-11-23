package expo.modules.astralibraryscanner.data

import androidx.room.withTransaction

data class RecentPlayRecord(
  val id: String,
  val path: String,
  val playedAt: Long,
  val title: String?,
  val artist: String?,
)

/** Only the fields a timeline row displays. Full track details are fetched when the menu opens. */
data class RecentTrackSummary(
  val path: String, val title: String, val artist: String,
  val artworkHash: String?, val artworkSourceId: String?, val sourceType: String, val sourceId: Long?,
  val codec: String?, val codecProfile: String?, val isAtmosJoc: Int?,
) {
  fun toBridgeMap(): Map<String, Any?> = mapOf(
    "path" to path, "title" to title, "artist" to artist, "artwork_hash" to artworkHash,
    "artwork_source_id" to artworkSourceId, "source_type" to sourceType, "source_id" to sourceId?.toDouble(),
    "codec" to codec, "codec_profile" to codecProfile, "is_atmos_joc" to isAtmosJoc,
  )
}

internal object RecentTimeline {
  suspend fun page(
    database: AstraUserDatabase,
    catalog: CatalogDao,
    cursor: Map<String, Any?>?,
    requestedLimit: Int,
    now: Long = System.currentTimeMillis(),
  ): Map<String, Any?> {
    val dao = database.userDao()
    val limit = requestedLimit.coerceIn(1, 50)
    val since = recentListeningWindowStart(now)
    val upperExclusive = now + 1
    val entries = mutableListOf<Pair<String, RecentPlayRecord>>()
    var next: Map<String, Any?>? = null
    val generation = database.withTransaction {
      val generation = dao.getListeningHistoryMeta()?.generation.orEmpty()
      // Clearing history invalidates both halves of a cursor, including summary-only pages.
      val current = cursor?.takeIf { it["generation"] == generation }
      fun collect(kind: String, records: List<RecentPlayRecord>, remaining: Int) {
        entries += records.take(remaining).map { kind to it }
        if (records.size > remaining) {
          val last = records.getOrNull(remaining - 1)
          next = mapOf("kind" to kind, "generation" to generation,
            "before" to last?.playedAt?.toDouble(), "id" to last?.id)
        }
      }
      val anchor = (current?.get("before") as? Number)?.toLong()?.takeIf { it <= now }
      val before = anchor ?: upperExclusive
      val id = if (anchor == null) "" else current?.get("id") as? String ?: ""
      val inSummary = current?.get("kind") == "summary"
      if (!inSummary) {
        collect("session", dao.getRecentSessions(generation, since, before, id, limit + 1), limit)
      }
      if (next == null) {
        val remaining = limit - entries.size
        collect("summary", dao.getLastKnownPlays(generation, since,
          if (inSummary) before else upperExclusive, if (inSummary) id else "", remaining + 1), remaining)
      }
      generation
    }
    val tracks = catalog.getRecentTrackSummaries(entries.map { it.second.path }.distinct())
      .associate { it.path to it.toBridgeMap() }
    return mapOf(
      "generation" to generation, "nextCursor" to next,
      "items" to entries.map { (kind, play) ->
        mapOf("kind" to kind, "id" to play.id, "path" to play.path, "playedAt" to play.playedAt.toDouble(),
          "title" to play.title, "artist" to play.artist, "track" to tracks[play.path])
      },
    )
  }

  suspend fun replayPaths(dao: UserDao, context: Map<String, Any?>, now: Long = System.currentTimeMillis()): List<String> {
    val generation = context["generation"] as String
    val from = (context["playedAt"] as Number).toLong()
    val end = minOf((context["dayEnd"] as Number).toLong(), now + 1)
    val id = context["id"] as String
    require(from in recentListeningWindowStart(now)..now) { "This play is outside the last 30 days." }
    require(dao.getListeningHistoryMeta()?.generation.orEmpty() == generation) { "Listening history has changed." }
    val plays = if (context["entryKind"] == "summary") {
      dao.getLastKnownPlaysForReplay(generation, from, end, id)
    } else {
      dao.getRecentSessionsForReplay(generation, from, end, id)
    }
    require(plays.firstOrNull()?.let { it.id == id && it.playedAt == from } == true) {
      "This play is no longer in your history."
    }
    // Fold before filtering unavailable songs so two separate listens keep their place.
    return plays.filterIndexed { index, play -> index == 0 || play.path != plays[index - 1].path }
      .map { it.path }
  }
}
