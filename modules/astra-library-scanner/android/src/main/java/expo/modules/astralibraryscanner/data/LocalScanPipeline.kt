package expo.modules.astralibraryscanner.data

import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore

internal const val LOCAL_SCAN_WINDOW_SIZE = 96
private const val LOCAL_SCAN_WORKERS_PER_PROCESSOR = 3
private const val LOCAL_SCAN_MIN_WORKERS = 8
private const val LOCAL_SCAN_MAX_WORKERS = 24
private const val LOCAL_SCAN_CHANNEL_CAPACITY = 1
private const val LOCAL_SCAN_RETAINED_WINDOWS = LOCAL_SCAN_CHANNEL_CAPACITY + 1

internal fun localScanWorkerCount(
  availableProcessors: Int,
  itemCount: Int,
): Int {
  if (itemCount <= 0) return 0
  val processors = availableProcessors.coerceAtLeast(1)
  val target = (processors * LOCAL_SCAN_WORKERS_PER_PROCESSOR)
    .coerceIn(LOCAL_SCAN_MIN_WORKERS, LOCAL_SCAN_MAX_WORKERS)
  return minOf(target, itemCount)
}

/**
 * Extracts ordered windows in parallel while a single consumer commits them.
 *
 * The capacity-one channel plus the two-permit window guard allows one window to be
 * written while the next is extracted, without starting a third retained window.
 */
internal suspend fun <Input, Output : Any> runBoundedLocalScanPipeline(
  items: List<Input>,
  workerCount: Int,
  windowSize: Int = LOCAL_SCAN_WINDOW_SIZE,
  process: suspend (Input) -> Output,
  writeWindow: suspend (List<Output>) -> Unit,
  onWindowCommitted: (processed: Int, total: Int) -> Unit = { _, _ -> },
) {
  if (items.isEmpty()) return
  require(workerCount > 0) { "workerCount must be positive" }
  require(windowSize > 0) { "windowSize must be positive" }

  coroutineScope {
    val completedWindows = Channel<List<Output>>(capacity = LOCAL_SCAN_CHANNEL_CAPACITY)
    val retainedWindowSlots = Semaphore(LOCAL_SCAN_RETAINED_WINDOWS)
    val producer = launch(Dispatchers.IO) {
      try {
        for (inputWindow in items.chunked(windowSize)) {
          currentCoroutineContext().ensureActive()
          retainedWindowSlots.acquire()
          var handedToWriter = false
          try {
            val outputWindow = processOrderedWindow(inputWindow, workerCount, process)
            completedWindows.send(outputWindow)
            handedToWriter = true
          } finally {
            if (!handedToWriter) retainedWindowSlots.release()
          }
        }
      } finally {
        completedWindows.close()
      }
    }

    var processed = 0
    try {
      for (window in completedWindows) {
        try {
          writeWindow(window)
        } finally {
          retainedWindowSlots.release()
        }
        processed += window.size
        onWindowCommitted(processed, items.size)
      }
      producer.join()
    } finally {
      completedWindows.cancel()
    }
  }
}

private suspend fun <Input, Output : Any> processOrderedWindow(
  items: List<Input>,
  requestedWorkerCount: Int,
  process: suspend (Input) -> Output,
): List<Output> = coroutineScope {
  val nextIndex = AtomicInteger()
  val results = MutableList<Output?>(items.size) { null }
  val workers = List(minOf(requestedWorkerCount, items.size)) {
    launch {
      while (true) {
        currentCoroutineContext().ensureActive()
        val index = nextIndex.getAndIncrement()
        if (index >= items.size) break
        results[index] = process(items[index])
      }
    }
  }
  workers.joinAll()
  results.map { checkNotNull(it) }
}
