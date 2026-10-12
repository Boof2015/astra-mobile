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
class PlaybackSelectionTest {
  private lateinit var user: AstraUserDatabase
  private val sessionId = "active-context"

  @Before
  fun open() {
    user = Room.inMemoryDatabaseBuilder(
      ApplicationProvider.getApplicationContext<Context>(), AstraUserDatabase::class.java,
    ).allowMainThreadQueries().build()
  }

  @After
  fun close() = user.close()

  private suspend fun seed(shuffle: Boolean = false) {
    val session = PlaybackSessionEntity(sessionId, "{}", "a", if (shuffle) 42 else null,
      0, 100, 100, nextEntryId = 3)
    user.userDao().replacePlaybackQueue(session,
      listOf("a", "b", "x").mapIndexed { index, path ->
        PlaybackQueueEntryEntity(sessionId, index.toLong(), path, index.toLong())
      },
      if (shuffle) listOf("a", "x", "b").mapIndexed { index, path ->
        PlaybackOriginalQueueEntryEntity(sessionId, index.toLong(), path,
          when (path) { "a" -> 0; "b" -> 1; else -> 2 })
      } else emptyList(),
    )
  }

  @Test
  fun insertSelectAndOriginalOrderPreserveOccurrences() = runBlocking {
    seed(shuffle = true)
    val dao = user.userDao()
    assertEquals(1L, dao.insertAndSelectPlaybackTrack(sessionId, 100, 0, "x"))
    val entries = dao.getAllQueueEntries(sessionId)
    assertEquals(listOf("a", "x", "b", "x"), entries.map { it.trackPath })
    assertEquals(listOf(0L, 3L, 1L, 2L), entries.map { it.entryId })
    assertEquals(listOf(0L, 1L, 2L, 3L), entries.map { it.position })
    assertEquals(listOf(0L, 3L, 2L, 1L), dao.getOriginalQueueEntries(sessionId).map { it.entryId })
    val session = dao.getPlaybackSession(sessionId)!!
    assertEquals(1L, session.activePosition)
    assertEquals("x", session.anchorPath)
    assertEquals(42L, session.shuffleSeed)
    assertEquals(100L, session.createdAt)
    assertEquals(4L, session.nextEntryId)
    assertTrue(session.isDirty)
  }

  @Test
  fun nativeAnchorWinsOverDelayedSavedPositionAndSameSongDoesNotDuplicate() = runBlocking {
    seed()
    val dao = user.userDao()
    assertEquals(2L, dao.insertAndSelectPlaybackTrack(sessionId, 100, 1, "new"))
    assertEquals(listOf("a", "b", "new", "x"), dao.getAllQueueEntries(sessionId).map { it.trackPath })
    val before = dao.getAllQueueEntries(sessionId)
    assertEquals(2L, dao.insertAndSelectPlaybackTrack(sessionId, 100, 3, "new"))
    assertEquals(before, dao.getAllQueueEntries(sessionId))
  }

  @Test
  fun unavailableTrackStaleSessionAndRemovedAnchorLeaveQueueUntouched() = runBlocking {
    seed(shuffle = true)
    val dao = user.userDao()
    val session = dao.getPlaybackSession(sessionId)
    val entries = dao.getAllQueueEntries(sessionId)
    val original = dao.getOriginalQueueEntries(sessionId)
    assertTrue(runCatching { dao.insertAndSelectPlaybackTrack(sessionId, 100, 0, null) }.isFailure)
    assertTrue(runCatching { dao.insertAndSelectPlaybackTrack(sessionId, 99, 0, "x") }.isFailure)
    assertTrue(runCatching { dao.insertAndSelectPlaybackTrack(sessionId, 100, 99, "x") }.isFailure)
    assertEquals(session, dao.getPlaybackSession(sessionId))
    assertEquals(entries, dao.getAllQueueEntries(sessionId))
    assertEquals(original, dao.getOriginalQueueEntries(sessionId))
  }

  @Test
  fun failedInsertRollsBackSelectionAndBothOrders() = runBlocking {
    seed(shuffle = true)
    val dao = user.userDao()
    val session = dao.getPlaybackSession(sessionId)
    val entries = dao.getAllQueueEntries(sessionId)
    val original = dao.getOriginalQueueEntries(sessionId)
    user.openHelper.writableDatabase.execSQL("""
      CREATE TRIGGER reject_insert BEFORE INSERT ON playback_queue_entries
      WHEN NEW.entry_id = 3 BEGIN SELECT RAISE(ABORT, 'test insertion failure'); END
    """.trimIndent())
    assertTrue(runCatching { dao.insertAndSelectPlaybackTrack(sessionId, 100, 0, "x") }.isFailure)
    assertEquals(session, dao.getPlaybackSession(sessionId))
    assertEquals(entries, dao.getAllQueueEntries(sessionId))
    assertEquals(original, dao.getOriginalQueueEntries(sessionId))
  }

  @Test
  fun emptyReplacementCannotEraseTheSavedQueue() = runBlocking {
    seed(shuffle = true)
    val dao = user.userDao()
    val session = dao.getPlaybackSession(sessionId)!!
    val entries = dao.getAllQueueEntries(sessionId)
    val original = dao.getOriginalQueueEntries(sessionId)
    assertTrue(runCatching {
      dao.replacePlaybackQueue(session.copy(contextJson = """{"kind":"search"}"""),
        emptyList(), replaceIdentity = true)
    }.isFailure)
    assertEquals(session, dao.getPlaybackSession(sessionId))
    assertEquals(entries, dao.getAllQueueEntries(sessionId))
    assertEquals(original, dao.getOriginalQueueEntries(sessionId))
  }
}
