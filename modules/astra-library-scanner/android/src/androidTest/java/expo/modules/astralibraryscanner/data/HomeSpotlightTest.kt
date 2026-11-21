package expo.modules.astralibraryscanner.data

import android.content.Context
import android.os.SystemClock
import android.util.Log
import androidx.room.Room
import androidx.room.withTransaction
import androidx.sqlite.db.SupportSQLiteProgram
import androidx.sqlite.db.SupportSQLiteQuery
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.util.UUID
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicInteger
import kotlin.random.Random
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class HomeSpotlightTest {
  private lateinit var database: AstraCatalogDatabase
  private val countReads = AtomicInteger()
  private val context get() = ApplicationProvider.getApplicationContext<Context>()
  private var diskName: String? = null

  @Before fun open() {
    database = Room.inMemoryDatabaseBuilder(context, AstraCatalogDatabase::class.java)
      .setQueryCallback({ sql, _ -> if (sql.startsWith("SELECT COUNT(*) FROM")) countReads.incrementAndGet() }, Executor { it.run() })
      .build()
  }

  @After fun close() {
    database.close()
    diskName?.let { context.deleteDatabase(it) }
  }

  private fun key(i: Int) = i.toString().padStart(6, '0')
  private fun album(i: Int, revision: Long = 0, single: Boolean = false) = AlbumSummaryEntity(
    revision = revision, identityKey = key(i), album = "Album ${key(i)}", artist = "Artist ${key(i)}",
    trackCount = if (single) 1 else 10, totalDuration = 1800.0, latestAddedAt = i.toLong(),
    nameSortKey = key(i), artistSortKey = key(i), sectionLabel = "A", isSingle = single,
  )
  private fun artist(i: Int, revision: Long = 0, collaboration: Boolean = false, mode: String = "astra") = ArtistSummaryEntity(
    revision = revision, artistKey = key(i), artist = "Artist ${key(i)}", groupingMode = mode,
    trackCount = 10, primaryTrackCount = if (collaboration) 0 else 10, albumCount = 1,
    nameSortKey = key(i), sectionLabel = "A", isCollaboration = collaboration, artworkHashesJson = "[]",
  )
  private suspend fun seed(albums: Int, artists: Int, revision: Long = 0, mixedFilters: Boolean = false) {
    val dao = database.catalogDao()
    dao.insertMeta(CatalogMetaEntity(collationVersion = COLLATION_VERSION, updatedAt = 0))
    database.withTransaction {
      for (start in 0 until albums step 1000) dao.putAlbumSummaries((start until minOf(start + 1000, albums)).map {
        album(it, revision, mixedFilters && it % 2 == 0)
      })
      for (start in 0 until artists step 1000) dao.putArtistSummaries((start until minOf(start + 1000, artists)).map {
        artist(it, revision, mixedFilters && it % 2 == 0)
      })
    }
  }

  private fun remember(history: List<HomeSpotlightIdentity>, identity: HomeSpotlightIdentity) =
    (history.filter { it != identity } + identity).takeLast(HOME_SPOTLIGHT_HISTORY_LIMIT)

  @Test fun emptySingleAndExhaustedLibrariesStayUsable() = runBlocking {
    seed(0, 0)
    assertNull(HomeSpotlightData().select(database, false, "astra", false, emptyList()))
    seed(1, 0)
    val single = HomeSpotlightData()
    val only = single.select(database, false, "astra", false, emptyList())!!
    assertEquals(only, single.select(database, false, "astra", false, listOf(only.identity)))
    seed(2, 1)
    val data = HomeSpotlightData()
    var history = emptyList<HomeSpotlightIdentity>()
    repeat(3) {
      val pick = data.select(database, false, "astra", false, history)!!
      assertFalse(pick.identity in history)
      history = remember(history, pick.identity)
    }
    assertEquals(history.first(), data.select(database, false, "astra", false, history)!!.identity)
    // Deleted identities neither consume the fresh pool nor win the fallback.
    val removed = HomeSpotlightIdentity("album", "removed")
    assertEquals(history.first(), data.select(database, false, "astra", false, listOf(removed) + history)!!.identity)
  }

  @Test fun fullCatalogSelectionAvoidsTwentyRecentCardsAndBalancesKinds() = runBlocking {
    seed(60, 80)
    val data = HomeSpotlightData()
    val random = Random(571)
    var history = emptyList<HomeSpotlightIdentity>()
    val selected = mutableSetOf<HomeSpotlightIdentity>()
    var albums = 0
    repeat(600) {
      val pick = data.select(database, false, "astra", false, history, random = random)!!
      assertFalse(pick.identity in history)
      selected += pick.identity
      if (pick.identity.kind == "album") albums++
      history = remember(history, pick.identity)
    }
    assertTrue(albums in 250..350)
    assertTrue(selected.any { it.kind == "album" && it.key.toInt() < 40 }) // outside the newest 20
    assertTrue(selected.any { it.kind == "artist" && it.key.toInt() >= 50 })
    assertEquals("eligible counts should be cached across all rerolls", 2, countReads.get())
  }

  @Test fun freshKindWinsOverRecentKindAndFiltersApplyToRetentionToo() = runBlocking {
    seed(2, 2, mixedFilters = true)
    val data = HomeSpotlightData()
    val album = HomeSpotlightIdentity("album", key(1))
    val artist = HomeSpotlightIdentity("artist", key(1), "astra")
    assertEquals(artist, data.select(database, false, "astra", false, listOf(album))!!.identity)
    assertEquals(album, data.select(database, false, "astra", false, listOf(artist))!!.identity)
    assertEquals(album, data.select(database, false, "astra", false, listOf(album), retain = album)!!.identity)
    val single = HomeSpotlightIdentity("album", key(0))
    assertEquals(single, data.select(database, true, "astra", false, emptyList(), retain = single)!!.identity)
    assertNotEquals(single, data.select(database, false, "astra", false, emptyList(), retain = single)!!.identity)
    val collab = HomeSpotlightIdentity("artist", key(0), "astra")
    assertEquals(collab, data.select(database, false, "astra", true, emptyList(), retain = collab)!!.identity)
    assertNotEquals(collab, data.select(database, false, "astra", false, emptyList(), retain = collab)!!.identity)
    database.catalogDao().putArtistSummaries(listOf(artist(9, mode = "fileTags")))
    val fileTags = HomeSpotlightIdentity("artist", key(9), "fileTags")
    assertEquals(fileTags, data.select(database, false, "fileTags", false, listOf(album, artist), random = Random(0))!!.identity)
  }

  @Test fun catalogRevisionInvalidatesCountsAndRemovedCurrentIsReplaced() = runBlocking {
    seed(1, 0)
    val data = HomeSpotlightData()
    val previous = data.select(database, false, "astra", false, emptyList())!!
    database.catalogDao().putAlbumSummaries(listOf(album(99, revision = 1)))
    database.catalogDao().incrementRevision(1)
    val next = data.select(database, false, "astra", false, listOf(previous.identity), retain = previous.identity)!!
    assertEquals(key(99), next.identity.key)
    assertEquals(1L, next.revision)
    assertEquals(4, countReads.get())
  }

  @Test fun queriesUseIndexOrderingAndOnlyReturnRequestedKeys() = runBlocking {
    seed(60, 80, mixedFilters = true)
    val dao = database.catalogDao()
    for (kind in listOf("album", "artist")) {
      for (filtered in listOf(false, true)) {
        val query = HomeSpotlightQuery(kind, 0, !filtered, "astra", !filtered)
        val excluded = listOf(key(1), key(3))
        val count = dao.runDynamicCountQuery(query.count()) - excluded.size
        val statement = query.pick(excluded, count - 1)
        val result = dao.getHomeSpotlightKeys(statement)
        assertEquals(1, result.size)
        assertEquals(key(if (kind == "album") 59 else 79), result.single().key)
        val explain = object : SupportSQLiteQuery {
          override val sql get() = "EXPLAIN QUERY PLAN ${statement.sql}"
          override val argCount get() = statement.argCount
          override fun bindTo(statementToBind: SupportSQLiteProgram) = statement.bindTo(statementToBind)
        }
        val plan = database.openHelper.readableDatabase.query(explain).use { cursor ->
          buildList { while (cursor.moveToNext()) add(cursor.getString(3)) }.joinToString("\n")
        }
        assertTrue(plan, plan.contains("INDEX"))
        assertFalse(plan, plan.contains("USE TEMP B-TREE"))
      }
    }
  }

  /** Opt-in device benchmark: isolated on-disk summary tables, no user library changes. */
  @Test fun benchmarkLargeCatalogs() = runBlocking {
    assumeTrue(InstrumentationRegistry.getArguments().getString("astraHomeSpotlightBenchmark") == "true")
    database.close()
    val name = "home-spotlight-benchmark-${UUID.randomUUID()}.db"
    diskName = name
    database = Room.databaseBuilder(context, AstraCatalogDatabase::class.java, name)
      .setJournalMode(androidx.room.RoomDatabase.JournalMode.WRITE_AHEAD_LOGGING).build()
    for (size in listOf(1_000, 10_000, 100_000)) {
      seed(size, size, mixedFilters = true)
      for (filtered in listOf(false, true)) {
        val data = HomeSpotlightData()
        val random = Random(42)
        var history = emptyList<HomeSpotlightIdentity>()
        var started = SystemClock.elapsedRealtimeNanos()
        val first = data.select(database, !filtered, "astra", !filtered, history, random = random)!!
        val coldMs = (SystemClock.elapsedRealtimeNanos() - started) / 1_000_000.0
        history = remember(history, first.identity)
        repeat(25) { history = remember(history, data.select(database, !filtered, "astra", !filtered, history, random = random)!!.identity) }
        val timings = mutableListOf<Double>()
        repeat(100) {
          started = SystemClock.elapsedRealtimeNanos()
          val result = data.select(database, !filtered, "astra", !filtered, history, random = random)!!
          timings += (SystemClock.elapsedRealtimeNanos() - started) / 1_000_000.0
          assertFalse(result.identity in history)
          history = remember(history, result.identity)
        }
        timings.sort()
        val line = "rowsPerKind=$size filtered=$filtered coldMs=$coldMs p50Ms=${timings[49]} p95Ms=${timings[94]} maxMs=${timings.last()}"
        Log.i("AstraHomeSpotlight", line)
        assertTrue(line, timings[94] < 100.0)
      }
    }
  }
}
