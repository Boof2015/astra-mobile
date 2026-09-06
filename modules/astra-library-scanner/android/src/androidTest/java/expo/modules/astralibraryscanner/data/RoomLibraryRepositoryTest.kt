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
  fun stableQueueMutationPreservesIdsAcrossMoveRemoveInsertAndDuplicates() = runBlocking {
    val dao = user.userDao()
    val session = PlaybackSessionEntity(
      id = "active-context",
      contextJson = """{"kind":"manual"}""",
      anchorPath = "/a.flac",
      shuffleSeed = 42,
      activePosition = 0,
      createdAt = 1,
      updatedAt = 1,
      queueRevision = 1,
      nextEntryId = 14,
    )
    dao.replacePlaybackQueue(
      session,
      listOf(
        PlaybackQueueEntryEntity(session.id, 0, "/a.flac", 10),
        PlaybackQueueEntryEntity(session.id, 1, "/b.flac", 11),
        PlaybackQueueEntryEntity(session.id, 2, "/a.flac", 12),
        PlaybackQueueEntryEntity(session.id, 3, "/c.flac", 13),
      ),
      listOf(
        PlaybackOriginalQueueEntryEntity(session.id, 0, "/a.flac", 10),
        PlaybackOriginalQueueEntryEntity(session.id, 1, "/b.flac", 11),
        PlaybackOriginalQueueEntryEntity(session.id, 2, "/a.flac", 12),
        PlaybackOriginalQueueEntryEntity(session.id, 3, "/c.flac", 13),
      ),
    )

    dao.applyPlaybackQueueMutation(
      session.copy(queueRevision = 2, nextEntryId = 15),
      listOf(
        PlaybackQueueEntryEntity(session.id, 0, "/a.flac", 10),
        PlaybackQueueEntryEntity(session.id, 1, "/c.flac", 13),
        PlaybackQueueEntryEntity(session.id, 2, "/a.flac", 12),
        PlaybackQueueEntryEntity(session.id, 3, "/d.flac", 14),
      ),
      listOf(
        PlaybackOriginalQueueEntryEntity(session.id, 0, "/a.flac", 10),
        PlaybackOriginalQueueEntryEntity(session.id, 1, "/a.flac", 12),
        PlaybackOriginalQueueEntryEntity(session.id, 2, "/c.flac", 13),
        PlaybackOriginalQueueEntryEntity(session.id, 3, "/d.flac", 14),
      ),
    )

    assertEquals(
      listOf(10L, 13L, 12L, 14L),
      dao.getAllQueueEntries(session.id).map(PlaybackQueueEntryEntity::entryId),
    )
    assertEquals(
      listOf("/a.flac", "/c.flac", "/a.flac", "/d.flac"),
      dao.getAllQueueEntries(session.id).map(PlaybackQueueEntryEntity::trackPath),
    )
    assertEquals(
      listOf(10L, 12L, 13L, 14L),
      dao.getOriginalQueueEntries(session.id)
        .map(PlaybackOriginalQueueEntryEntity::entryId),
    )
    assertEquals(2L, dao.getPlaybackSession(session.id)?.queueRevision)
    assertEquals(15L, dao.getPlaybackSession(session.id)?.nextEntryId)
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
    // A pre-feature v1 snapshot has no artistImages property.
    valid?.payload?.remove("artistImages")
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
  fun artistImageSnapshotRoundTripPreservesManualAndAutomaticLayers() = runBlocking {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val snapshotDirectory = context.filesDir.resolve("astra-user-snapshots")
    snapshotDirectory.deleteRecursively()
    val snapshots = UserSnapshotStore(context)
    user.userDao().putArtistImage(
      ArtistImageEntity(
        groupingMode = "fileTags",
        artistKey = "björk",
        artistName = "Björk",
        manualImageHash = "manual.webp",
        automaticImageHash = "deezer.jpg",
        automaticProvider = "deezer",
        automaticSourceId = "42",
        lookupStatus = "transient_error",
        retryCount = 2,
        lastAttemptAt = 10,
        nextRetryAt = 30,
        updatedAt = 20,
      ),
    )
    snapshots.write(user)

    val replacement = Room.inMemoryDatabaseBuilder(context, AstraUserDatabase::class.java)
      .allowMainThreadQueries()
      .build()
    try {
      snapshots.restore(replacement, requireNotNull(snapshots.newestValid()))
      val restored = replacement.userDao().getArtistImage("fileTags", "björk")
      assertEquals("manual.webp", restored?.manualImageHash)
      assertEquals("deezer.jpg", restored?.automaticImageHash)
      assertEquals("42", restored?.automaticSourceId)
      assertEquals("transient_error", restored?.lookupStatus)
      assertEquals(2, restored?.retryCount)
      assertEquals(30L, restored?.nextRetryAt)
    } finally {
      replacement.close()
      snapshotDirectory.deleteRecursively()
    }
  }

  @Test
  fun artistArtworkBridgeUsesManualThenDeezerThenTrack() {
    val summary = ArtistSummaryEntity(
      revision = 1,
      artistKey = "björk",
      artist = "Björk",
      groupingMode = "astra",
      trackCount = 2,
      primaryTrackCount = 2,
      albumCount = 2,
      artworkHash = "track.jpg",
      nameSortKey = "bjork",
      sectionLabel = "B",
      isCollaboration = false,
      artworkHashesJson = """["track.jpg","other.jpg"]""",
    )
    val automatic = ArtistImageEntity(
      groupingMode = "astra",
      artistKey = "björk",
      artistName = "Björk",
      automaticImageHash = "deezer.jpg",
      automaticProvider = "deezer",
      lookupStatus = "found",
      updatedAt = 1,
    )

    val automaticMap = summary.toBridgeMap(automatic)
    assertEquals("deezer.jpg", automaticMap["artwork_hash"])
    assertEquals(listOf("deezer.jpg"), automaticMap["artwork_hashes"])
    assertEquals("deezer", automaticMap["artwork_source"])

    val manualMap = summary.toBridgeMap(
      automatic.copy(manualImageHash = "manual.webp"),
    )
    assertEquals("manual.webp", manualMap["artwork_hash"])
    assertEquals(listOf("manual.webp"), manualMap["artwork_hashes"])
    assertEquals("manual", manualMap["artwork_source"])

    val trackMap = summary.toBridgeMap()
    assertEquals("track.jpg", trackMap["artwork_hash"])
    assertEquals("track", trackMap["artwork_source"])
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
      artistNamesJson = serializeArtistNames(listOf("Alpha", "Guest")),
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

  @Test
  fun descendingTitlePagesAndAnchorsRemainGapFree() = runBlocking {
    publish("g1", seedAlphabet())
    val dao = catalog.catalogDao()
    val expected = dao.getTitlePage(null, "", ALPHABET_SEED_SIZE)
      .sortedWith(compareByDescending<ActiveTrackView> { it.titleSortKey }.thenBy { it.path })

    val paged = mutableListOf<ActiveTrackView>()
    var afterKey: String? = null
    var afterPath = ""
    while (true) {
      val page = dao.getTitlePageDescending(afterKey, afterPath, 37)
      if (page.isEmpty()) break
      paged += page
      afterKey = page.last().titleSortKey
      afterPath = page.last().path
    }
    assertEquals(expected.map { it.path }, paged.map { it.path })

    val anchor = dao.getTitleSectionAnchorsDescending().first { it.sectionLabel == "F" }
    val at = dao.getTitlePageDescending(anchor.sortKey, "", 40)
    val above = dao.getTitlePageBeforeDescending(anchor.sortKey, "", 40)
    assertEquals("F", SortKeys.sectionLabel(at.first().title))
    assertTrue(above.all { SortKeys.sectionLabel(it.title) != "F" })
    val anchorIndex = expected.indexOfFirst { it.path == at.first().path }
    assertEquals(
      expected.subList(anchorIndex - above.size, anchorIndex).map { it.path },
      above.reversed().map { it.path },
    )
    assertTrue(
      dao.getTitlePageBeforeDescending(expected.first().titleSortKey, expected.first().path, 40)
        .isEmpty(),
    )
  }

  @Test
  fun trackDirectionsReverseOnlyThePrimaryField() = runBlocking {
    val rows = listOf(
      track("g1", 1, "Zulu Beta").copy(
        artist = "Zulu",
        artistSortKey = SortKeys.forText("Zulu"),
        album = "Beta",
        albumSortKey = SortKeys.forText("Beta"),
        addedAt = 30,
        duration = 300.0,
      ),
      track("g1", 2, "Zulu Alpha").copy(
        artist = "Zulu",
        artistSortKey = SortKeys.forText("Zulu"),
        album = "Alpha",
        albumSortKey = SortKeys.forText("Alpha"),
        addedAt = 10,
        duration = 100.0,
      ),
      track("g1", 3, "Alpha Gamma").copy(
        artist = "Alpha",
        artistSortKey = SortKeys.forText("Alpha"),
        album = "Gamma",
        albumSortKey = SortKeys.forText("Gamma"),
        addedAt = 20,
        duration = 200.0,
      ),
    )
    publish("g1", rows)
    val dao = catalog.catalogDao()
    assertEquals(
      listOf(rows[1].path, rows[0].path, rows[2].path),
      dao.getArtistOrderPageDescending(null, "", 0, 0, "", "", 10).map { it.path },
    )
    assertEquals(
      listOf(rows[1].path, rows[2].path, rows[0].path),
      dao.getRecentlyAddedPageAscending(null, "", 10).map { it.path },
    )
    assertEquals(
      listOf(rows[1].path, rows[2].path, rows[0].path),
      dao.getDurationPageAscending(null, "", 10).map { it.path },
    )
    assertEquals(
      dao.getArtistOrderPageDescending(null, "", 0, 0, "", "", 10).map { it.path },
      dao.getAllPathsByArtistDescending(),
    )
    assertEquals(
      dao.getTitlePageDescending(null, "", 10).map { it.path },
      dao.getAllPathsByTitleDescending(),
    )
    assertEquals(
      dao.getRecentlyAddedPageAscending(null, "", 10).map { it.path },
      dao.getAllPathsByRecentlyAddedAscending(),
    )
    assertEquals(
      dao.getDurationPageAscending(null, "", 10).map { it.path },
      dao.getAllPathsByDurationAscending(),
    )
  }

  @Test
  fun albumAndArtistSummaryQueriesSupportBothDirections() = runBlocking {
    val dao = catalog.catalogDao()
    val revision = 7L
    dao.putAlbumSummaries(
      listOf(
        AlbumSummaryEntity(
          revision = revision,
          identityKey = "z-beta",
          album = "Beta",
          artist = "Zulu",
          year = 2020,
          trackCount = 1,
          totalDuration = 1.0,
          latestAddedAt = 30,
          nameSortKey = SortKeys.forText("Beta"),
          artistSortKey = SortKeys.forText("Zulu"),
          sectionLabel = "B",
          isSingle = false,
        ),
        AlbumSummaryEntity(
          revision = revision,
          identityKey = "z-alpha",
          album = "Alpha",
          artist = "Zulu",
          year = null,
          trackCount = 1,
          totalDuration = 1.0,
          latestAddedAt = 10,
          nameSortKey = SortKeys.forText("Alpha"),
          artistSortKey = SortKeys.forText("Zulu"),
          sectionLabel = "A",
          isSingle = false,
        ),
        AlbumSummaryEntity(
          revision = revision,
          identityKey = "a-gamma",
          album = "Gamma",
          artist = "Alpha",
          year = 1990,
          trackCount = 1,
          totalDuration = 1.0,
          latestAddedAt = 20,
          nameSortKey = SortKeys.forText("Gamma"),
          artistSortKey = SortKeys.forText("Alpha"),
          sectionLabel = "G",
          isSingle = false,
        ),
      ),
    )
    assertEquals(
      listOf("z-alpha", "z-beta", "a-gamma"),
      dao.getAlbumArtistPageDescending(revision, true, null, "", "", 10)
        .map { it.identityKey },
    )
    assertEquals(
      listOf("a-gamma", "z-beta", "z-alpha"),
      dao.getAlbumNamePageDescending(revision, true, null, "", 10)
        .map { it.identityKey },
    )
    assertEquals(
      listOf("a-gamma"),
      dao.getAlbumNamePageBeforeDescending(
        revision,
        true,
        SortKeys.forText("Beta"),
        "z-beta",
        10,
      ).map { it.identityKey },
    )
    assertEquals(
      listOf("a-gamma", "z-beta", "z-alpha"),
      dao.getAlbumYearPageAscending(revision, true, 0, null, "", "", 10)
        .map { it.identityKey },
    )
    assertEquals(
      listOf("z-alpha", "a-gamma", "z-beta"),
      dao.getAlbumRecentPageAscending(revision, true, null, "", 10)
        .map { it.identityKey },
    )

    dao.putArtistSummaries(
      listOf(
        artistSummary(revision, "zulu", "Zulu", 2),
        artistSummary(revision, "alpha", "Alpha", 2),
        artistSummary(revision, "beta", "Beta", 1),
      ),
    )
    assertEquals(
      listOf("Zulu", "Beta", "Alpha"),
      dao.getArtistNamePageDescending(revision, "astra", true, null, "", 10)
        .map { it.artist },
    )
    assertEquals(
      listOf("Zulu"),
      dao.getArtistNamePageBeforeDescending(
        revision,
        "astra",
        true,
        SortKeys.forText("Beta"),
        "beta",
        10,
      ).map { it.artist },
    )
    assertEquals(
      listOf("Beta", "Alpha", "Zulu"),
      dao.getArtistCountPageAscending(revision, "astra", true, null, "", "", 10)
        .map { it.artist },
    )
  }

  @Test
  fun structuredArtistCreditsPreserveNamesContainingPunctuation() = runBlocking {
    val artistNames = listOf("Earth, Wind & Fire", "The Emotions")
    val display = formatArtistNames(artistNames)
    publish(
      "credits",
      listOf(
        track("credits", 0, "Best of My Love").copy(
          artist = display,
          artistNamesJson = serializeArtistNames(artistNames),
          artistSortKey = SortKeys.forText(display),
        ),
      ),
    )
    val dao = catalog.catalogDao()
    val revision = dao.getRevision()

    val astraArtists = dao.getAllArtistSummaries(revision, "astra")
    assertEquals(setOf("Earth, Wind & Fire", "The Emotions"), astraArtists.map { it.artist }.toSet())
    assertEquals(
      1,
      dao.countArtistTracks(revision, "astra", "earth, wind & fire", "song"),
    )
    assertEquals(
      1,
      dao.countArtistTracks(revision, "astra", "the emotions", "appearance"),
    )
    assertEquals(
      listOf(display),
      dao.getAllArtistSummaries(revision, "fileTags").map { it.artist },
    )
  }

  @Test
  fun staleArtistCreditVersionAdvancesOnlyWhenGenerationPublishes() = runBlocking {
    val dao = catalog.catalogDao()
    dao.insertMeta(CatalogMetaEntity(collationVersion = COLLATION_VERSION, updatedAt = 0))
    dao.putSource(
      CatalogSourceEntity(
        sourceKey = "local:1",
        sourceType = "local",
        sourceId = 1,
        activeGenerationId = null,
        updatedAt = 0,
        artistCreditVersion = LEGACY_ARTIST_CREDIT_VERSION,
      ),
    )

    dao.insertGeneration(ScanGenerationEntity("cancelled", "local:1", "staging", 1))
    dao.deleteGenerationTracks("cancelled")
    dao.deleteGeneration("cancelled")
    assertEquals(LEGACY_ARTIST_CREDIT_VERSION, dao.getSource("local:1")?.artistCreditVersion)

    dao.insertGeneration(ScanGenerationEntity("complete", "local:1", "staging", 2))
    dao.publishGeneration(
      sourceKey = "local:1",
      generationId = "complete",
      previousGenerationId = null,
      now = 2,
      albumIdentityUpdates = emptyList(),
      albums = emptyList(),
      artists = emptyList(),
      artistTrackIndex = emptyList(),
      directories = emptyList(),
      ftsRows = emptyList(),
      artistCreditVersion = CURRENT_ARTIST_CREDIT_VERSION,
    )
    assertEquals(CURRENT_ARTIST_CREDIT_VERSION, dao.getSource("local:1")?.artistCreditVersion)
  }

  @Test
  fun listeningStatsCheckpointIsIdempotentAndClearPreservesProtectedHistory() = runBlocking {
    val path = "content://track/listening.flac"
    publish("listening", listOf(track("listening", 1, "Headphones On", path)))
    val status = ListeningStatsEngine.status(user)
    val generation = status.getValue("generation") as String
    val startedAt = System.currentTimeMillis() - 20_000
    val common = mapOf<String, Any?>(
      "generation" to generation,
      "sessionKey" to "session-1",
      "segmentKey" to "segment-1",
      "trackPath" to path,
      "sessionStartedAt" to startedAt,
      "segmentStartedAt" to startedAt,
      "trackDurationSeconds" to 181.0,
      "qualificationEligible" to true,
      "completedNaturally" to false,
      "finalizeSegment" to false,
      "finalizeSession" to false,
    )

    ListeningStatsEngine.checkpoint(
      user,
      catalog.catalogDao(),
      common + mapOf(
        "observedAt" to startedAt + 10_000,
        "sessionListenedSeconds" to 10.0,
        "segmentListenedSeconds" to 10.0,
      ),
    )
    val qualified = ListeningStatsEngine.checkpoint(
      user,
      catalog.catalogDao(),
      common + mapOf(
        "observedAt" to startedAt + 15_000,
        "sessionListenedSeconds" to 15.0,
        "segmentListenedSeconds" to 15.0,
      ),
    )
    val duplicate = ListeningStatsEngine.checkpoint(
      user,
      catalog.catalogDao(),
      common + mapOf(
        "observedAt" to startedAt + 15_000,
        "sessionListenedSeconds" to 15.0,
        "segmentListenedSeconds" to 15.0,
      ),
    )

    assertEquals(true, qualified["qualifiedNow"])
    assertEquals(false, duplicate["qualifiedNow"])
    assertEquals(1L, user.userDao().getPlaybackHistory(path)?.playCount)

    val dashboard = ListeningStatsEngine.dashboard(
      user,
      catalog.catalogDao(),
      mapOf(
        "range" to "all",
        "rankingMetric" to "plays",
        "artistGroupingMode" to "astra",
        "now" to startedAt + 20_000,
      ),
    )
    val summary = dashboard.getValue("summary") as Map<*, *>
    assertEquals(15.0, (summary["listenedSeconds"] as Number).toDouble(), 0.001)
    assertEquals(1.0, (summary["qualifiedPlays"] as Number).toDouble(), 0.001)
    assertEquals(1.0, (summary["tracksPlayed"] as Number).toDouble(), 0.001)

    val cleared = ListeningStatsEngine.clear(user)
    assertNull(cleared["startedAt"])
    assertEquals(1L, user.userDao().getPlaybackHistory(path)?.playCount)
    assertEquals(0, user.userDao().getListeningSessionsInRange(generation, 0, Long.MAX_VALUE).size)
  }

  @Test
  fun listeningStatsExcludePausedGapAndRetainRemovedTrackMetadata() = runBlocking {
    val path = "content://track/removed.flac"
    publish("stats-old", listOf(track("stats-old", 2, "Song That Left", path)))
    val generation = ListeningStatsEngine.status(user).getValue("generation") as String
    val startedAt = System.currentTimeMillis() - 60_000
    val base = mapOf<String, Any?>(
      "generation" to generation,
      "sessionKey" to "session-split",
      "trackPath" to path,
      "sessionStartedAt" to startedAt,
      "trackDurationSeconds" to 182.0,
      "qualificationEligible" to true,
      "completedNaturally" to false,
    )
    ListeningStatsEngine.checkpoint(
      user,
      catalog.catalogDao(),
      base + mapOf(
        "segmentKey" to "segment-a",
        "segmentStartedAt" to startedAt,
        "observedAt" to startedAt + 5_000,
        "sessionListenedSeconds" to 5.0,
        "segmentListenedSeconds" to 5.0,
        "finalizeSegment" to true,
        "finalizeSession" to false,
      ),
    )
    ListeningStatsEngine.checkpoint(
      user,
      catalog.catalogDao(),
      base + mapOf(
        "segmentKey" to "segment-b",
        "segmentStartedAt" to startedAt + 35_000,
        "observedAt" to startedAt + 45_000,
        "sessionListenedSeconds" to 15.0,
        "segmentListenedSeconds" to 10.0,
        "finalizeSegment" to true,
        "finalizeSession" to true,
      ),
    )

    publish(
      "stats-new",
      listOf(track("stats-new", 3, "A Different Song")),
      previous = "stats-old",
    )
    val dashboard = ListeningStatsEngine.dashboard(
      user,
      catalog.catalogDao(),
      mapOf(
        "range" to "all",
        "rankingMetric" to "time",
        "artistGroupingMode" to "fileTags",
        "now" to startedAt + 55_000,
      ),
    )
    val summary = dashboard.getValue("summary") as Map<*, *>
    assertEquals(15.0, (summary["listenedSeconds"] as Number).toDouble(), 0.001)
    val topTrack = (dashboard.getValue("topTracks") as List<*>).single() as Map<*, *>
    assertEquals("Song That Left", topTrack["title"])
    assertEquals(false, topTrack["available"])
    assertNull(topTrack["trackPath"])
  }

  @Test
  fun listeningStatsShortTracksQualifyOnlyOnNaturalCompletion() = runBlocking {
    val path = "content://track/short.flac"
    publish(
      "stats-short",
      listOf(track("stats-short", 4, "Short Song", path).copy(duration = 5.0)),
    )
    val generation = ListeningStatsEngine.status(user).getValue("generation") as String
    val startedAt = System.currentTimeMillis() - 10_000
    suspend fun checkpoint(sessionKey: String, completedNaturally: Boolean): Map<String, Any?> =
      ListeningStatsEngine.checkpoint(
        user,
        catalog.catalogDao(),
        mapOf(
          "generation" to generation,
          "sessionKey" to sessionKey,
          "segmentKey" to "segment-$sessionKey",
          "trackPath" to path,
          "sessionStartedAt" to startedAt,
          "segmentStartedAt" to startedAt,
          "observedAt" to startedAt + 4_500,
          "sessionListenedSeconds" to 4.5,
          "segmentListenedSeconds" to 4.5,
          "trackDurationSeconds" to 5.0,
          "qualificationEligible" to true,
          "completedNaturally" to completedNaturally,
          "finalizeSegment" to true,
          "finalizeSession" to true,
        ),
      )

    assertEquals(false, checkpoint("manual", false)["qualifiedNow"])
    assertNull(user.userDao().getPlaybackHistory(path))
    assertEquals(true, checkpoint("natural", true)["qualifiedNow"])
    assertEquals(1L, user.userDao().getPlaybackHistory(path)?.playCount)
  }

  @Test
  fun resolveRebuildUsesSourceEvidenceAndReversesWhenAnAnchorIsRemoved() = runBlocking {
    val collaboration = track("g1", 0, "Collaboration").copy(artist = "Alpha & Beta", albumArtist = null)
    publish("g1", listOf(collaboration))
    val dao = catalog.catalogDao()
    assertEquals(listOf("Alpha & Beta"), deserializeArtistNames(dao.getActiveTrack(collaboration.path)!!.resolvedArtistNamesJson))
    val anchor = track("g2", 1, "Anchor").copy(artist = "Alpha", albumArtist = null)
    publish("g2", listOf(collaboration.copy(id = 0, generationId = "g2"), anchor), "g1")
    val resolved = dao.getActiveTrack(collaboration.path)!!
    assertEquals(listOf("Alpha", "Beta"), deserializeArtistNames(resolved.resolvedArtistNamesJson))
    assertNull(resolved.artistNamesJson)
    assertEquals("Alpha & Beta", resolved.artist)
    publish("g3", listOf(collaboration.copy(id = 0, generationId = "g3")), "g2")
    assertEquals(listOf("Alpha & Beta"), deserializeArtistNames(dao.getActiveTrack(collaboration.path)!!.resolvedArtistNamesJson))
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

  private fun artistSummary(
    revision: Long,
    key: String,
    name: String,
    count: Long,
  ): ArtistSummaryEntity = ArtistSummaryEntity(
    revision = revision,
    artistKey = key,
    artist = name,
    groupingMode = "astra",
    trackCount = count,
    primaryTrackCount = count,
    albumCount = 1,
    nameSortKey = SortKeys.forText(name),
    sectionLabel = SortKeys.sectionLabel(name),
    isCollaboration = false,
    artworkHashesJson = "[]",
  )

  private companion object {
    /** 26 letters x 10 tracks. */
    const val ALPHABET_SEED_SIZE = 260
  }
}
