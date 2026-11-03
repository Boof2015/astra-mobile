package expo.modules.astralibraryscanner.data

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
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

  private class Fixture(
    val repository: AstraLibraryRepository,
    val tree: String,
    val paths: List<String>,
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
    val fixture = Fixture(repository, tree, paths)
    try {
      val files = paths.map { path -> LocalAudioFile(
        uri = path, name = path.substringAfterLast('/'), size = 1024, lastModified = 1,
        mimeType = "audio/flac", parentUri = tree, coverUri = null,
      ) }
      repository.scanLocalFolder(folderId, false, { files }, { file ->
        LocalAudioMetadata(ok = true, title = file.name, artist = "Summary regression", album = tree,
          mimeType = "audio/flac", codecMime = "audio/flac",
          durationMs = file.name.substringBefore('.').toLong() * 1000,
          sampleRate = 44100, channels = 2, bitsPerSample = 16)
      }, { _, _, _, _ -> })
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
