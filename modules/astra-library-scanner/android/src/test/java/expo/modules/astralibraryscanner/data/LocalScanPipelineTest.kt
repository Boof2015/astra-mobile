package expo.modules.astralibraryscanner.data

import java.util.Collections
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class LocalScanPipelineTest {
  @Test
  fun workerCountClampsToProcessorsLimitsAndItems() {
    assertEquals(0, localScanWorkerCount(16, 0))
    assertEquals(1, localScanWorkerCount(16, 1))
    assertEquals(8, localScanWorkerCount(1, 20))
    assertEquals(12, localScanWorkerCount(4, 20))
    assertEquals(20, localScanWorkerCount(32, 20))
    assertEquals(24, localScanWorkerCount(32, 100))
    assertEquals(3, localScanWorkerCount(8, 3))
  }

  @Test
  fun outputStaysOrderedAndWritesFullAndPartialWindows() = runBlocking {
    val writes = mutableListOf<List<Int>>()
    val progress = mutableListOf<Int>()

    runBoundedLocalScanPipeline(
      items = (0 until 205).toList(),
      workerCount = 8,
      process = { value ->
        delay(((7 - value % 8) + 1).toLong())
        value
      },
      writeWindow = { writes += it },
      onWindowCommitted = { processed, total ->
        assertEquals(205, total)
        progress += processed
      },
    )

    assertEquals(listOf(96, 96, 13), writes.map(List<Int>::size))
    assertEquals((0 until 205).toList(), writes.flatten())
    assertEquals(listOf(96, 192, 205), progress)
  }

  @Test
  fun activeExtractionNeverExceedsWorkerCount() = runBlocking {
    val active = AtomicInteger()
    val maximum = AtomicInteger()

    runBoundedLocalScanPipeline(
      items = (0 until 24).toList(),
      workerCount = 3,
      windowSize = 24,
      process = { value ->
        val current = active.incrementAndGet()
        maximum.getAndUpdate { previous -> maxOf(previous, current) }
        try {
          delay(10)
          value
        } finally {
          active.decrementAndGet()
        }
      },
      writeWindow = {},
    )

    assertEquals(3, maximum.get())
  }

  @Test
  fun extractionOfNextWindowOverlapsCurrentWrite() = runBlocking {
    val secondWindowStarted = CompletableDeferred<Unit>()
    val thirdWindowStarted = CompletableDeferred<Unit>()
    val writes = mutableListOf<List<Int>>()

    withTimeout(2_000) {
      runBoundedLocalScanPipeline(
        items = (0 until 6).toList(),
        workerCount = 2,
        windowSize = 2,
        process = { value ->
          if (value >= 2) secondWindowStarted.complete(Unit)
          if (value >= 4) thirdWindowStarted.complete(Unit)
          value
        },
        writeWindow = { window ->
          if (writes.isEmpty()) {
            secondWindowStarted.await()
            delay(50)
            assertFalse(thirdWindowStarted.isCompleted)
          }
          writes += window
        },
      )
    }

    assertEquals(listOf(listOf(0, 1), listOf(2, 3), listOf(4, 5)), writes)
  }

  @Test
  fun extractionFailureCancelsPipelineAndSkipsUncommittedWindows() = runBlocking {
    val processed = Collections.synchronizedList(mutableListOf<Int>())
    val writes = mutableListOf<List<Int>>()

    try {
      runBoundedLocalScanPipeline(
        items = (0 until 12).toList(),
        workerCount = 4,
        windowSize = 6,
        process = { value ->
          processed += value
          if (value == 3) error("parser failure")
          delay(20)
          value
        },
        writeWindow = { writes += it },
      )
      fail("Expected parser failure")
    } catch (error: IllegalStateException) {
      assertEquals("parser failure", error.message)
    }

    assertTrue(writes.isEmpty())
    assertTrue(processed.size < 12)
  }

  @Test
  fun writerFailureCancelsFurtherExtraction() = runBlocking {
    val active = AtomicInteger()
    val completed = AtomicInteger()

    try {
      runBoundedLocalScanPipeline(
        items = (0 until 30).toList(),
        workerCount = 2,
        windowSize = 5,
        process = { value ->
          active.incrementAndGet()
          try {
            delay(15)
            completed.incrementAndGet()
            value
          } finally {
            active.decrementAndGet()
          }
        },
        writeWindow = { error("database failure") },
      )
      fail("Expected database failure")
    } catch (error: IllegalStateException) {
      assertEquals("database failure", error.message)
    }

    assertEquals(0, active.get())
    assertTrue(completed.get() < 30)
  }
}
