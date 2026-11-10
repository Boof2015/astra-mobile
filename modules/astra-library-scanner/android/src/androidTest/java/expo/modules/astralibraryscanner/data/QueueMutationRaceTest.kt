package expo.modules.astralibraryscanner.data

import android.util.Log
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlin.random.Random
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

private const val TAG = "QueueMutationRace"
private const val QUEUE_SIZE = 12
private const val CONCURRENT_ADDS = 4
private const val ROUNDS = 300

/**
 * Overlapping "play next" calls must never corrupt the stored queue.
 *
 * Queue positions are a dense `0..n-1` column, and the queue sheet, the
 * playback window and Android Auto all read them as indices. Two additions
 * that overlap used to be able to hand the same entry id to two rows; the
 * upsert then moved the existing row instead of inserting, leaving a hole the
 * sheet rendered as "Nothing playing" above the song that was playing.
 */
@RunWith(AndroidJUnit4::class)
class QueueMutationRaceTest {
  @Test
  fun overlappingAdditionsKeepPositionsDenseAndLoseNothing() = runBlocking {
    val repository = AstraLibraryRepository.get(ApplicationProvider.getApplicationContext())
    val tree = "content://queue-race-test/${System.nanoTime()}"
    val folderId = (repository.registerFolder(tree, "Queue race regression")["id"] as Number).toLong()
    val paths = (1..QUEUE_SIZE + CONCURRENT_ADDS).map { "$tree/$it.flac" }
    try {
      val files = paths.map { path -> LocalAudioFile(
        uri = path, name = path.substringAfterLast('/'), size = 1024, lastModified = 1,
        mimeType = "audio/flac", parentUri = tree, coverUri = null,
      ) }
      repository.scanLocalFolder(folderId, false, { files }, { file ->
        LocalAudioMetadata(ok = true, title = file.name, artist = "Queue race", album = tree,
          mimeType = "audio/flac", codecMime = "audio/flac", durationMs = 1000,
          sampleRate = 44100, channels = 2, bitsPerSample = 16)
      }, { _, _, _, _ -> })

      val queued = paths.take(QUEUE_SIZE)
      val spares = paths.drop(QUEUE_SIZE)
      val dao = repository.userDb().userDao()
      val random = Random(7)
      var holes = 0
      var dropped = 0
      var firstHole: String? = null

      repeat(ROUNDS) { round ->
        // Active track is the last one, as it was for the tester who hit this.
        repository.createPlaybackContext(
          mapOf("kind" to "manual", "paths" to queued, "round" to round),
          queued.last(),
          false,
          null,
        )
        val gate = CompletableDeferred<Unit>()
        coroutineScope {
          spares.map { path ->
            val stagger = random.nextLong(0, 4)
            async(Dispatchers.IO) {
              gate.await()
              delay(stagger)
              repository.mutatePlaybackContext("insertAfterActive", mapOf("paths" to listOf(path)))
            }
          }.also { gate.complete(Unit) }.awaitAll()
        }

        val entries = dao.getAllQueueEntries(ACTIVE_PLAYBACK_CONTEXT_ID)
        val positions = entries.map(PlaybackQueueEntryEntity::position)
        val dense = positions == positions.indices.map(Int::toLong)
        if (!dense) {
          holes += 1
          if (firstHole == null) {
            val session = dao.getPlaybackSession(ACTIVE_PLAYBACK_CONTEXT_ID)
            firstHole = "round $round: ${entries.size} rows at positions $positions, " +
              "entry ids ${entries.map(PlaybackQueueEntryEntity::entryId)}, " +
              "active_position ${session?.activePosition}, next_entry_id ${session?.nextEntryId}"
          }
        } else if (entries.size != QUEUE_SIZE + CONCURRENT_ADDS) {
          dropped += 1
        }
      }

      val summary = "$ROUNDS rounds of $CONCURRENT_ADDS overlapping adds: " +
        "$holes left a hole, $dropped dropped an add. First hole: $firstHole"
      Log.i(TAG, summary)
      assertEquals(summary, 0, holes)
      assertEquals(summary, 0, dropped)
    } finally {
      repository.userDb().userDao().deletePlaybackSession(ACTIVE_PLAYBACK_CONTEXT_ID)
      repository.removeFolder(folderId)
    }
  }
}
