package expo.modules.astralibraryscanner.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ArtistImageClearTest {
  private lateinit var user: AstraUserDatabase
  private val modes = listOf("astra", "fileTags")

  @Before
  fun openDatabase() {
    user = Room.inMemoryDatabaseBuilder(
      ApplicationProvider.getApplicationContext<Context>(), AstraUserDatabase::class.java,
    ).allowMainThreadQueries().build()
  }

  @After
  fun closeDatabase() = user.close()

  private suspend fun seed(): List<ArtistImageEntity> {
    val rows = modes.flatMap { mode ->
      listOf("found", "not_found", "transient_error").map { status ->
        ArtistImageEntity(
          groupingMode = mode, artistKey = status, artistName = status,
          manualImageHash = "custom-$status.webp",
          automaticImageHash = if (status == "not_found") null else "deezer.jpg",
          automaticProvider = "deezer", automaticSourceId = "42",
          lookupStatus = status, retryCount = 2, lastAttemptAt = 10,
          nextRetryAt = 30, updatedAt = 20,
        )
      }
    }
    user.userDao().putArtistImages(rows)
    user.userDao().putSettings(listOf(
      SettingEntity("artist_image_auto_policy", "any"), SettingEntity("theme", "midnight"),
    ))
    return rows
  }

  @Test
  fun deezerClearPreservesCustomImagesAndResetsAllLookupStates() = runBlocking {
    val before = seed()
    val dao = user.userDao()
    dao.clearArtistImages("deezer", 100)
    for (original in before) {
      assertEquals(original.copy(
        automaticImageHash = null, automaticProvider = null, automaticSourceId = null,
        lookupStatus = "never", retryCount = 0, lastAttemptAt = null,
        nextRetryAt = null, updatedAt = 100,
      ), dao.getArtistImage(original.groupingMode, original.artistKey))
    }
    assertEquals("off", dao.getSetting("artist_image_auto_policy"))
    assertEquals("midnight", dao.getSetting("theme"))
    dao.clearArtistImages("deezer", 100)
    assertEquals(before.size, dao.getAllArtistImages().size)
  }

  @Test
  fun customClearPreservesDeezerImagesHistoryAndPolicy() = runBlocking {
    val before = seed()
    val dao = user.userDao()
    dao.clearArtistImages("manual", 100)
    for (original in before) {
      assertEquals(original.copy(manualImageHash = null, updatedAt = 100),
        dao.getArtistImage(original.groupingMode, original.artistKey))
    }
    assertEquals("any", dao.getSetting("artist_image_auto_policy"))
    val once = dao.getAllArtistImages()
    dao.clearArtistImages("manual", 200)
    assertEquals(once, dao.getAllArtistImages())
  }

  @Test
  fun emptyLibraryAndAlreadyDisabledDownloadsCanBeCleared() = runBlocking {
    val dao = user.userDao()
    dao.clearArtistImages("manual", 100)
    assertNull(dao.getSetting("artist_image_auto_policy"))
    dao.clearArtistImages("deezer", 100)
    dao.clearArtistImages("deezer", 200)
    assertTrue(dao.getAllArtistImages().isEmpty())
    assertEquals("off", dao.getSetting("artist_image_auto_policy"))
  }

  @Test
  fun policyWriteFailureRollsBackImageRemoval() = runBlocking {
    seed()
    val dao = user.userDao()
    val before = dao.getAllArtistImages()
    user.openHelper.writableDatabase.execSQL("""
      CREATE TRIGGER reject_policy BEFORE INSERT ON settings
      WHEN NEW.key = 'artist_image_auto_policy'
      BEGIN SELECT RAISE(ABORT, 'test write failure'); END
    """.trimIndent())
    assertTrue(runCatching { dao.clearArtistImages("deezer", 100) }.isFailure)
    assertEquals(before, dao.getAllArtistImages())
    assertEquals("any", dao.getSetting("artist_image_auto_policy"))
  }

  @Test
  fun invalidSourceLeavesDataUntouched() = runBlocking {
    seed()
    val before = user.userDao().getAllArtistImages()
    assertTrue(runCatching { user.userDao().clearArtistImages("invalid", 100) }.isFailure)
    assertEquals(before, user.userDao().getAllArtistImages())
    assertEquals("any", user.userDao().getSetting("artist_image_auto_policy"))
  }

  @Test
  fun clearedPortraitsUseTheExistingArtworkFallbacks() = runBlocking {
    val summary = ArtistSummaryEntity(
      revision = 1, artistKey = "artist", artist = "Artist", groupingMode = "astra",
      trackCount = 2, primaryTrackCount = 2, albumCount = 1, artworkHash = "album.jpg",
      nameSortKey = "artist", sectionLabel = "A", isCollaboration = false,
      artworkHashesJson = """["album.jpg"]""",
    )
    val original = ArtistImageEntity(
      groupingMode = "astra", artistKey = "artist", artistName = "Artist",
      manualImageHash = "custom.webp", automaticImageHash = "deezer.jpg",
      automaticProvider = "deezer", lookupStatus = "found", updatedAt = 1,
    )
    val dao = user.userDao()
    dao.putArtistImage(original)
    dao.clearArtistImages("deezer", 100)
    assertEquals("custom.webp", summary.toBridgeMap(dao.getArtistImage("astra", "artist"))["artwork_hash"])
    dao.putArtistImage(original)
    dao.clearArtistImages("manual", 200)
    assertEquals("deezer.jpg", summary.toBridgeMap(dao.getArtistImage("astra", "artist"))["artwork_hash"])
    dao.clearArtistImages("deezer", 300)
    val fallback = summary.toBridgeMap(dao.getArtistImage("astra", "artist"))
    assertEquals("album.jpg", fallback["artwork_hash"])
    assertEquals("track", fallback["artwork_source"])
  }

  @Test
  fun clearedLayersAndPolicySurviveSnapshotRestore() = runBlocking {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val directory = context.filesDir.resolve("astra-user-snapshots")
    directory.deleteRecursively()
    val snapshots = UserSnapshotStore(context)
    val restored = Room.inMemoryDatabaseBuilder(context, AstraUserDatabase::class.java)
      .allowMainThreadQueries().build()
    try {
      seed()
      for (source in listOf("deezer", "manual")) {
        user.userDao().clearArtistImages(source, 100)
        snapshots.write(user)
        snapshots.restore(restored, requireNotNull(snapshots.newestValid()))
        assertEquals(user.userDao().getAllArtistImages(), restored.userDao().getAllArtistImages())
        assertEquals("off", restored.userDao().getSetting("artist_image_auto_policy"))
      }
    } finally {
      restored.close()
      directory.deleteRecursively()
    }
  }
}
