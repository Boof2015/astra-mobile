package expo.modules.astralibraryscanner.data

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PlaylistSummaryTest {
  @Test
  fun normalTotalsIncludeLaterPagesAndMissingEntriesAndRefreshAfterRemoval() = runBlocking {
    withTracks(235) {
      val id = playlist()
      assertSummary(summary(id), 0, 0, 0.0)
      repository.addPlaylistEntries(id, listOf(mapOf("trackPath" to paths.first())))
      assertSummary(summary(id), 1, 0, 1.0)
      repository.addPlaylistEntries(id, paths.drop(1).map { mapOf("trackPath" to it) } +
        (1..3).map { mapOf("trackPath" to "$tree/missing-$it") })
      for (offset in listOf(0, 100, 200)) {
        val page = repository.getPlaylistEntries(id, offset, 100)
        assertEquals(minOf(100, 238 - offset), (page["items"] as List<*>).size)
        assertEquals(238.0, page["totalCount"])
        assertSummary(summary(id), 235, 3, (1..235).sum().toDouble())
      }
      repository.removePlaylistEntry(id, paths.last())
      assertSummary(summary(id), 234, 3, (1..234).sum().toDouble())
      val missingOnly = playlist()
      repository.addPlaylistEntries(missingOnly, listOf(mapOf("trackPath" to "$tree/missing")))
      assertSummary(summary(missingOnly), 0, 1, 0.0)
    }
  }

  @Test
  fun dynamicTotalsRespectFiltersSortAndRuleLimitRatherThanPageSize() = runBlocking {
    withTracks(235) {
      val id = playlist(rules())
      assertSummary(summary(id), 235, 0, (1..235).sum().toDouble())
      assertEquals(100, (repository.getPlaylistEntries(id, 0, 100)["items"] as List<*>).size)
      assertSummary(summary(id), 235, 0, (1..235).sum().toDouble())

      repository.updateDynamicPlaylistRules(id, rules(limit = 137))
      assertSummary(summary(id), 137, 0, (99..235).sum().toDouble())
      val last = repository.getPlaylistEntries(id, 100, 100)
      assertEquals(37, (last["items"] as List<*>).size)
      assertNull(last["nextOffset"])
      assertSummary(summary(id), 137, 0, (99..235).sum().toDouble())

      repository.updateDynamicPlaylistRules(id, rules(limit = 1))
      assertSummary(summary(id), 1, 0, 235.0)
      repository.updateDynamicPlaylistRules(id, rules(limit = 1, direction = "asc"))
      assertSummary(summary(id), 1, 0, 1.0)
      repository.updateDynamicPlaylistRules(id, rules(album = "$tree/no-match"))
      assertSummary(summary(id), 0, 0, 0.0)
    }
  }

  @Test
  fun favoriteTotalsCrossBothBatchAndDisplayLimitsAndRefreshOnToggle() = runBlocking {
    withTracks(605) {
      val baseline = repository.getFavoriteSummary()
      favorite("$tree/missing")
      for (path in paths) favorite(path)
      fun total(key: String) = (baseline.getValue(key) as Number).toDouble()
      assertSummary(repository.getFavoriteSummary(),
        total("track_count").toInt() + 605, total("missing_track_count").toInt() + 1,
        total("total_duration") + (1..605).sum())
      val paged = mutableListOf<Map<*, *>>()
      var offset: Int? = 0
      while (offset != null) {
        val page = repository.getFavoriteEntries(offset, 100)
        paged += (page["items"] as List<*>).filterIsInstance<Map<*, *>>()
        offset = (page["nextOffset"] as? Number)?.toInt()
      }
      assertEquals(606, paged.count { (it["track_path"] as String).startsWith(tree) })
      assertEquals(true, paged.single { it["track_path"] == "$tree/missing" }["missing"])
      // The display API stays bounded while the summary covers every favorite.
      assertEquals(500, repository.getFavoriteTracks(500).size)
      repository.setFavorite(paths.last(), false)
      assertSummary(repository.getFavoriteSummary(),
        total("track_count").toInt() + 604, total("missing_track_count").toInt() + 1,
        total("total_duration") + (1..604).sum())
      for (path in favorites) repository.setFavorite(path, false)
      assertEquals(baseline, repository.getFavoriteSummary())
    }
  }

  @Test
  fun twoMovedFavoritesCollapseWithSyncedCopiesAndRetainOriginalDates() = runBlocking {
    withTracks(62) {
      for (path in paths) favorite(path)
      val dao = repository.userDb().userDao()
      val original = dao.getFavorites().associateBy { it.trackPath }
      val moved = paths.takeLast(2).associateWith { "$tree/new/${it.substringAfterLast('/')}" }
      favorites += moved.values
      val current = paths.map { moved[it] ?: it }
      // Publish the replacement paths but defer repairs on an incomplete listing.
      scan(current, complete = false)
      val adds = moved.keys.map { path ->
        val song = original.getValue(path)
        mapOf("key" to path, "title" to song.title, "artist" to song.artist,
          "album" to song.album, "addedAt" to song.addedAt + 10000)
      }
      repository.applyDesktopSyncPlan(mapOf("favoriteAdds" to adds))
      suspend fun rows() = dao.getFavorites().filter { it.trackPath.startsWith(tree) }
      assertEquals(64, rows().size)
      assertEquals(2, rows().count { it.trackPath !in current })
      repeat(2) {
        scan(current)
        repository.applyDesktopSyncPlan(mapOf("favoriteAdds" to adds))
        val syncRows = (repository.getDesktopSyncState()["favorites"] as List<*>).filterIsInstance<Map<*, *>>()
        val repaired = rows().associateBy { it.trackPath }
        assertEquals(current.toSet(), repaired.keys)
        for ((old, new) in moved) {
          val liked = original.getValue(old).addedAt
          assertEquals(liked, repaired.getValue(new).addedAt)
          val synced = syncRows.single { new in (it["trackPaths"] as List<*>) }
          assertEquals((liked + 10000).toDouble(), synced["addedAt"])
        }
        val page = repository.getFavoriteEntries(0, 200)["items"] as List<*>
        for (entry in page.filterIsInstance<Map<*, *>>().filter { it["track_path"] in current }) {
          assertEquals(false, entry["missing"])
        }
      }
    }
  }

  @Test
  fun ambiguousAndLegacyMissingFavoritesRemainRemovableByExactPath() = runBlocking {
    withTracks(3) {
      val (old, gone, retained) = paths
      val copies = listOf("$tree/a/1.flac", "$tree/b/1.flac")
      favorite(old)
      favorite(gone)
      favorite("$tree/legacy")
      scan(copies + retained)
      favorite(copies.first())
      scan(listOf(copies.first(), retained))
      val page = repository.getFavoriteEntries(0, 200)["items"] as List<*>
      val items = page.filterIsInstance<Map<*, *>>().associateBy { it["track_path"] }
      for (path in listOf(old, gone, "$tree/legacy")) assertEquals(true, items[path]?.get("missing"))
      assertEquals("1.flac", items[old]?.get("fallback_title"))
      assertNull(items["$tree/legacy"]?.get("fallback_title"))
      repository.setFavorite(old, false)
      scan(listOf(copies.first(), gone, retained))
      val restored = repository.getFavoriteEntries(0, 200)["items"] as List<*>
      val available = restored.filterIsInstance<Map<*, *>>().filter { it["missing"] == false }.map { it["track_path"] }
      assertTrue(available.containsAll(listOf(copies.first(), gone)))
      assertFalse(old in repository.getFavoritePaths())
    }
  }

  @Test
  fun localMovesRespectAnUnfavoriteAndRequireCompleteMatchingFileDetails() = runBlocking {
    withTracks(5) {
      for (path in paths) favorite(path)
      val dao = repository.userDb().userDao()
      val original = paths.map { requireNotNull(dao.getFavorite(it)) }
      val removed = original[1]
      val key = syncKey(removed.title!!, removed.artist!!, removed.album!!)
      // Desktop removal arrives while these paths are unresolved.
      val moved = paths.map { "$tree/new/${it.substringAfterLast('/')}" }
      favorites += moved
      scan(emptyList())
      repository.applyDesktopSyncPlan(mapOf("favoriteRemoves" to listOf(
        mapOf("key" to key, "trackPaths" to emptyList<String>(), "deletedAt" to removed.addedAt + 1))))
      dao.putFavorite(original[2].copy(fileSize = original[2].fileSize!! + 1))
      dao.putFavorite(original[3].copy(durationMs = original[3].durationMs!! + 1))
      dao.putFavorite(original[4].copy(album = null))
      scan(moved)
      assertEquals(original[0].addedAt, dao.getFavorite(moved[0])?.addedAt)
      assertNull(dao.getFavorite(paths[0]))
      assertNull(dao.getFavorite(moved[1]))
      assertNull(dao.getFavorite(paths[1]))
      for (index in 2..4) {
        assertTrue(dao.isFavorite(paths[index]))
        assertFalse(dao.isFavorite(moved[index]))
      }
      dao.deleteFavoriteTombstones(listOf(key))
    }
  }

  @Test
  fun disconnectedSourceAndAnUnindexedLegacyFavoriteAreRetained() = runBlocking {
    withTracks(1) {
      val user = repository.userDb()
      val dao = user.userDao()
      val activePath = paths.single()
      val offline = "$tree/offline/1.flac"
      val unindexed = "$tree/legacy"
      val other = (repository.registerFolder("$tree/unmounted", "Disconnected")["id"] as Number).toLong()
      try {
        favorite(activePath)
        val known = dao.getFavorites().single { it.trackPath == activePath }
        favorites += listOf(offline, unindexed)
        dao.putFavorite(known.copy(trackPath = offline, folderId = other))
        dao.putFavorite(FavoriteEntity(unindexed, 22))
        dao.putFavorite(FavoriteEntity(activePath, 21))
        scan(paths)
        val rows = dao.getFavorites().associateBy { it.trackPath }
        assertEquals(known.copy(addedAt = 21), rows[activePath])
        assertEquals(known.copy(trackPath = offline, folderId = other), rows[offline])
        assertEquals(FavoriteEntity(unindexed, 22), rows[unindexed])
      } finally {
        repository.removeFolder(other)
      }
    }
  }

  private class Fixture(
    val repository: AstraLibraryRepository,
    val tree: String,
    val paths: List<String>,
    val folderId: Long,
  ) {
    val playlists = mutableListOf<Long>()
    val favorites = mutableListOf<String>()

    suspend fun playlist(rules: String? = null): Long {
      val row = repository.createPlaylist("Summary regression", if (rules == null) "normal" else "dynamic", rules)
      return (row.getValue("id") as Number).toLong().also { playlists += it }
    }

    suspend fun summary(id: Long) = repository.listPlaylists().single { (it["id"] as Number).toLong() == id }

    suspend fun favorite(path: String) {
      favorites += path
      repository.setFavorite(path, true)
    }

    suspend fun scan(scannedPaths: List<String>, complete: Boolean = true) {
      val files = scannedPaths.map { path -> LocalAudioFile(
        uri = path, name = path.substringAfterLast('/'), size = 1024, lastModified = 1,
        mimeType = "audio/flac", parentUri = tree, coverUri = null,
      ) }
      repository.scanLocalFolder(folderId, false, { files }, { file ->
        LocalAudioMetadata(ok = true, title = file.name, artist = "Summary regression", album = tree,
          mimeType = "audio/flac", codecMime = "audio/flac",
          durationMs = file.name.substringBefore('.').toLong() * 1000,
          sampleRate = 44100, channels = 2, bitsPerSample = 16)
      }, { _, _, _, _ -> }, completeListing = { complete })
    }

    fun rules(limit: Int? = null, direction: String = "desc", album: String = tree): String = JSONObject()
      .put("version", 2)
      .put("filter", JSONObject().put("kind", "group").put("match", "all").put("children", JSONArray().put(
        JSONObject().put("kind", "text").put("field", "album").put("operator", "is").put("value", album))))
      .put("sort", JSONObject().put("field", "duration_seconds").put("direction", direction))
      .put("limit", limit ?: JSONObject.NULL).toString()
  }

  private suspend fun withTracks(count: Int, block: suspend Fixture.() -> Unit) {
    val repository = AstraLibraryRepository.get(ApplicationProvider.getApplicationContext())
    val tree = "content://playlist-summary-test/${System.nanoTime()}"
    val folderId = (repository.registerFolder(tree, "Playlist summary regression")["id"] as Number).toLong()
    val paths = (1..count).map { "$tree/$it.flac" }
    val fixture = Fixture(repository, tree, paths, folderId)
    try {
      fixture.scan(paths)
      fixture.block()
    } finally {
      for (path in fixture.favorites) repository.setFavorite(path, false)
      for (id in fixture.playlists) repository.deletePlaylist(id)
      repository.removeFolder(folderId)
    }
  }

  private fun assertSummary(summary: Map<String, Any?>, count: Int, missing: Int, duration: Double) {
    assertEquals(count.toDouble(), summary["track_count"])
    assertEquals(missing.toDouble(), summary["missing_track_count"])
    assertEquals(duration, (summary["total_duration"] as Number).toDouble(), 0.0001)
  }
}
