package expo.modules.astralibraryscanner.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.LargeTest
import java.io.File
import java.text.Normalizer
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class RoomLibraryRepositoryTest {
  private lateinit var catalog: AstraCatalogDatabase
  private lateinit var user: AstraUserDatabase

  @Before
  fun openDatabases() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    catalog = Room.inMemoryDatabaseBuilder(context, AstraCatalogDatabase::class.java)
      .allowMainThreadQueries()
      .build()
    user = Room.inMemoryDatabaseBuilder(context, AstraUserDatabase::class.java)
      .allowMainThreadQueries()
      .build()
  }

  @After
  fun closeDatabases() {
    catalog.close()
    user.close()
  }

  @Test
  fun unicodeRoundTripsSortsAndSearchesWithoutTranslation() = runBlocking {
    val titles = listOf(
      "東京の夜",
      "Привет мир",
      "emoji 🚀 song",
      Normalizer.normalize("Café", Normalizer.Form.NFC),
      Normalizer.normalize("Café", Normalizer.Form.NFD),
      "O'Brien 100%_Mix & Friends",
    )
    publish("g1", titles.mapIndexed { index, title ->
      track(
        generation = "g1",
        index = index,
        title = title,
        path = "content://com.android.externalstorage.documents/document/primary%3AMusic%2F${title}%25_${index}.flac",
      )
    })

    val dao = catalog.catalogDao()
    val paths = dao.getAllPathsByTitle()
    assertEquals(titles.size, paths.size)
    val rows = dao.getActiveTracks(paths)
    assertEquals(titles.toSet(), rows.map { it.title }.toSet())
    assertEquals(1, dao.searchTracksLiteral("%東京%", 10).size)
    assertEquals(1, dao.searchTracks("\"Привет\"*", 10).size)
    assertEquals(1, dao.searchTracksLiteral("%🚀%", 10).size)
    assertEquals(1, dao.searchTracksLiteral("%100\\%\\_Mix%", 10).size)
    assertTrue(dao.searchTracksLiteral("%&%", 10).isNotEmpty())
    assertTrue(rows.any { "%3A" in it.path && "%2F" in it.path })

    val firstPage = dao.getTitlePage(null, "", 2)
    val secondPage = dao.getTitlePage(
      firstPage.last().titleSortKey,
      firstPage.last().path,
      20,
    )
    assertEquals(titles.size, (firstPage + secondPage).map { it.path }.distinct().size)
    val artistFirst = dao.getArtistOrderPage(null, "", 0, 0, "", "", 2)
    val artistAnchor = artistFirst.last()
    val artistSecond = dao.getArtistOrderPage(
      artistAnchor.artistSortKey,
      artistAnchor.albumSortKey,
      artistAnchor.discSort,
      artistAnchor.trackSort,
      artistAnchor.titleSortKey,
      artistAnchor.path,
      20,
    )
    assertEquals(titles.size, (artistFirst + artistSecond).map { it.path }.distinct().size)
    val recentFirst = dao.getRecentlyAddedPage(null, "", 2)
    val recentSecond = dao.getRecentlyAddedPage(
      recentFirst.last().addedAt,
      recentFirst.last().path,
      20,
    )
    assertEquals(titles.size, (recentFirst + recentSecond).map { it.path }.distinct().size)
    val durationFirst = dao.getDurationPage(null, "", 2)
    val durationSecond = dao.getDurationPage(
      durationFirst.last().duration,
      durationFirst.last().path,
      20,
    )
    assertEquals(titles.size, (durationFirst + durationSecond).map { it.path }.distinct().size)
    assertNotEquals(SortKeys.forText("A"), SortKeys.forText("B"))
  }

  @Test
  fun stagingGenerationIsInvisibleAndAbandonedWorkIsDiscarded() = runBlocking {
    publish("active", listOf(track("active", 1, "Last known good")))
    val dao = catalog.catalogDao()
    val revision = dao.getRevision()

    dao.insertGeneration(ScanGenerationEntity("pending", "local:1", "staging", 2))
    dao.putTracks(listOf(track("pending", 2, "Half written scan")))
    assertEquals(listOf("Last known good"), dao.getTitlePage(null, "", 10).map { it.title })
    assertEquals(revision, dao.getRevision())

    dao.discardAbandonedGenerations()
    assertNull(dao.getGeneration("pending"))
    assertEquals(listOf("Last known good"), dao.getTitlePage(null, "", 10).map { it.title })

    publish("replacement", listOf(track("replacement", 3, "Published replacement")), "active")
    assertEquals(listOf("Published replacement"), dao.getTitlePage(null, "", 10).map { it.title })
    assertNull(dao.getGeneration("active"))
  }

  @Test
  fun userMutationsAndVirtualQueueAreAtomicAndDurable() = runBlocking {
    val dao = user.userDao()
    val playlistId = dao.insertPlaylist(
      PlaylistEntity(name = "Unicode 🚀", createdAt = 1, updatedAt = 1),
    )
    assertEquals(
      2,
      dao.appendPlaylistTracks(
        playlistId,
        listOf(
          PlaylistTrackEntity(playlistId = playlistId, trackPath = "東京.flac", position = 0, addedAt = 0),
          PlaylistTrackEntity(playlistId = playlistId, trackPath = "Привет.flac", position = 0, addedAt = 0),
        ),
        2,
      ),
    )
    dao.putFavorite(FavoriteEntity("東京.flac", 3))
    dao.putPlaybackHistory(PlaybackHistoryEntity("東京.flac", 4, 7))

    val session = PlaybackSessionEntity("active-context", """{"kind":"playlist","playlistId":$playlistId}""", "東京.flac", 42, 0, 5, 5)
    dao.replacePlaybackQueue(
      session,
      listOf(
        PlaybackQueueEntryEntity(session.id, 0, "東京.flac"),
        PlaybackQueueEntryEntity(session.id, 1, "Привет.flac"),
      ),
      listOf(
        PlaybackOriginalQueueEntryEntity(session.id, 0, "東京.flac"),
        PlaybackOriginalQueueEntryEntity(session.id, 1, "Привет.flac"),
      ),
    )

    assertEquals(2L, dao.countPlaylistTracks(playlistId))
    assertTrue(dao.isFavorite("東京.flac"))
    assertEquals(7L, dao.getPlaybackHistory("東京.flac")?.playCount)
    assertEquals(listOf("東京.flac", "Привет.flac"), dao.getAllQueueEntries(session.id).map { it.trackPath })
    assertEquals(2, dao.getOriginalQueueEntries(session.id).size)

    dao.deletePlaylistById(playlistId)
    assertEquals(0, dao.countPlaylistTracks(playlistId))
    assertEquals(2L, dao.countQueueEntries(session.id))
  }

  @Test
  fun userSnapshotsRotateRejectDamageAndRestoreTheNewestValidCopy() = runBlocking {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val snapshotDirectory = context.filesDir.resolve("astra-user-snapshots")
    snapshotDirectory.deleteRecursively()
    val snapshots = UserSnapshotStore(context)
    val dao = user.userDao()

    dao.putSettings(listOf(SettingEntity("theme", "old")))
    snapshots.write(user)
    Thread.sleep(10)
    dao.putSettings(listOf(SettingEntity("theme", "new")))
    snapshots.write(user)

    val snapshotFiles = snapshotDirectory.listFiles().orEmpty().filter { it.extension == "json" }
    assertEquals(2, snapshotFiles.size)
    snapshotFiles.maxBy(File::lastModified).writeText("""{"damaged":true}""")

    val valid = snapshots.newestValid()
    assertTrue(valid != null)
    val replacement = Room.inMemoryDatabaseBuilder(context, AstraUserDatabase::class.java)
      .allowMainThreadQueries()
      .build()
    try {
      snapshots.restore(replacement, requireNotNull(valid))
      assertEquals("old", replacement.userDao().getSettings(listOf("theme")).single().value)
    } finally {
      replacement.close()
      snapshotDirectory.deleteRecursively()
    }
  }

  @Test
  fun dynamicRulesUseBoundArgumentsAndEscapeWildcards() = runBlocking {
    publish(
      "dynamic",
      listOf(
        track("dynamic", 1, "100%_Real", genre = "Rock"),
        track("dynamic", 2, "100xxReal", genre = "Jazz"),
      ),
    )
    val rules = """
      {
        "conditions": [
          {"kind":"text","field":"title","operator":"contains","value":"%_"},
          {"kind":"exact","field":"favorite","operator":"is","value":true}
        ],
        "sort":{"field":"title","direction":"asc"}
      }
    """.trimIndent()
    catalog.catalogDao().putTrackUserFacts(
      listOf(TrackUserFactEntity(path = "content://track/1.flac", isFavorite = true)),
    )
    val queries = DynamicPlaylistCompiler.compile(rules, 0, 100)
    val rows = catalog.catalogDao().runDynamicTrackQuery(queries.tracks)
    assertEquals(listOf("100%_Real"), rows.map { it.title })
    assertFalse(queries.tracks.sql.contains("100%_Real"))
  }

  @Test
  fun albumAndCollaborativeArtistReadModelsMatchEstablishedRules() = runBlocking {
    val first = track("groups", 1, "One").copy(
      artist = "Alpha & Guest",
      album = "Shared Album",
      artworkHash = "same-cover",
      artistSortKey = SortKeys.forText("Alpha & Guest"),
      albumSortKey = SortKeys.forText("Shared Album"),
    )
    val second = track("groups", 2, "Two").copy(
      artist = "Beta",
      album = "Shared Album",
      artworkHash = "same-cover",
      artistSortKey = SortKeys.forText("Beta"),
      albumSortKey = SortKeys.forText("Shared Album"),
    )
    publish("groups", listOf(first, second))
    val dao = catalog.catalogDao()
    val revision = dao.getRevision()

    val albums = dao.getAllAlbumSummaries(revision)
    assertEquals(1, albums.size)
    assertEquals("Various Artists", albums.single().artist)
    assertEquals(2L, albums.single().trackCount)

    val artists = dao.getAllArtistSummaries(revision, "astra").associateBy { it.artist }
    assertTrue(artists.containsKey("Alpha"))
    assertTrue(artists.containsKey("Guest"))
    assertTrue(artists.containsKey("Beta"))
    assertEquals(0L, artists.getValue("Guest").primaryTrackCount)
    assertTrue(artists.getValue("Guest").isCollaboration)
    assertEquals(
      "One",
      dao.getArtistTrackPage(
        revision,
        "astra",
        "guest",
        "appearance",
        null,
        0,
        0,
        "",
        "",
        10,
      ).single().title,
    )
  }

  @LargeTest
  @Test
  fun oneHundredThousandTrackKeysetPagingRemainsBounded() = runBlocking {
    val dao = catalog.catalogDao()
    dao.insertMeta(CatalogMetaEntity(collationVersion = COLLATION_VERSION, updatedAt = 0))
    dao.putSource(CatalogSourceEntity("local:1", "local", 1, null, 0))
    dao.insertGeneration(ScanGenerationEntity("stress", "local:1", "staging", 0))
    for (start in 0 until 100_000 step 1_000) {
      dao.putTracks(
        (start until start + 1_000).map { index ->
          track("stress", index, "Track ${index.toString().padStart(6, '0')}")
        },
      )
    }
    dao.setActiveGeneration("local:1", "stress", 1)
    dao.setGenerationState("stress", "active", 1, null)
    dao.incrementRevision(1)

    assertEquals(100_000L, dao.countActiveTracks())
    val first = dao.getTitlePage(null, "", 100)
    val second = dao.getTitlePage(first.last().titleSortKey, first.last().path, 100)
    assertEquals(100, first.size)
    assertEquals(100, second.size)
    assertTrue(first.map { it.path }.intersect(second.map { it.path }.toSet()).isEmpty())
  }

  private suspend fun publish(
    generation: String,
    tracks: List<TrackEntity>,
    previous: String? = null,
  ) {
    val dao = catalog.catalogDao()
    if (dao.getMeta() == null) {
      dao.insertMeta(CatalogMetaEntity(collationVersion = COLLATION_VERSION, updatedAt = 0))
      dao.putSource(CatalogSourceEntity("local:1", "local", 1, null, 0))
    }
    dao.insertGeneration(ScanGenerationEntity(generation, "local:1", "staging", 1))
    dao.putTracks(tracks)
    val prospective = dao.getProspectiveTracks("local:1", generation)
    val revision = dao.getRevision() + 1
    val models = CatalogReadModelBuilder.build(prospective, revision)
    dao.publishGeneration(
      sourceKey = "local:1",
      generationId = generation,
      previousGenerationId = previous,
      now = revision,
      albumIdentityUpdates = models.identityUpdates,
      albums = models.albums,
      artists = models.artists,
      artistTrackIndex = models.artistTrackIndex,
      directories = models.directories,
      ftsRows = models.ftsRows,
    )
  }

  private fun track(
    generation: String,
    index: Int,
    title: String,
    path: String = "content://track/$index.flac",
    genre: String? = null,
  ): TrackEntity = TrackEntity(
    generationId = generation,
    sourceKey = "local:1",
    path = path,
    folderId = 1,
    title = title,
    artist = if (index % 2 == 0) "Björk & Rosalía" else "Кино",
    album = "Album %_${index / 2}",
    albumArtist = null,
    albumIdentityKey = "pending",
    duration = 180.0 + index,
    genre = genre,
    format = "FLAC",
    fileName = "$title.flac",
    parentUri = "content://com.android.externalstorage.documents/document/primary%3AMusic",
    mtime = index.toLong(),
    addedAt = index.toLong(),
    modifiedAt = index.toLong(),
    titleSortKey = SortKeys.forText(title),
    artistSortKey = SortKeys.forText("Artist"),
    albumSortKey = SortKeys.forText("Album"),
    fileNameSortKey = SortKeys.forText("$title.flac"),
    discSort = 0,
    trackSort = index,
    sectionLabel = SortKeys.sectionLabel(title),
  )
}
