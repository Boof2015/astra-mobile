package expo.modules.astralibraryscanner.data

import androidx.room.withTransaction
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.UUID
import kotlin.math.max
import kotlin.math.min

internal const val LISTENING_HISTORY_ENABLED_KEY = "listening_history_enabled"
private const val LISTENING_QUALIFICATION_SECONDS = 15.0
private const val SHORT_TRACK_COMPLETION_TOLERANCE_SECONDS = 0.5
private const val SHORT_TRACK_COMPLETION_TOLERANCE_RATIO = 0.1
private const val TOP_LIMIT = 10
private const val CATALOG_BATCH_SIZE = 400
/** Up to ~2 months of history, the "all" range still buckets by day. */
private const val ALL_RANGE_DAY_SPAN_MS = 60L * 24 * 60 * 60 * 1000
/** Up to ~2 years, by week; beyond that, by month. */
private const val ALL_RANGE_WEEK_SPAN_MS = 730L * 24 * 60 * 60 * 1000

private data class ListeningCheckpointResult(
  val accepted: Boolean,
  val qualifiedNow: Boolean,
  val history: PlaybackHistoryEntity? = null,
)

private data class ActivityBucket(
  val startAt: Long,
  val endAt: Long,
  val label: String,
  var listenedSeconds: Double = 0.0,
  var qualifiedPlays: Long = 0,
)

private data class ListeningIdentity(
  val trackKey: String,
  val trackPath: String?,
  val title: String,
  val artist: String,
  val artistNamesJson: String?,
  val album: String,
  val albumArtist: String?,
  val albumArtistNamesJson: String?,
  val albumKey: String,
  val artworkHash: String?,
  val sourceType: String,
  val sourceId: Long?,
  val artworkSourceId: String?,
  val available: Boolean,
)

private data class TrackAggregate(
  val key: String,
  var trackPath: String?,
  var title: String,
  var artist: String,
  var album: String,
  var artworkHash: String?,
  var sourceType: String,
  var sourceId: Long?,
  var artworkSourceId: String?,
  var available: Boolean,
  var listenedSeconds: Double = 0.0,
  var qualifiedPlays: Long = 0,
)

private data class ArtistAggregate(
  val key: String,
  var artist: String,
  var artworkHash: String?,
  var sourceType: String,
  var sourceId: Long?,
  var artworkSourceId: String?,
  var available: Boolean,
  var listenedSeconds: Double = 0.0,
  var qualifiedPlays: Long = 0,
)

private data class AlbumAggregate(
  val key: String,
  var album: String,
  var artist: String,
  var artworkHash: String?,
  var sourceType: String,
  var sourceId: Long?,
  var artworkSourceId: String?,
  var available: Boolean,
  var listenedSeconds: Double = 0.0,
  var qualifiedPlays: Long = 0,
)

internal object ListeningStatsEngine {
  suspend fun status(database: AstraUserDatabase): Map<String, Any?> {
    val dao = database.userDao()
    val meta = ensureMeta(dao)
    return statusMap(meta, listeningEnabled(dao))
  }

  suspend fun checkpoint(
    database: AstraUserDatabase,
    catalogDao: CatalogDao,
    payload: Map<String, Any?>,
  ): Map<String, Any?> {
    val dao = database.userDao()
    val meta = ensureMeta(dao)
    if (!listeningEnabled(dao)) {
      return checkpointMap(false, false, meta, false)
    }

    val generation = payload.string("generation")
    val sessionKey = payload.string("sessionKey")
    val segmentKey = payload.string("segmentKey")
    val trackPath = payload.string("trackPath")
    if (
      generation.isEmpty() ||
      generation != meta.generation ||
      sessionKey.isEmpty() ||
      (segmentKey.isEmpty() && !payload.boolean("finalizeSession")) ||
      trackPath.isEmpty()
    ) {
      return checkpointMap(false, false, meta, true)
    }

    val track = catalogDao.getActiveTrack(trackPath)
      ?: return checkpointMap(false, false, meta, true)
    val observedAt = payload.long("observedAt", System.currentTimeMillis()).coerceAtLeast(0)
    val sessionStartedAt = payload.long("sessionStartedAt", observedAt).coerceIn(0, observedAt)
    val segmentStartedAt = payload.long("segmentStartedAt", observedAt).coerceIn(0, observedAt)
    val sessionListenedSeconds = payload.double("sessionListenedSeconds").finiteNonNegative()
    val segmentListenedSeconds = min(
      sessionListenedSeconds,
      payload.double("segmentListenedSeconds").finiteNonNegative(),
    )
    val durationSeconds = max(
      track.duration.finiteNonNegative(),
      payload.double("trackDurationSeconds").finiteNonNegative(),
    )
    val finalizeSegment = payload.boolean("finalizeSegment")
    val finalizeSession = payload.boolean("finalizeSession")
    val completedNaturally = payload.boolean("completedNaturally")
    val qualificationEligible = payload["qualificationEligible"] != false

    val result = database.withTransaction {
      val currentMeta = ensureMeta(dao)
      if (currentMeta.generation != generation || !listeningEnabled(dao)) {
        return@withTransaction ListeningCheckpointResult(false, false)
      }

      if (sessionListenedSeconds > 0 && currentMeta.startedAt == null) {
        dao.putListeningHistoryMeta(currentMeta.copy(startedAt = segmentStartedAt))
      }

      val existingSession = dao.getListeningSession(sessionKey)
      val session = if (existingSession == null) {
        ListeningSessionEntity(
          sessionKey = sessionKey,
          generation = generation,
          trackPath = track.path,
          title = track.title,
          artist = track.artist,
          artistNamesJson = track.artistNamesJson,
          album = track.album,
          albumArtist = track.albumArtist,
          albumArtistNamesJson = track.albumArtistNamesJson,
          albumIdentityKey = track.albumIdentityKey,
          artworkHash = track.artworkHash,
          sourceType = track.sourceType,
          sourceId = track.sourceId,
          artworkSourceId = track.artworkSourceId,
          durationSeconds = durationSeconds,
          startedAt = sessionStartedAt,
          endedAt = observedAt.takeIf { finalizeSession },
          listenedSeconds = sessionListenedSeconds,
        )
      } else {
        existingSession.copy(
          durationSeconds = max(existingSession.durationSeconds, durationSeconds),
          endedAt = maxNullable(existingSession.endedAt, observedAt.takeIf { finalizeSession }),
          listenedSeconds = max(existingSession.listenedSeconds, sessionListenedSeconds),
        )
      }
      dao.putListeningSession(session)

      if (segmentKey.isNotEmpty()) {
        val existingSegment = dao.getListeningSegment(sessionKey, segmentKey)
        val segment = if (existingSegment == null) {
          ListeningSegmentEntity(
            sessionKey = sessionKey,
            segmentKey = segmentKey,
            generation = generation,
            startedAt = segmentStartedAt,
            lastObservedAt = observedAt,
            endedAt = observedAt.takeIf { finalizeSegment || finalizeSession },
            listenedSeconds = segmentListenedSeconds,
          )
        } else {
          existingSegment.copy(
            lastObservedAt = max(existingSegment.lastObservedAt, observedAt),
            endedAt = maxNullable(
              existingSegment.endedAt,
              observedAt.takeIf { finalizeSegment || finalizeSession },
            ),
            listenedSeconds = max(existingSegment.listenedSeconds, segmentListenedSeconds),
          )
        }
        dao.putListeningSegment(segment)
      }

      val persisted = dao.getListeningSession(sessionKey) ?: session
      val qualifies = qualificationEligible &&
        persisted.qualifiedAt == null &&
        sessionQualifies(
          listenedSeconds = persisted.listenedSeconds,
          durationSeconds = persisted.durationSeconds,
          finalizeSession = finalizeSession,
          completedNaturally = completedNaturally,
        )
      if (!qualifies || dao.qualifyListeningSession(sessionKey, generation, observedAt) == 0) {
        return@withTransaction ListeningCheckpointResult(true, false)
      }

      val previousHistory = dao.getPlaybackHistory(track.path)
      val history = PlaybackHistoryEntity(
        trackPath = track.path,
        lastPlayedAt = observedAt,
        playCount = (previousHistory?.playCount ?: 0) + 1,
      )
      dao.putPlaybackHistory(history)
      ListeningCheckpointResult(true, true, history)
    }

    result.history?.let { history ->
      runCatching {
        catalogDao.putTrackUserFacts(
          listOf(
            TrackUserFactEntity(
              path = track.path,
              isFavorite = dao.isFavorite(track.path),
              playCount = history.playCount,
              lastPlayedAt = history.lastPlayedAt,
            ),
          ),
        )
      }
    }
    return checkpointMap(
      result.accepted,
      result.qualifiedNow,
      ensureMeta(dao),
      listeningEnabled(dao),
    )
  }

  suspend fun clear(database: AstraUserDatabase): Map<String, Any?> {
    val dao = database.userDao()
    val meta = database.withTransaction {
      dao.clearListeningSegments()
      dao.clearListeningSessions()
      dao.clearListeningHistoryMeta()
      ListeningHistoryMetaEntity(generation = UUID.randomUUID().toString()).also {
        dao.putListeningHistoryMeta(it)
      }
    }
    return statusMap(meta, listeningEnabled(dao))
  }

  suspend fun dashboard(
    database: AstraUserDatabase,
    catalogDao: CatalogDao,
    query: Map<String, Any?>,
  ): Map<String, Any?> {
    val dao = database.userDao()
    val meta = ensureMeta(dao)
    val enabled = listeningEnabled(dao)
    val range = when (query.string("range")) {
      "7d", "1y", "all" -> query.string("range")
      else -> "30d"
    }
    val rankingMetric = if (query.string("rankingMetric") == "time") "time" else "plays"
    val groupingMode = if (query.string("artistGroupingMode") == "fileTags") "fileTags" else "astra"
    val now = query.long("now", System.currentTimeMillis()).coerceAtLeast(0)
    val rangeStartAt = rangeStart(range, now, meta.startedAt)
    val (granularity, buckets) = buildBuckets(range, rangeStartAt, now)
    if (rangeStartAt == null) {
      return emptyDashboard(meta, enabled, range, rankingMetric, now, granularity, buckets)
    }

    val sessions = dao.getListeningSessionsInRange(meta.generation, rangeStartAt, now)
    if (sessions.isEmpty()) {
      return emptyDashboard(meta, enabled, range, rankingMetric, now, granularity, buckets)
    }
    val segments = dao.getListeningSegmentsInRange(meta.generation, rangeStartAt, now)
    val activeTracks = sessions
      .map(ListeningSessionEntity::trackPath)
      .distinct()
      .chunked(CATALOG_BATCH_SIZE)
      .flatMap { paths -> catalogDao.getActiveTracks(paths) }
      .associateBy(ActiveTrackView::path)
    val sessionsByKey = sessions.associateBy(ListeningSessionEntity::sessionKey)

    val trackAggregates = linkedMapOf<String, TrackAggregate>()
    val artistAggregates = linkedMapOf<String, ArtistAggregate>()
    val albumAggregates = linkedMapOf<String, AlbumAggregate>()
    val tracksPlayed = linkedSetOf<String>()
    val activeDays = linkedSetOf<Long>()
    var listenedSeconds = 0.0
    var qualifiedPlays = 0L

    fun ensureAggregates(identity: ListeningIdentity): Triple<TrackAggregate, List<ArtistAggregate>, AlbumAggregate> {
      val track = trackAggregates.getOrPut(identity.trackKey) {
        TrackAggregate(
          key = identity.trackKey,
          trackPath = identity.trackPath,
          title = identity.title,
          artist = identity.artist,
          album = identity.album,
          artworkHash = identity.artworkHash,
          sourceType = identity.sourceType,
          sourceId = identity.sourceId,
          artworkSourceId = identity.artworkSourceId,
          available = identity.available,
        )
      }.also {
        it.available = it.available || identity.available
        if (identity.available) {
          it.trackPath = identity.trackPath
          it.artworkHash = identity.artworkHash ?: it.artworkHash
          it.sourceType = identity.sourceType
          it.sourceId = identity.sourceId
          it.artworkSourceId = identity.artworkSourceId
        }
      }
      val artists = browseArtists(identity, groupingMode).map { display ->
        val key = normalizeKey(display).ifEmpty { display }
        artistAggregates.getOrPut(key) {
          ArtistAggregate(
            key = key,
            artist = display,
            artworkHash = identity.artworkHash,
            sourceType = identity.sourceType,
            sourceId = identity.sourceId,
            artworkSourceId = identity.artworkSourceId,
            available = identity.available,
          )
        }.also {
          it.available = it.available || identity.available
          it.artworkHash = it.artworkHash ?: identity.artworkHash
          it.sourceId = it.sourceId ?: identity.sourceId
          it.artworkSourceId = it.artworkSourceId ?: identity.artworkSourceId
        }
      }
      val album = albumAggregates.getOrPut(identity.albumKey) {
        AlbumAggregate(
          key = identity.albumKey,
          album = identity.album,
          artist = identity.albumArtist?.takeIf(String::isNotBlank) ?: identity.artist,
          artworkHash = identity.artworkHash,
          sourceType = identity.sourceType,
          sourceId = identity.sourceId,
          artworkSourceId = identity.artworkSourceId,
          available = identity.available,
        )
      }.also {
        it.available = it.available || identity.available
        it.artworkHash = it.artworkHash ?: identity.artworkHash
        it.sourceId = it.sourceId ?: identity.sourceId
        it.artworkSourceId = it.artworkSourceId ?: identity.artworkSourceId
      }
      return Triple(track, artists, album)
    }

    for (segment in segments) {
      val session = sessionsByKey[segment.sessionKey] ?: continue
      val overlap = overlapSeconds(segment, rangeStartAt, now + 1)
      if (overlap <= 0) continue
      val identity = identity(session, activeTracks[session.trackPath])
      val (track, artists, album) = ensureAggregates(identity)
      track.listenedSeconds += overlap
      artists.forEach { it.listenedSeconds += overlap }
      album.listenedSeconds += overlap
      tracksPlayed += identity.trackKey
      listenedSeconds += overlap
      buckets.forEach { bucket ->
        // The first bucket is snapped back to a calendar boundary, so it can start
        // before rangeStartAt; clamp it or the bars would total more than the
        // summary's listening time.
        bucket.listenedSeconds += overlapSeconds(
          segment,
          max(bucket.startAt, rangeStartAt),
          min(bucket.endAt, now + 1),
        )
      }
      var day = startOfDay(max(segment.startedAt, rangeStartAt))
      val dayEnd = min(segment.lastObservedAt, now)
      while (day <= dayEnd) {
        val nextDay = addDays(day, 1)
        if (overlapSeconds(segment, day, nextDay) > 0) activeDays += day
        day = nextDay
      }
    }

    for (session in sessions) {
      val qualifiedAt = session.qualifiedAt ?: continue
      if (qualifiedAt < rangeStartAt || qualifiedAt > now) continue
      val identity = identity(session, activeTracks[session.trackPath])
      val (track, artists, album) = ensureAggregates(identity)
      track.qualifiedPlays += 1
      artists.forEach { it.qualifiedPlays += 1 }
      album.qualifiedPlays += 1
      qualifiedPlays += 1
      buckets.firstOrNull { qualifiedAt >= it.startAt && qualifiedAt < it.endAt }
        ?.let { it.qualifiedPlays += 1 }
    }

    val trackComparator = aggregateComparator<TrackAggregate>(
      rankingMetric,
      { it.qualifiedPlays },
      { it.listenedSeconds },
      { "${it.title}\u0000${it.artist}" },
    )
    val artistComparator = aggregateComparator<ArtistAggregate>(
      rankingMetric,
      { it.qualifiedPlays },
      { it.listenedSeconds },
      { it.artist },
    )
    val albumComparator = aggregateComparator<AlbumAggregate>(
      rankingMetric,
      { it.qualifiedPlays },
      { it.listenedSeconds },
      { "${it.album}\u0000${it.artist}" },
    )

    return dashboardMap(
      meta = meta,
      enabled = enabled,
      range = range,
      rankingMetric = rankingMetric,
      rangeStartAt = rangeStartAt,
      rangeEndAt = now,
      granularity = granularity,
      summary = mapOf(
        "listenedSeconds" to listenedSeconds,
        "qualifiedPlays" to qualifiedPlays.toDouble(),
        "tracksPlayed" to tracksPlayed.size.toDouble(),
        "activeDays" to activeDays.size.toDouble(),
      ),
      buckets = buckets,
      tracks = trackAggregates.values.sortedWith(trackComparator).take(TOP_LIMIT),
      artists = artistAggregates.values.sortedWith(artistComparator).take(TOP_LIMIT),
      albums = albumAggregates.values.sortedWith(albumComparator).take(TOP_LIMIT),
    )
  }

  private suspend fun ensureMeta(dao: UserDao): ListeningHistoryMetaEntity {
    val existing = dao.getListeningHistoryMeta()
    if (existing != null) return existing
    val created = ListeningHistoryMetaEntity(generation = UUID.randomUUID().toString())
    dao.putListeningHistoryMeta(created)
    return dao.getListeningHistoryMeta() ?: created
  }

  private suspend fun listeningEnabled(dao: UserDao): Boolean =
    dao.getSetting(LISTENING_HISTORY_ENABLED_KEY) != "0"
}

private fun sessionQualifies(
  listenedSeconds: Double,
  durationSeconds: Double,
  finalizeSession: Boolean,
  completedNaturally: Boolean,
): Boolean {
  if (durationSeconds > 0 && durationSeconds < LISTENING_QUALIFICATION_SECONDS) {
    if (!finalizeSession || !completedNaturally) return false
    val tolerance = min(
      SHORT_TRACK_COMPLETION_TOLERANCE_SECONDS,
      durationSeconds * SHORT_TRACK_COMPLETION_TOLERANCE_RATIO,
    )
    return listenedSeconds >= durationSeconds - tolerance
  }
  return listenedSeconds >= LISTENING_QUALIFICATION_SECONDS
}

private fun statusMap(meta: ListeningHistoryMetaEntity, enabled: Boolean): Map<String, Any?> =
  mapOf(
    "generation" to meta.generation,
    "startedAt" to meta.startedAt?.toDouble(),
    "enabled" to enabled,
  )

private fun checkpointMap(
  accepted: Boolean,
  qualifiedNow: Boolean,
  meta: ListeningHistoryMetaEntity,
  enabled: Boolean,
): Map<String, Any?> =
  mapOf(
    "accepted" to accepted,
    "qualifiedNow" to qualifiedNow,
    "status" to statusMap(meta, enabled),
  )

private fun emptyDashboard(
  meta: ListeningHistoryMetaEntity,
  enabled: Boolean,
  range: String,
  rankingMetric: String,
  rangeEndAt: Long,
  granularity: String,
  buckets: List<ActivityBucket>,
): Map<String, Any?> =
  dashboardMap(
    meta = meta,
    enabled = enabled,
    range = range,
    rankingMetric = rankingMetric,
    rangeStartAt = rangeStart(range, rangeEndAt, meta.startedAt),
    rangeEndAt = rangeEndAt,
    granularity = granularity,
    summary = mapOf(
      "listenedSeconds" to 0.0,
      "qualifiedPlays" to 0.0,
      "tracksPlayed" to 0.0,
      "activeDays" to 0.0,
    ),
    buckets = buckets,
    tracks = emptyList(),
    artists = emptyList(),
    albums = emptyList(),
  )

private fun dashboardMap(
  meta: ListeningHistoryMetaEntity,
  enabled: Boolean,
  range: String,
  rankingMetric: String,
  rangeStartAt: Long?,
  rangeEndAt: Long,
  granularity: String,
  summary: Map<String, Any?>,
  buckets: List<ActivityBucket>,
  tracks: List<TrackAggregate>,
  artists: List<ArtistAggregate>,
  albums: List<AlbumAggregate>,
): Map<String, Any?> =
  mapOf(
    "status" to statusMap(meta, enabled),
    "range" to range,
    "rankingMetric" to rankingMetric,
    "rangeStartAt" to rangeStartAt?.toDouble(),
    "rangeEndAt" to rangeEndAt.toDouble(),
    "granularity" to granularity,
    "summary" to summary,
    "activity" to buckets.map { bucket ->
      mapOf(
        "startAt" to bucket.startAt.toDouble(),
        "endAt" to bucket.endAt.toDouble(),
        "label" to bucket.label,
        "listenedSeconds" to bucket.listenedSeconds,
        "qualifiedPlays" to bucket.qualifiedPlays.toDouble(),
      )
    },
    "topTracks" to tracks.map { aggregate ->
      mapOf(
        "key" to aggregate.key,
        "trackPath" to aggregate.trackPath,
        "title" to aggregate.title,
        "artist" to aggregate.artist,
        "album" to aggregate.album,
        "artworkHash" to aggregate.artworkHash,
        "sourceType" to aggregate.sourceType,
        "sourceId" to aggregate.sourceId?.toDouble(),
        "artworkSourceId" to aggregate.artworkSourceId,
        "listenedSeconds" to aggregate.listenedSeconds,
        "qualifiedPlays" to aggregate.qualifiedPlays.toDouble(),
        "available" to aggregate.available,
      )
    },
    "topArtists" to artists.map { aggregate ->
      mapOf(
        "key" to aggregate.key,
        "artist" to aggregate.artist,
        "artworkHash" to aggregate.artworkHash,
        "sourceType" to aggregate.sourceType,
        "sourceId" to aggregate.sourceId?.toDouble(),
        "artworkSourceId" to aggregate.artworkSourceId,
        "listenedSeconds" to aggregate.listenedSeconds,
        "qualifiedPlays" to aggregate.qualifiedPlays.toDouble(),
        "available" to aggregate.available,
      )
    },
    "topAlbums" to albums.map { aggregate ->
      mapOf(
        "key" to aggregate.key,
        "album" to aggregate.album,
        "artist" to aggregate.artist,
        "artworkHash" to aggregate.artworkHash,
        "sourceType" to aggregate.sourceType,
        "sourceId" to aggregate.sourceId?.toDouble(),
        "artworkSourceId" to aggregate.artworkSourceId,
        "listenedSeconds" to aggregate.listenedSeconds,
        "qualifiedPlays" to aggregate.qualifiedPlays.toDouble(),
        "available" to aggregate.available,
      )
    },
  )

private fun identity(
  session: ListeningSessionEntity,
  current: ActiveTrackView?,
): ListeningIdentity {
  val available = current != null
  return ListeningIdentity(
    trackKey = "track:${session.trackPath}",
    trackPath = current?.path,
    title = current?.title?.trim()?.takeIf { it.isNotEmpty() } ?: session.title,
    artist = current?.artist?.trim()?.takeIf { it.isNotEmpty() } ?: session.artist,
    artistNamesJson = current?.artistNamesJson ?: session.artistNamesJson,
    album = current?.album?.trim()?.takeIf { it.isNotEmpty() } ?: session.album,
    albumArtist = current?.albumArtist?.trim()?.takeIf { it.isNotEmpty() } ?: session.albumArtist,
    albumArtistNamesJson = current?.albumArtistNamesJson ?: session.albumArtistNamesJson,
    albumKey = current?.albumIdentityKey ?: session.albumIdentityKey,
    artworkHash = current?.artworkHash ?: session.artworkHash,
    sourceType = current?.sourceType ?: session.sourceType,
    sourceId = current?.sourceId ?: session.sourceId,
    artworkSourceId = current?.artworkSourceId ?: session.artworkSourceId,
    available = available,
  )
}

private fun browseArtists(identity: ListeningIdentity, groupingMode: String): List<String> {
  val strict = identity.albumArtist?.trim()?.takeIf { it.isNotEmpty() } ?: identity.artist
  if (groupingMode == "fileTags") return listOf(strict.ifBlank { "Unknown Artist" })
  val result = LinkedHashMap<String, String>()
  fun add(value: String) {
    val display = normalizeDisplay(value)
    val key = normalizeKey(display)
    if (key.isNotEmpty()) result.putIfAbsent(key, display)
  }
  val albumNames = deserializeArtistNames(identity.albumArtistNamesJson)
  val trackNames = deserializeArtistNames(identity.artistNamesJson)
  val primary = albumNames.firstOrNull()
    ?: splitArtists(identity.albumArtist.orEmpty(), splitAmpersand = false).firstOrNull()
    ?: trackNames.firstOrNull()
    ?: splitArtists(identity.artist, splitAmpersand = true).firstOrNull()
    ?: "Unknown Artist"
  add(primary)
  val artists = trackNames.ifEmpty { splitArtists(identity.artist, splitAmpersand = true) }
  artists.forEach(::add)
  if (artists.isEmpty()) {
    albumNames.ifEmpty { splitArtists(identity.albumArtist.orEmpty(), splitAmpersand = false) }
      .forEach(::add)
  }
  return result.values.toList().ifEmpty { listOf("Unknown Artist") }
}

private fun splitArtists(raw: String, splitAmpersand: Boolean): List<String> {
  var unified = normalizeDisplay(raw)
    .replace(Regex("\\s*;\\s*"), ",")
    .replace(Regex("\\s+[x×]\\s+", RegexOption.IGNORE_CASE), ",")
    .replace(Regex("\\s+(?:feat\\.?|ft\\.?|featuring|with)\\s+", RegexOption.IGNORE_CASE), ",")
  if (splitAmpersand) unified = unified.replace(Regex("\\s+&\\s+"), ",")
  val result = LinkedHashMap<String, String>()
  unified.split(',').forEach { part ->
    val display = normalizeDisplay(part)
    val key = normalizeKey(display)
    if (key.isNotEmpty()) result.putIfAbsent(key, display)
  }
  return result.values.toList()
}

private fun normalizeDisplay(value: String): String = value.replace(Regex("\\s+"), " ").trim()
private fun normalizeKey(value: String): String = normalizeDisplay(value).lowercase(Locale.ROOT)

private fun overlapSeconds(segment: ListeningSegmentEntity, startAt: Long, endAt: Long): Double {
  val segmentStart = segment.startedAt
  val segmentEnd = max(segmentStart, segment.lastObservedAt)
  val listened = segment.listenedSeconds.finiteNonNegative()
  if (listened <= 0 || segmentEnd <= startAt || segmentStart >= endAt) return 0.0
  val wallDuration = segmentEnd - segmentStart
  if (wallDuration <= 0) return if (segmentStart in startAt until endAt) listened else 0.0
  val overlap = max(0L, min(segmentEnd, endAt) - max(segmentStart, startAt))
  return listened * min(1.0, overlap.toDouble() / wallDuration.toDouble())
}

private fun rangeStart(range: String, now: Long, baseline: Long?): Long? {
  if (range == "all") return baseline
  val today = startOfDay(now)
  return when (range) {
    "7d" -> addDays(today, -6)
    "1y" -> addDays(today, -364)
    else -> addDays(today, -29)
  }
}

private fun buildBuckets(
  range: String,
  rangeStartAt: Long?,
  now: Long,
): Pair<String, List<ActivityBucket>> {
  // "all" spans however much history exists, so its granularity follows the span:
  // a fixed month bucket gave a user with two weeks of history a single lonely bar.
  val granularity = when {
    range == "7d" || range == "30d" -> "day"
    range == "1y" -> "week"
    rangeStartAt == null -> "month"
    now - rangeStartAt <= ALL_RANGE_DAY_SPAN_MS -> "day"
    now - rangeStartAt <= ALL_RANGE_WEEK_SPAN_MS -> "week"
    else -> "month"
  }
  if (rangeStartAt == null) return granularity to emptyList()
  val labelFormat = SimpleDateFormat(
    if (granularity == "month") "MMM yyyy" else "MMM d",
    Locale.getDefault(),
  )
  val buckets = mutableListOf<ActivityBucket>()
  var cursor = if (granularity == "month") startOfMonth(rangeStartAt) else startOfDay(rangeStartAt)
  while (cursor <= now) {
    val end = when (granularity) {
      "week" -> addDays(cursor, 7)
      "month" -> addMonths(cursor, 1)
      else -> addDays(cursor, 1)
    }
    buckets += ActivityBucket(cursor, end, labelFormat.format(Date(cursor)))
    cursor = end
  }
  return granularity to buckets
}

private fun startOfDay(timestamp: Long): Long =
  Calendar.getInstance().apply {
    timeInMillis = timestamp
    set(Calendar.HOUR_OF_DAY, 0)
    set(Calendar.MINUTE, 0)
    set(Calendar.SECOND, 0)
    set(Calendar.MILLISECOND, 0)
  }.timeInMillis

private fun startOfMonth(timestamp: Long): Long =
  Calendar.getInstance().apply {
    timeInMillis = timestamp
    set(Calendar.DAY_OF_MONTH, 1)
    set(Calendar.HOUR_OF_DAY, 0)
    set(Calendar.MINUTE, 0)
    set(Calendar.SECOND, 0)
    set(Calendar.MILLISECOND, 0)
  }.timeInMillis

private fun addDays(timestamp: Long, days: Int): Long =
  Calendar.getInstance().apply {
    timeInMillis = timestamp
    add(Calendar.DAY_OF_MONTH, days)
  }.timeInMillis

private fun addMonths(timestamp: Long, months: Int): Long =
  Calendar.getInstance().apply {
    timeInMillis = timestamp
    add(Calendar.MONTH, months)
  }.timeInMillis

private fun <T> aggregateComparator(
  metric: String,
  plays: (T) -> Long,
  seconds: (T) -> Double,
  label: (T) -> String,
): Comparator<T> = Comparator { left, right ->
  val primary = if (metric == "time") {
    seconds(right).compareTo(seconds(left))
  } else {
    plays(right).compareTo(plays(left))
  }
  if (primary != 0) return@Comparator primary
  val secondary = if (metric == "time") {
    plays(right).compareTo(plays(left))
  } else {
    seconds(right).compareTo(seconds(left))
  }
  if (secondary != 0) return@Comparator secondary
  label(left).compareTo(label(right), ignoreCase = true)
}

private fun maxNullable(left: Long?, right: Long?): Long? = when {
  left == null -> right
  right == null -> left
  else -> max(left, right)
}

private fun Double.finiteNonNegative(): Double =
  if (isFinite()) coerceAtLeast(0.0) else 0.0

private fun Map<String, Any?>.string(key: String): String = (this[key] as? String)?.trim().orEmpty()
private fun Map<String, Any?>.boolean(key: String): Boolean = this[key] == true
private fun Map<String, Any?>.double(key: String): Double = (this[key] as? Number)?.toDouble() ?: 0.0
private fun Map<String, Any?>.long(key: String, fallback: Long): Long =
  (this[key] as? Number)?.toDouble()?.takeIf(Double::isFinite)?.toLong() ?: fallback
