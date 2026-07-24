package expo.modules.astralibraryscanner.data

import android.net.Uri
import android.provider.DocumentsContract
import androidx.room.withTransaction
import java.util.Locale
import java.util.UUID

private val SYNC_WHITESPACE = Regex("\\s+")
private const val SYNC_SEPARATOR = "\u001f"

private fun normalizeSyncPart(value: String): String =
  value.replace(SYNC_WHITESPACE, " ").trim().lowercase(Locale.ROOT)

private fun syncKey(title: String, artist: String, album: String): String =
  listOf(title, artist, album).joinToString(SYNC_SEPARATOR, transform = ::normalizeSyncPart)

private fun decodedDocumentPath(raw: String): String? = runCatching {
  val uri = Uri.parse(raw)
  val id = DocumentsContract.getDocumentId(uri)
  Uri.decode(id.substringAfter(':', id)).replace('\\', '/')
}.getOrNull()

private fun normalizedForeignPath(raw: String): String {
  var value = raw.trim().replace('\\', '/')
  if (value.startsWith("file://", ignoreCase = true)) value = value.drop(7)
  return Uri.decode(value).lowercase(Locale.ROOT)
}

private data class MatchCandidate(
  val track: ActiveTrackView,
  val decodedPath: String?,
)

private class NativeTrackMatcher(tracks: List<ActiveTrackView>) {
  private val byFileName = HashMap<String, MutableList<MatchCandidate>>()
  private val byTitleArtistAlbum = HashMap<String, ActiveTrackView?>()
  private val byTitleArtist = HashMap<String, ActiveTrackView?>()
  private val byTitle = HashMap<String, ActiveTrackView?>()

  init {
    for (track in tracks) {
      val decoded = decodedDocumentPath(track.path)?.lowercase(Locale.ROOT)
      byFileName.getOrPut(track.fileName.lowercase(Locale.ROOT)) { mutableListOf() }
        .add(MatchCandidate(track, decoded))
      putUnique(
        byTitleArtistAlbum,
        listOf(track.title, track.artist, track.album)
          .joinToString("\n", transform = ::normalizeSyncPart),
        track,
      )
      putUnique(
        byTitleArtist,
        "${track.title.trim().lowercase(Locale.ROOT)}\n${track.artist.trim().lowercase(Locale.ROOT)}",
        track,
      )
      putUnique(byTitle, track.title.trim().lowercase(Locale.ROOT), track)
    }
  }

  private fun putUnique(
    map: MutableMap<String, ActiveTrackView?>,
    key: String,
    track: ActiveTrackView,
  ) {
    if (key.isBlank()) return
    if (map.containsKey(key)) map[key] = null else map[key] = track
  }

  fun match(
    title: String,
    artist: String,
    album: String,
    sourcePath: String? = null,
  ): ActiveTrackView? {
    if (!sourcePath.isNullOrBlank()) {
      val normalized = normalizedForeignPath(sourcePath)
      val segments = normalized.split('/')
      val candidates = byFileName[segments.lastOrNull().orEmpty()].orEmpty()
      if (candidates.size == 1) return candidates.first().track
      if (candidates.size > 1) {
        var best: ActiveTrackView? = null
        var bestScore = 0
        var tied = false
        for (candidate in candidates) {
          val score = suffixOverlap(segments, candidate.decodedPath)
          if (score > bestScore) {
            best = candidate.track
            bestScore = score
            tied = false
          } else if (score == bestScore) {
            tied = true
          }
        }
        if (best != null && !tied) return best
      }
    }

    val normalizedTitle = normalizeSyncPart(title)
    if (normalizedTitle.isBlank()) return null
    val normalizedArtist = normalizeSyncPart(artist)
    val normalizedAlbum = normalizeSyncPart(album)
    if (normalizedArtist.isNotBlank() && normalizedAlbum.isNotBlank()) {
      val key = "$normalizedTitle\n$normalizedArtist\n$normalizedAlbum"
      if (byTitleArtistAlbum.containsKey(key)) return byTitleArtistAlbum[key]
    }
    val simpleTitle = title.trim().lowercase(Locale.ROOT)
    val simpleArtist = artist.trim().lowercase(Locale.ROOT)
    if (simpleArtist.isNotBlank()) {
      val key = "$simpleTitle\n$simpleArtist"
      if (byTitleArtist.containsKey(key)) return byTitleArtist[key]
    }
    return if (byTitle.containsKey(simpleTitle)) byTitle[simpleTitle] else null
  }

  private fun suffixOverlap(entrySegments: List<String>, decodedPath: String?): Int {
    if (decodedPath == null) return 1
    val trackSegments = decodedPath.split('/')
    var overlap = 0
    while (
      overlap < entrySegments.size &&
      overlap < trackSegments.size &&
      entrySegments[entrySegments.lastIndex - overlap] ==
      trackSegments[trackSegments.lastIndex - overlap]
    ) {
      overlap += 1
    }
    return overlap
  }
}

private fun Any?.asLong(default: Long = 0): Long = when (this) {
  is Number -> toLong()
  is String -> toLongOrNull() ?: default
  else -> default
}

private fun Any?.asString(): String = this as? String ?: ""

private fun Map<String, Any?>.mapList(key: String): List<Map<String, Any?>> =
  (this[key] as? List<*>)?.mapNotNull { it as? Map<String, Any?> }.orEmpty()

private fun Map<String, Any?>.stringList(key: String): List<String> =
  (this[key] as? List<*>)?.mapNotNull { it as? String }.orEmpty()

private data class PlaylistApplyResult(
  val syncUid: String,
  val status: String,
  val entriesMatched: Int,
  val entriesFallback: Int,
) {
  fun toBridgeMap(): Map<String, Any?> = mapOf(
    "syncUid" to syncUid,
    "status" to status,
    "entriesMatched" to entriesMatched,
    "entriesFallback" to entriesFallback,
  )
}

internal object NativeDesktopSync {
  suspend fun getState(
    userDatabase: AstraUserDatabase,
    catalogDatabase: AstraCatalogDatabase,
  ): Map<String, Any?> {
    val userDao = userDatabase.userDao()
    val catalogDao = catalogDatabase.catalogDao()
    val matcher = NativeTrackMatcher(catalogDao.getAllActiveTracksForNativeMatching())

    var mutated = false
    userDatabase.withTransaction {
      for (playlist in userDao.getLocalPlaylists()) {
        if (playlist.syncUid != null) continue
        userDao.updatePlaylistSyncUid(
          playlist.id,
          UUID.randomUUID().toString().replace("-", ""),
        )
        mutated = true
      }
      for (pending in userDao.getPendingFavorites()) {
        val match = matcher.match(pending.title, pending.artist, pending.album) ?: continue
        userDao.putFavorite(FavoriteEntity(match.path, pending.addedAt))
        userDao.deletePendingFavorites(listOf(pending.syncKey))
        mutated = true
      }
    }

    val favorites = linkedMapOf<String, MutableMap<String, Any?>>()
    val favoriteRows = userDao.getFavorites()
    val favoriteTracks = favoriteRows.chunked(400).flatMap { chunk ->
      catalogDao.getActiveTracks(chunk.map(FavoriteEntity::trackPath))
    }.associateBy(ActiveTrackView::path)
    for (favorite in favoriteRows) {
      val track = favoriteTracks[favorite.trackPath] ?: continue
      val key = syncKey(track.title, track.artist, track.album)
      val existing = favorites[key]
      if (existing == null) {
        favorites[key] = mutableMapOf(
          "key" to key,
          "title" to track.title,
          "artist" to track.artist,
          "album" to track.album,
          "addedAt" to favorite.addedAt.toDouble(),
          "trackPaths" to mutableListOf(favorite.trackPath),
          "pending" to false,
        )
      } else {
        @Suppress("UNCHECKED_CAST")
        (existing["trackPaths"] as MutableList<String>).add(favorite.trackPath)
        if (favorite.addedAt > existing["addedAt"].asLong()) {
          existing["addedAt"] = favorite.addedAt.toDouble()
        }
      }
    }
    for (pending in userDao.getPendingFavorites()) {
      if (favorites.containsKey(pending.syncKey)) continue
      favorites[pending.syncKey] = mutableMapOf(
        "key" to pending.syncKey,
        "title" to pending.title,
        "artist" to pending.artist,
        "album" to pending.album,
        "addedAt" to pending.addedAt.toDouble(),
        "trackPaths" to emptyList<String>(),
        "pending" to true,
      )
    }

    val playlists = userDao.getLocalPlaylists().mapNotNull { playlist ->
      val uid = playlist.syncUid ?: return@mapNotNull null
      val entries = if (playlist.kind == "dynamic") {
        null
      } else {
        val rows = userDao.getPlaylistTracks(playlist.id)
        val tracks = rows.chunked(400).flatMap { chunk ->
          catalogDao.getActiveTracks(chunk.map(PlaylistTrackEntity::trackPath))
        }.associateBy(ActiveTrackView::path)
        rows.map { row ->
          val track = tracks[row.trackPath]
          mapOf(
            "title" to (track?.title ?: row.fallbackTitle.orEmpty()),
            "artist" to (track?.artist ?: row.fallbackArtist.orEmpty()),
            "album" to (track?.album ?: row.fallbackAlbum.orEmpty()),
            "durationSeconds" to track?.duration,
            "position" to row.position,
            "addedAt" to row.addedAt.toDouble(),
            "sourcePath" to if (track != null) {
              decodedDocumentPath(row.trackPath) ?: track.fileName
            } else {
              row.trackPath.takeIf(String::isNotBlank)
            },
          )
        }
      }
      mapOf(
        "id" to playlist.id.toDouble(),
        "syncUid" to uid,
        "name" to playlist.name,
        "kind" to playlist.kind,
        "dynamicRules" to playlist.dynamicRulesJson,
        "createdAt" to playlist.createdAt.toDouble(),
        "updatedAt" to playlist.updatedAt.toDouble(),
        "entries" to entries,
      )
    }

    return mapOf(
      "favorites" to favorites.values.toList(),
      "favoriteTombstones" to userDao.getFavoriteTombstones().map {
        mapOf("key" to it.syncKey, "deletedAt" to it.deletedAt.toDouble())
      },
      "playlists" to playlists,
      "playlistTombstones" to userDao.getPlaylistTombstones().map {
        mapOf("syncUid" to it.syncUid, "deletedAt" to it.deletedAt.toDouble())
      },
      "baselines" to userDao.getPlaylistSyncStates().map {
        mapOf(
          "syncUid" to it.syncUid,
          "localUpdatedAt" to it.localUpdatedAt.toDouble(),
          "remoteUpdatedAt" to it.remoteUpdatedAt.toDouble(),
        )
      },
      "mutated" to mutated,
    )
  }

  suspend fun applyPlan(
    userDatabase: AstraUserDatabase,
    catalogDatabase: AstraCatalogDatabase,
    plan: Map<String, Any?>,
  ): Map<String, Any?> {
    val userDao = userDatabase.userDao()
    val matcher = NativeTrackMatcher(
      catalogDatabase.catalogDao().getAllActiveTracksForNativeMatching(),
    )
    val playlistResults = mutableListOf<PlaylistApplyResult>()
    var favoritesAdded = 0
    var favoritesPending = 0
    var favoritesRemoved = 0

    userDatabase.withTransaction {
      @Suppress("UNCHECKED_CAST")
      val settings = plan["settings"] as? Map<String, Any?> ?: emptyMap()
      val settingRows = settings.mapNotNull { (key, value) ->
        (value as? String)?.let { SettingEntity(key, it) }
      }
      if (settingRows.isNotEmpty()) userDao.putSettings(settingRows)

      val favoriteTombstoneRemovals = plan.stringList("favoriteTombstoneRemovals")
      if (favoriteTombstoneRemovals.isNotEmpty()) {
        userDao.deleteFavoriteTombstones(favoriteTombstoneRemovals)
      }
      for (item in plan.mapList("favoriteAdds")) {
        val key = item["key"].asString()
        val title = item["title"].asString()
        val artist = item["artist"].asString()
        val album = item["album"].asString()
        val addedAt = item["addedAt"].asLong()
        val match = matcher.match(title, artist, album, item["sourcePath"] as? String)
        if (match != null) {
          userDao.putFavorite(FavoriteEntity(match.path, addedAt))
          userDao.deletePendingFavorites(listOf(key))
          userDao.deleteFavoriteTombstones(listOf(key))
          favoritesAdded += 1
        } else {
          userDao.putPendingFavorites(
            listOf(PendingFavoriteEntity(key, title, artist, album, addedAt)),
          )
          favoritesPending += 1
        }
      }
      for (item in plan.mapList("favoriteRemoves")) {
        for (path in item.stringList("trackPaths")) userDao.deleteFavorite(path)
        val key = item["key"].asString()
        userDao.deletePendingFavorites(listOf(key))
        userDao.putFavoriteTombstones(
          listOf(FavoriteTombstoneEntity(key, item["deletedAt"].asLong())),
        )
        favoritesRemoved += 1
      }

      val playlistTombstoneRemovals = plan.stringList("playlistTombstoneRemovals")
      if (playlistTombstoneRemovals.isNotEmpty()) {
        userDao.deletePlaylistTombstones(playlistTombstoneRemovals)
      }
      for (item in plan.mapList("playlistAdoptions")) {
        userDao.updatePlaylistSyncUid(item["playlistId"].asLong(), item["syncUid"].asString())
      }
      for (item in plan.mapList("playlistDeletes")) {
        val uid = item["syncUid"].asString()
        userDao.deletePlaylistBySyncUid(uid)
        userDao.putPlaylistTombstones(
          listOf(PlaylistTombstoneEntity(uid, item["deletedAt"].asLong())),
        )
        userDao.deletePlaylistSyncStates(listOf(uid))
        playlistResults += PlaylistApplyResult(uid, "deleted", 0, 0)
      }
      for (item in plan.mapList("playlistUpserts")) {
        playlistResults += replacePlaylist(userDao, matcher, item)
      }

      val baselineDeletes = plan.stringList("baselineDeletes")
      if (baselineDeletes.isNotEmpty()) userDao.deletePlaylistSyncStates(baselineDeletes)
      val baselines = plan.mapList("baselineUpserts").map {
        PlaylistSyncStateEntity(
          syncUid = it["syncUid"].asString(),
          localUpdatedAt = it["localUpdatedAt"].asLong(),
          remoteUpdatedAt = it["remoteUpdatedAt"].asLong(),
        )
      }
      if (baselines.isNotEmpty()) userDao.putPlaylistSyncStates(baselines)
    }

    return mapOf(
      "favoritesAdded" to favoritesAdded,
      "favoritesPending" to favoritesPending,
      "favoritesRemoved" to favoritesRemoved,
      "playlistResults" to playlistResults.map(PlaylistApplyResult::toBridgeMap),
    )
  }

  suspend fun resolveConflict(
    userDatabase: AstraUserDatabase,
    catalogDatabase: AstraCatalogDatabase,
    conflict: Map<String, Any?>,
    resolution: String,
    mergedPlaylist: Map<String, Any?>?,
  ) {
    val userDao = userDatabase.userDao()
    val playlistId = conflict["localPlaylistId"].asLong()
    val syncUid = conflict["syncUid"].asString()
    val conflictKind = conflict["kind"].asString()
    val remoteUpdatedAt = conflict["remoteUpdatedAt"].asLong()
    val matcher = NativeTrackMatcher(
      catalogDatabase.catalogDao().getAllActiveTracksForNativeMatching(),
    )
    userDatabase.withTransaction {
      val current = userDao.getPlaylist(playlistId) ?: return@withTransaction
      when (resolution) {
        "desktop" -> {
          if (conflictKind == "first-pairing") userDao.updatePlaylistSyncUid(playlistId, syncUid)
          userDao.putPlaylistSyncStates(
            listOf(PlaylistSyncStateEntity(syncUid, current.updatedAt, 0)),
          )
        }
        "phone" -> {
          if (conflictKind == "first-pairing") userDao.updatePlaylistSyncUid(playlistId, syncUid)
          userDao.putPlaylistSyncStates(
            listOf(PlaylistSyncStateEntity(syncUid, 0, remoteUpdatedAt)),
          )
        }
        "both" -> {
          val copyName = "${current.name} (Phone)"
          if (conflictKind == "first-pairing") {
            userDao.putPlaylist(
              current.copy(name = copyName, updatedAt = System.currentTimeMillis()),
            )
          } else {
            val now = System.currentTimeMillis()
            val cloneId = userDao.insertPlaylist(
              current.copy(
                id = 0,
                name = copyName,
                createdAt = now,
                updatedAt = now,
                lastPlayedAt = null,
                syncUid = UUID.randomUUID().toString().replace("-", ""),
              ),
            )
            userDao.putPlaylistTracks(
              userDao.getPlaylistTracks(playlistId).map {
                it.copy(id = 0, playlistId = cloneId)
              },
            )
            userDao.putPlaylistSyncStates(
              listOf(PlaylistSyncStateEntity(syncUid, current.updatedAt, 0)),
            )
          }
        }
        "merge" -> {
          require(mergedPlaylist != null) { "Merged playlist is required." }
          if (conflictKind == "first-pairing") userDao.updatePlaylistSyncUid(playlistId, syncUid)
          replacePlaylist(userDao, matcher, mergedPlaylist)
          userDao.putPlaylistSyncStates(
            listOf(PlaylistSyncStateEntity(syncUid, 0, remoteUpdatedAt)),
          )
        }
        else -> error("Unknown desktop sync conflict resolution.")
      }
    }
  }

  private suspend fun replacePlaylist(
    userDao: UserDao,
    matcher: NativeTrackMatcher,
    input: Map<String, Any?>,
  ): PlaylistApplyResult {
    val uid = input["syncUid"].asString()
    val kind = if (input["kind"] == "dynamic") "dynamic" else "normal"
    val rules = if (kind == "dynamic") input["dynamicRules"] as? String else null
    if (kind == "dynamic") {
      try {
        DynamicPlaylistCompiler.compile(rules, 0, 1)
      } catch (_: Throwable) {
        return PlaylistApplyResult(uid, "skipped-incompatible", 0, 0)
      }
    }
    val existing = userDao.getPlaylistBySyncUid(uid)
    val playlistId = if (existing == null) {
      userDao.insertPlaylist(
        PlaylistEntity(
          name = input["name"].asString(),
          kind = kind,
          dynamicRulesJson = rules,
          createdAt = input["createdAt"].asLong(),
          updatedAt = input["updatedAt"].asLong(),
          syncUid = uid,
        ),
      )
    } else {
      userDao.putPlaylist(
        existing.copy(
          name = input["name"].asString(),
          kind = kind,
          dynamicRulesJson = rules,
          updatedAt = input["updatedAt"].asLong(),
        ),
      )
      existing.id
    }
    userDao.deletePlaylistTombstones(listOf(uid))

    var matchedCount = 0
    var fallbackCount = 0
    val rows = mutableListOf<PlaylistTrackEntity>()
    val seen = hashSetOf<String>()
    if (kind == "normal") {
      val ordered = input.mapList("entries").sortedBy { it["position"].asLong() }
      for (entry in ordered) {
        val title = entry["title"].asString()
        val artist = entry["artist"].asString()
        val album = entry["album"].asString()
        val match = matcher.match(title, artist, album, entry["sourcePath"] as? String)
        val path = match?.path
          ?: (entry["sourcePath"] as? String)?.trim()?.takeIf(String::isNotEmpty)
          ?: "astra-sync://unmatched/${syncKey(title, artist, album)}"
        if (!seen.add(path)) continue
        if (match != null) matchedCount += 1 else fallbackCount += 1
        rows += PlaylistTrackEntity(
          playlistId = playlistId,
          trackPath = path,
          position = rows.size,
          addedAt = entry["addedAt"].asLong(input["updatedAt"].asLong())
            .takeIf { it > 0 } ?: input["updatedAt"].asLong(),
          fallbackTitle = if (match == null) title.takeIf(String::isNotEmpty) else null,
          fallbackArtist = if (match == null) artist.takeIf(String::isNotEmpty) else null,
          fallbackAlbum = if (match == null) album.takeIf(String::isNotEmpty) else null,
        )
      }
    }
    userDao.replacePlaylistEntries(playlistId, rows)
    return PlaylistApplyResult(
      uid,
      if (existing == null) "created" else "replaced",
      matchedCount,
      fallbackCount,
    )
  }
}
