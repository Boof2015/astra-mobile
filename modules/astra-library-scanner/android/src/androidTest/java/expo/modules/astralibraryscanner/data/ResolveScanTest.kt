package expo.modules.astralibraryscanner.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ResolveScanTest {
  @Test
  fun unchangedManualScanReunitesLegacyLocalAndRemoteAlbumsWithoutReadingTags() = runBlocking {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val repository = AstraLibraryRepository.get(context)
    val suffix = System.nanoTime().toString()
    val tree = "content://resolve-test/tree/$suffix"
    val folderId = (repository.registerFolder(tree, "Resolve regression")["id"] as Number).toLong()
    val localSource = "local:$folderId"
    val remoteSource = "subsonic:resolve-$suffix"
    val localGeneration = "resolve-local-$suffix"
    val remoteGeneration = "resolve-remote-$suffix"
    val catalog = Room.databaseBuilder(context, AstraCatalogDatabase::class.java, "astra-catalog.db").build()
    val user = Room.databaseBuilder(context, AstraUserDatabase::class.java, "astra-user.db").build()
    val dao = catalog.catalogDao()
    val userDao = user.userDao()
    val events = mutableListOf<Long>()
    val listener: (Long) -> Unit = { events.add(it) }
    var playlistId: Long? = null
    val historyKeys = mutableListOf<String>()
    val paths = mutableListOf<String>()

    try {
      val corpus = JSONObject(InstrumentationRegistry.getInstrumentation().context.assets
        .open("resolve/desktop.json").bufferedReader().use { it.readText() })
      val fixture = corpus.getJSONArray("albums").objects().first {
        it.getJSONArray("tracks").length() == 108 && it.getJSONArray("expected").length() == 5
      }
      val rows = fixture.getJSONArray("tracks").objects().mapIndexed { index, row ->
        val remote = index % 2 == 1
        val path = if (remote) "$remoteSource/${row.getString("id")}" else "$tree/${row.getString("id")}"
        paths += path
        val title = row.getString("title")
        val album = row.getString("album")
        val artist = row.getString("artist")
        TrackEntity(
          generationId = if (remote) remoteGeneration else localGeneration,
          sourceKey = if (remote) remoteSource else localSource,
          path = path, folderId = if (remote) null else folderId,
          title = title, artist = artist, artistNamesJson = row.names("artist_names"),
          album = album, albumArtist = row.text("album_artist"), albumArtistNamesJson = row.names("album_artist_names"),
          albumIdentityKey = "pending", duration = 180.0,
          trackNumber = row.number("track_number"), trackTotal = row.number("track_total"),
          discNumber = row.number("disc_number"), discTotal = row.number("disc_total"), year = row.number("year"),
          artworkHash = row.text("base_artwork_hash"), format = "FLAC", sampleRate = 44100, bitDepth = 16,
          sourceType = if (remote) "subsonic" else "local", sourceId = if (remote) -folderId else null,
          fileName = row.getString("id").substringAfterLast('/'), parentUri = if (remote) null else tree,
          size = 1024, mtime = 100, addedAt = 1234, modifiedAt = 5678,
          loudnessLufs = -15.0, samplePeak = 0.8, replayGainTrackDb = -2.0, replayGainAlbumDb = -3.0,
          replayGainTrackPeak = 0.7, replayGainAlbumPeak = 0.9, replayGainScanned = true, bpm = 120.0, musicalKey = "Am",
          titleSortKey = SortKeys.forText(title), artistSortKey = SortKeys.forText(artist),
          albumSortKey = SortKeys.forText(album), fileNameSortKey = SortKeys.forText(title),
          discSort = row.number("disc_number") ?: 0, trackSort = row.number("track_number") ?: 0,
          sectionLabel = SortKeys.sectionLabel(title),
        )
      }
      dao.putSource(CatalogSourceEntity(localSource, "local", folderId, localGeneration, 1))
      dao.putSource(CatalogSourceEntity(remoteSource, "subsonic", -folderId, remoteGeneration, 1))
      dao.insertGeneration(ScanGenerationEntity(localGeneration, localSource, "active", 1))
      dao.insertGeneration(ScanGenerationEntity(remoteGeneration, remoteSource, "active", 1))
      dao.putTracks(rows)

      // Persist the old resolver's eleven groups independently of the new algorithm.
      val all = dao.getActiveTrackEntitiesExcludingSource("")
      val models = CatalogReadModelBuilder.build(all, dao.getRevision() + 1)
      val legacyById = all.filter { it.path in paths }.associate { it.id to legacyKey(it) }
      val summariesByAlbum = models.albums.associateBy { it.album }
      val legacyAlbums = all.filter { it.path in paths }.groupBy(::legacyKey).map { (key, tracks) ->
        summariesByAlbum.getValue(tracks.first().album).copy(
          identityKey = key, trackCount = tracks.size.toLong(), totalDuration = tracks.sumOf { it.duration },
          year = tracks.mapNotNull { it.year }.maxOrNull(),
        )
      }
      assertEquals(11, legacyAlbums.size)
      val fixtureAlbums = rows.map { it.album }.toSet()
      dao.publishResolve(models.copy(
        identityUpdates = models.identityUpdates.map { it.copy(identityKey = legacyById[it.trackId] ?: it.identityKey) },
        albums = models.albums.filter { it.album !in fixtureAlbums } + legacyAlbums,
      ), 2)
      val before = dao.getActiveTrackEntitiesExcludingSource("").filter { it.path in paths }.sortedBy { it.path }
      val revision = dao.getRevision()
      assertEquals(1, dao.getMeta()!!.resolveVersion)
      val localFiles = before.filter { it.sourceType == "local" }.map {
        LocalAudioFile(it.path, it.fileName, it.size, it.mtime, "audio/flac", tree, null)
      }

      playlistId = userDao.insertPlaylist(PlaylistEntity(name = "Resolve $suffix", createdAt = 1, updatedAt = 1))
      val selected = before.take(2)
      userDao.appendPlaylistTracks(playlistId, selected.mapIndexed { index, track ->
        PlaylistTrackEntity(playlistId = playlistId, trackPath = track.path, position = index, addedAt = 1)
      }, 2)
      val playlistBefore = userDao.getPlaylistTracks(playlistId)
      val historyGeneration = ListeningStatsEngine.status(user).getValue("generation") as String
      for ((index, track) in selected.withIndex()) {
        userDao.putFavorite(FavoriteEntity(track.path, 3))
        userDao.putPlaybackHistory(PlaybackHistoryEntity(track.path, 4, 7))
        val sessionKey = "resolve-$suffix-$index"
        historyKeys += sessionKey
        userDao.putListeningSession(ListeningSessionEntity(
          sessionKey = sessionKey, generation = historyGeneration, trackPath = track.path,
          title = track.title, artist = track.artist, album = track.album, albumArtist = track.albumArtist,
          albumIdentityKey = track.albumIdentityKey, sourceType = track.sourceType,
          durationSeconds = 180.0, startedAt = 1000, listenedSeconds = 90.0,
        ))
      }
      val sessionsBefore = historyKeys.map { userDao.getListeningSession(it) }

      repository.addCatalogListener(listener)
      var cancel = false
      val cancelled = repository.scanLocalFolder(folderId, false, { localFiles },
        { error("Unchanged metadata must not be read") },
        { phase, _, _, _ -> if (phase == "indexing") cancel = true }, { cancel })
      assertTrue(cancelled.cancelled)
      assertEquals(revision, dao.getRevision())
      assertEquals(before, dao.getActiveTrackEntitiesExcludingSource("").filter { it.path in paths }.sortedBy { it.path })
      assertTrue(events.isEmpty())

      val result = repository.scanLocalFolder(folderId, false, { localFiles.reversed() },
        { error("Unchanged metadata must not be read") }, { _, _, _, _ -> })
      assertTrue(result.revision > revision)
      assertEquals(listOf(result.revision), events)
      assertEquals(0, result.added + result.updated + result.removed + result.errors)
      assertEquals(1, dao.getMeta()!!.resolveVersion)
      val after = dao.getActiveTrackEntitiesExcludingSource("").filter { it.path in paths }.sortedBy { it.path }
      assertEquals(108, after.size)
      assertEquals(before.map { it.copy(albumIdentityKey = "") }, after.map { it.copy(albumIdentityKey = "") })
      val expected = fixture.getJSONArray("expected").objects().associate {
        it.getString("identityKey") to it.getJSONArray("ids").length().toLong()
      }
      assertEquals(expected, after.groupingBy { it.albumIdentityKey }.eachCount().mapValues { it.value.toLong() })
      for ((key, count) in expected) {
        val detail = repository.getAlbumDetail(key, null, 100)
        assertEquals(count.toDouble(), detail["totalCount"])
        assertEquals(count, dao.getAlbumSummary(result.revision, key)!!.trackCount)
        assertEquals(count.toInt(), (detail["items"] as List<*>).size)
      }
      val page = repository.getAlbumPage("name", "asc", true, null, 500)["items"] as List<*>
      assertEquals(5, page.filterIsInstance<Map<*, *>>().count { it["album"] in fixtureAlbums })
      // Current-track refresh (including unloaded tracks) observes the corrected key.
      for (track in selected) assertEquals(after.single { it.path == track.path }.albumIdentityKey,
        repository.getTrack(track.path)!!["album_identity_key"])
      assertEquals(playlistBefore, userDao.getPlaylistTracks(playlistId))
      assertEquals(sessionsBefore, historyKeys.map { userDao.getListeningSession(it) })
      for (track in selected) {
        assertTrue(userDao.isFavorite(track.path))
        assertEquals(PlaybackHistoryEntity(track.path, 4, 7), userDao.getPlaybackHistory(track.path))
      }
      val phases = mutableListOf<String>()
      val repeat = repository.scanLocalFolder(folderId, false, { localFiles },
        { error("Unchanged metadata must not be read") }, { phase, _, _, _ -> phases.add(phase) })
      assertEquals(result.revision, repeat.revision)
      assertFalse("A validated revision keeps the cheap unchanged-scan path", "indexing" in phases)
      assertEquals(listOf(result.revision), events)
    } finally {
      repository.removeCatalogListener(listener)
      playlistId?.let { userDao.deletePlaylistById(it) }
      for (path in paths) {
        user.openHelper.writableDatabase.execSQL("DELETE FROM favorites WHERE track_path = ?", arrayOf(path))
        user.openHelper.writableDatabase.execSQL("DELETE FROM playback_history WHERE track_path = ?", arrayOf(path))
      }
      for (key in historyKeys) user.openHelper.writableDatabase.execSQL("DELETE FROM listening_sessions WHERE session_key = ?", arrayOf(key))
      dao.deleteSource(remoteSource)
      dao.deleteGenerationTracks(remoteGeneration)
      dao.deleteGeneration(remoteGeneration)
      repository.removeFolder(folderId)
      user.close()
      catalog.close()
    }
  }

  private fun legacyKey(track: TrackEntity): String {
    val album = ArtistResolve.identityKey(track.album)
    val owner = ArtistResolve.artistKey(track.albumArtist)
    val year = if (track.album == "Carti Leaks") when {
      track.year == 2013 -> "2013"
      (track.year ?: 0) >= 2018 -> "2018-2019"
      else -> "2015-2016"
    } else track.year.toString()
    return "album:$album::aa:$owner:rp:y$year:d${track.discTotal ?: "u"}:t${track.trackTotal}"
  }
  private fun JSONArray.objects() = (0 until length()).map(::getJSONObject)
  private fun JSONObject.text(key: String): String? = if (has(key) && !isNull(key)) getString(key) else null
  private fun JSONObject.number(key: String): Int? = if (has(key) && !isNull(key)) getInt(key) else null
  private fun JSONObject.names(key: String): String? = optJSONArray(key)?.toString()
}
