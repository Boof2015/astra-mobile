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
  fun cancelledScanDiscardsStagingAndRestoresFolderWithoutPublishing() = runBlocking {
    publish("active", listOf(track("active", 1, "Last known good")))
    val catalogDao = catalog.catalogDao()
    val userDao = user.userDao()
    val revision = catalogDao.getRevision()
    val scannedAt = 1234L
    val folderId = userDao.insertFolder(
      FolderEntity(
        treeUri = "content://music",
        displayName = "Music",
        addedAt = 1,
        lastScannedAt = scannedAt,
        lastScanStatus = "ready",
      ),
    )

    catalogDao.insertGeneration(ScanGenerationEntity("cancelled", "local:1", "staging", 2))
    catalogDao.putTracks(listOf(track("cancelled", 2, "Half written scan")))
    userDao.updateFolderScanState(folderId, scannedAt, "scanning", null)

    catalogDao.deleteGenerationTracks("cancelled")
    catalogDao.deleteGeneration("cancelled")
    userDao.updateFolderScanState(folderId, scannedAt, "ready", null)

    assertNull(catalogDao.getGeneration("cancelled"))
    assertEquals(revision, catalogDao.getRevision())
    assertEquals(
      listOf("Last known good"),
      catalogDao.getTitlePage(null, "", 10).map { it.title },
    )
    val restored = userDao.getFolder(folderId)
    assertEquals(scannedAt, restored?.lastScannedAt)
    assertEquals("ready", restored?.lastScanStatus)
    assertNull(restored?.lastScanError)
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
  fun playbackWindowNeverClampsPastTheEndBackToTheLastTrack() {
    assertEquals(0L, boundedPlaybackWindowStart(-10, 3))
    assertEquals(2L, boundedPlaybackWindowStart(2, 3))
    assertNull(boundedPlaybackWindowStart(3, 3))
    assertNull(boundedPlaybackWindowStart(99, 3))
    assertNull(boundedPlaybackWindowStart(0, 0))
  }

  @Test
  fun trackSectionAnchorsOpenOnTheRequestedTitleAndArtistBuckets() = runBlocking {
    publish(
      "anchors",
      listOf(
        track("anchors", 0, "//.xX_-=-FLUTE==-Xx.\\\\"),
        track("anchors", 1, "Apple").copy(
          artist = "Amber",
          artistSortKey = SortKeys.forText("Amber"),
        ),
        track("anchors", 2, "Saturn").copy(
          artist = "Sade",
          artistSortKey = SortKeys.forText("Sade"),
        ),
        track("anchors", 3, "Zulu").copy(
          artist = "Zero 7",
          artistSortKey = SortKeys.forText("Zero 7"),
        ),
      ),
    )
    val dao = catalog.catalogDao()

    assertFalse(dao.getTitleSectionAnchors().any { it.sectionLabel == "X" })
    assertTrue(dao.getTitleSectionAnchors().any { it.sectionLabel == "#" })
    val titleAnchor = dao.getTitleSectionAnchors().single { it.sectionLabel == "S" }
    val titlePage = dao.getTitlePage(titleAnchor.sortKey, "", 100)
    assertEquals("Saturn", titlePage.first().title)

    val artistAnchor = dao.getArtistSectionAnchorCandidates()
      .filter { SortKeys.sectionLabel(it.artist) == "S" }
      .minOf(ArtistSectionAnchorCandidate::sortKey)
    val artistPage = dao.getArtistOrderPage(artistAnchor, "", 0, 0, "", "", 100)
    assertEquals("Sade", artistPage.first().artist)
  }

  @Test
  fun sectionLabelsUseOnlyTheFirstVisibleCharacter() {
    assertEquals("#", SortKeys.sectionLabel("//.xX_-=-FLUTE==-Xx.\\\\"))
    assertEquals("#", SortKeys.sectionLabel("! PARTY SIRENS !"))
    assertEquals("#", SortKeys.sectionLabel("#iwannadance"))
    assertEquals("#", SortKeys.sectionLabel("7 Rings"))
    assertEquals("E", SortKeys.sectionLabel("Élan"))
    assertEquals("S", SortKeys.sectionLabel(" Saturn"))
    assertEquals("#", SortKeys.sectionLabel("東京の夜"))
  }

  @Test
  fun sectionLabelMigrationCorrectsExistingCatalogRows() = runBlocking {
    val dao = catalog.catalogDao()
    dao.insertMeta(CatalogMetaEntity(collationVersion = 1, updatedAt = 0))
    dao.putSource(CatalogSourceEntity("local:1", "local", 1, "legacy", 0))
    dao.insertGeneration(ScanGenerationEntity("legacy", "local:1", "active", 0))
    dao.putTracks(
      listOf(
        track("legacy", 1, "//.xX_-=-FLUTE==-Xx.\\\\").copy(sectionLabel = "X"),
        track("legacy", 2, "Xylophone").copy(sectionLabel = "X"),
      ),
    )

    dao.migrateSectionLabels(COLLATION_VERSION, 1)

    assertEquals(COLLATION_VERSION, dao.getMeta()?.collationVersion)
    assertEquals(
      mapOf("//.xX_-=-FLUTE==-Xx.\\\\" to "#", "Xylophone" to "X"),
      dao.getActiveTracks(dao.getAllPathsByTitle()).associate { it.title to it.sectionLabel },
    )
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

  /**
   * Walking backwards has to reproduce the forward ordering exactly — an off-by-one in
   * the reversed tie-break tuple would either duplicate a row or silently skip one when
   * the list refills upwards after an A-Z jump.
   */
  @Test
  fun backwardTitlePagesMirrorForwardPages() = runBlocking {
    publish("g1", seedAlphabet())
    val dao = catalog.catalogDao()

    val forward = mutableListOf<ActiveTrackView>()
    var afterKey: String? = null
    var afterPath = ""
    while (true) {
      val page = dao.getTitlePage(afterKey, afterPath, 40)
      if (page.isEmpty()) break
      forward += page
      afterKey = page.last().titleSortKey
      afterPath = page.last().path
    }
    assertEquals(ALPHABET_SEED_SIZE, forward.size)

    val backward = mutableListOf<ActiveTrackView>()
    var beforeKey = forward.last().titleSortKey
    var beforePath = forward.last().path
    while (true) {
      val page = dao.getTitlePageBefore(beforeKey, beforePath, 40)
      if (page.isEmpty()) break
      backward += page
      beforeKey = page.last().titleSortKey
      beforePath = page.last().path
    }
    // Backward pages are exclusive of the anchor row and come back descending.
    assertEquals(
      forward.dropLast(1).map { it.path }.reversed(),
      backward.map { it.path },
    )
    // Nothing above the very first row.
    assertTrue(dao.getTitlePageBefore(forward.first().titleSortKey, forward.first().path, 40).isEmpty())
  }

  /**
   * The exact shape a rail jump uses: a section anchor carries only the leading sort key
   * with an empty path tie-break, so the forward page starts at the letter and the
   * backward page must be the slice immediately above it — no overlap, no gap.
   */
  @Test
  fun sectionAnchorSplitsCatalogWithoutOverlapOrGap() = runBlocking {
    publish("g1", seedAlphabet())
    val dao = catalog.catalogDao()

    val all = mutableListOf<ActiveTrackView>()
    var afterKey: String? = null
    var afterPath = ""
    while (true) {
      val page = dao.getTitlePage(afterKey, afterPath, 100)
      if (page.isEmpty()) break
      all += page
      afterKey = page.last().titleSortKey
      afterPath = page.last().path
    }

    val anchor = dao.getTitleSectionAnchors().first { it.sectionLabel == "F" }
    val at = dao.getTitlePage(anchor.sortKey, "", 40)
    val above = dao.getTitlePageBefore(anchor.sortKey, "", 40)

    assertEquals("F", SortKeys.sectionLabel(at.first().title))
    assertTrue(above.all { SortKeys.sectionLabel(it.title) != "F" })

    val anchorIndex = all.indexOfFirst { it.path == at.first().path }
    assertEquals(40, above.size)
    assertEquals(
      all.subList(anchorIndex - above.size, anchorIndex).map { it.path },
      above.reversed().map { it.path },
    )
  }

  /** 10 tracks under each of A-Z, so every section has rows above and below it. */
  private fun seedAlphabet(): List<TrackEntity> =
    (0 until ALPHABET_SEED_SIZE).map { index ->
      val letter = 'A' + (index / 10)
      track(
        generation = "g1",
        index = index,
        title = "$letter${"%03d".format(index)} Song",
        path = "content://track/$index.flac",
      )
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

  private companion object {
    /** 26 letters x 10 tracks. */
    const val ALPHABET_SEED_SIZE = 260
  }
}
