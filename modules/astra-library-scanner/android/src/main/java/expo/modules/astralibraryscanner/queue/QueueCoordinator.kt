package expo.modules.astralibraryscanner.queue

import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Trace
import expo.modules.astralibraryscanner.data.ACTIVE_PLAYBACK_CONTEXT_ID
import expo.modules.astralibraryscanner.data.ActiveTrackView
import expo.modules.astralibraryscanner.data.AstraLibraryRepository
import expo.modules.astralibraryscanner.data.PlaybackQueueEntryEntity
import expo.modules.astralibraryscanner.data.PlaybackSessionEntity
import java.io.File
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

private const val FIRST_METADATA_ROWS = 64
private const val METADATA_CHUNK = 250
private const val MAX_CACHED_ROWS = 10_000

data class QueueRowModel(
  val entryId: Long,
  val position: Long,
  val trackPath: String,
  val title: String,
  val artist: String,
  val artworkThumbPath: String?,
  val durationSeconds: Double,
  val hydrated: Boolean,
)

data class NativeQueueSnapshot(
  val sessionId: String?,
  val revision: Long,
  val activePosition: Long,
  val totalCount: Int,
  val rows: List<QueueRowModel>,
  val loading: Boolean,
) {
  init {
    require(rows.all(QueueRowModel::hydrated)) {
      "Native queue snapshots must never expose unresolved fallback rows"
    }
  }

  companion object {
    val Empty = NativeQueueSnapshot(
      sessionId = null,
      revision = 0,
      activePosition = -1,
      totalCount = 0,
      rows = emptyList(),
      loading = false,
    )
  }
}

private data class PendingQueueMutation(
  val baseRevision: Long,
  val previousEntryIds: List<Long>,
)

class QueueCoordinator private constructor(
  context: Context,
) {
  private val applicationContext = context.applicationContext
  private val repository = AstraLibraryRepository.get(applicationContext)
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val mutationMutex = Mutex()
  private val traceCookie = AtomicInteger()
  private val listeners = CopyOnWriteArraySet<(NativeQueueSnapshot) -> Unit>()
  private val mutableSnapshot = MutableStateFlow(NativeQueueSnapshot.Empty)
  val snapshot: StateFlow<NativeQueueSnapshot> = mutableSnapshot.asStateFlow()

  private var observationJob: Job? = null
  private var hydrationGeneration = 0L
  @Volatile
  private var pendingMutation: PendingQueueMutation? = null
  @Volatile
  private var latestEntries: List<PlaybackQueueEntryEntity> = emptyList()
  private val metadataByPath =
    object : LinkedHashMap<String, ActiveTrackView?>(MAX_CACHED_ROWS, 0.75f, true) {
      override fun removeEldestEntry(
        eldest: MutableMap.MutableEntry<String, ActiveTrackView?>,
      ): Boolean = size > MAX_CACHED_ROWS
    }

  fun addListener(listener: (NativeQueueSnapshot) -> Unit) {
    listeners += listener
    listener(mutableSnapshot.value)
  }

  fun removeListener(listener: (NativeQueueSnapshot) -> Unit) {
    listeners -= listener
  }

  fun start() {
    if (observationJob != null) return
    observationJob = scope.launch {
      val dao = repository.userDb().userDao()
      combine(
        dao.observePlaybackSession(ACTIVE_PLAYBACK_CONTEXT_ID),
        dao.observeQueueEntries(ACTIVE_PLAYBACK_CONTEXT_ID),
      ) { session, entries -> session to entries }
        .collectLatest { (session, entries) ->
          publishAndHydrate(session, entries)
        }
    }
  }

  fun refresh() {
    scope.launch {
      val dao = repository.userDb().userDao()
      publishAndHydrate(
        dao.getPlaybackSession(ACTIVE_PLAYBACK_CONTEXT_ID),
        dao.getAllQueueEntries(ACTIVE_PLAYBACK_CONTEXT_ID),
      )
    }
  }

  suspend fun move(entryId: Long, targetEntryId: Long): Boolean =
    mutate { current ->
      val entries = latestEntries
      val from = entries.indexOfFirst { it.entryId == entryId }
      val to = entries.indexOfFirst { it.entryId == targetEntryId }
      if (from < 0 || to < 0 || from == to || from == current.activePosition.toInt()) {
        false
      } else {
        repository.mutatePlaybackContext(
          "move",
          mapOf("from" to from, "to" to to),
        )
        true
      }
    }

  suspend fun remove(entryIds: Set<Long>): Boolean =
    mutate { current ->
      val positions = latestEntries
        .mapIndexedNotNull { index, row ->
          index.takeIf {
            row.entryId in entryIds && index != current.activePosition.toInt()
          }
        }
      if (positions.isEmpty()) {
        false
      } else {
        repository.mutatePlaybackContext("remove", mapOf("positions" to positions))
        true
      }
    }

  suspend fun moveAfterActive(entryIds: Set<Long>): Boolean =
    mutate { current ->
      val positions = latestEntries
        .mapIndexedNotNull { index, row ->
          index.takeIf {
            row.entryId in entryIds && index != current.activePosition.toInt()
          }
        }
      if (positions.isEmpty()) {
        false
      } else {
        repository.mutatePlaybackContext(
          "moveManyAfterActive",
          mapOf("positions" to positions),
        )
        true
      }
    }

  fun positionForEntry(entryId: Long, expectedRevision: Long): Long? {
    val current = mutableSnapshot.value
    if (current.revision != expectedRevision) return null
    return latestEntries.firstOrNull { it.entryId == entryId }?.position
  }

  private suspend fun mutate(block: suspend (NativeQueueSnapshot) -> Boolean): Boolean =
    mutationMutex.withLock {
      traceAsync("AstraQueue.mutate") {
        val marker = PendingQueueMutation(
          baseRevision = mutableSnapshot.value.revision,
          previousEntryIds = latestEntries.map(PlaybackQueueEntryEntity::entryId),
        )
        pendingMutation = marker
        try {
          block(mutableSnapshot.value).also { changed ->
            if (!changed && pendingMutation === marker) pendingMutation = null
          }
        } catch (error: Throwable) {
          if (pendingMutation === marker) pendingMutation = null
          throw error
        }
      }
    }

  private suspend fun publishAndHydrate(
    session: PlaybackSessionEntity?,
    entries: List<PlaybackQueueEntryEntity>,
  ) {
    pendingMutation?.let { pending ->
      val incomingEntryIds = entries.map(PlaybackQueueEntryEntity::entryId)
      if (incomingEntryIds != pending.previousEntryIds) {
        if (pendingMutation === pending) pendingMutation = null
      } else if (
        session != null &&
        session.queueRevision > pending.baseRevision
      ) {
        // Room invalidates the session and queue Flow separately even though
        // the write itself is transactional. Ignore the brief mixed pair
        // ("new revision, old rows") so an optimistic drag/remove/play-next
        // never jumps back before the queue invalidation arrives.
        return
      }
    }
    val generation = ++hydrationGeneration
    if (session == null || entries.isEmpty()) {
      latestEntries = emptyList()
      publish(NativeQueueSnapshot.Empty)
      return
    }
    latestEntries = entries

    traceAsync("AstraQueue.rowHydration") {
      val activeIndex = session.activePosition
        .coerceIn(0L, (entries.size - 1).toLong())
        .toInt()
      val displayEntries = entries
        .subList(activeIndex, entries.size)
        .take(MAX_CACHED_ROWS)
      resolveMetadata(
        displayEntries.take(FIRST_METADATA_ROWS),
        generation,
      )
      if (generation != hydrationGeneration) return@traceAsync

      var loadedEnd = minOf(FIRST_METADATA_ROWS, displayEntries.size)
      while (
        loadedEnd < displayEntries.size &&
        metadataResolved(displayEntries[loadedEnd])
      ) {
        loadedEnd += 1
      }
      publishHydrated(
        session = session,
        totalCount = entries.size,
        entries = displayEntries,
        loadedEnd = loadedEnd,
      )

      var start = FIRST_METADATA_ROWS
      while (start < displayEntries.size && generation == hydrationGeneration) {
        val end = minOf(displayEntries.size, start + METADATA_CHUNK)
        resolveMetadata(displayEntries.subList(start, end), generation)
        if (generation != hydrationGeneration) return@traceAsync
        publishHydrated(
          session = session,
          totalCount = entries.size,
          entries = displayEntries,
          loadedEnd = end,
        )
        start += METADATA_CHUNK
      }
      if (generation == hydrationGeneration) {
        publish(mutableSnapshot.value.copy(loading = false))
      }
    }
  }

  private suspend fun <T> traceAsync(name: String, block: suspend () -> T): T {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return block()
    val cookie = traceCookie.incrementAndGet()
    Trace.beginAsyncSection(name, cookie)
    return try {
      block()
    } finally {
      Trace.endAsyncSection(name, cookie)
    }
  }

  private suspend fun resolveMetadata(
    entries: List<PlaybackQueueEntryEntity>,
    generation: Long,
  ) {
    if (entries.isEmpty() || generation != hydrationGeneration) return
    val unresolvedPaths = entries
      .map(PlaybackQueueEntryEntity::trackPath)
      .distinct()
      .filterNot(metadataByPath::containsKey)
    if (unresolvedPaths.isEmpty()) return
    val metadata = repository.nativeQueueTracks(unresolvedPaths)
      .associateBy(ActiveTrackView::path)
    if (generation != hydrationGeneration) return
    unresolvedPaths.forEach { path ->
      metadataByPath[path] = metadata[path]
    }
  }

  private fun publishHydrated(
    session: PlaybackSessionEntity,
    totalCount: Int,
    entries: List<PlaybackQueueEntryEntity>,
    loadedEnd: Int,
  ) {
    val rows = entries.take(loadedEnd).map { entry ->
      val track = metadataByPath[entry.trackPath]
      QueueRowModel(
        entryId = entry.entryId,
        position = entry.position,
        trackPath = entry.trackPath,
        title = track?.title
          ?.ifBlank { track.fileName }
          ?.ifBlank { readableFileName(entry.trackPath) }
          ?: readableFileName(entry.trackPath),
        artist = track?.artist?.ifBlank { "Unknown artist" } ?: "Unknown artist",
        artworkThumbPath = track?.artworkHash?.let { hash ->
          File(applicationContext.filesDir, "artwork-thumbs/${thumbFileName(hash)}").path
        },
        durationSeconds = track?.duration ?: 0.0,
        hydrated = true,
      )
    }
    publish(
      NativeQueueSnapshot(
        sessionId = session.id,
        revision = session.queueRevision,
        activePosition = session.activePosition,
        totalCount = totalCount,
        rows = rows,
        loading = loadedEnd < entries.size,
      ),
    )
  }

  private fun metadataResolved(entry: PlaybackQueueEntryEntity): Boolean =
    metadataByPath.containsKey(entry.trackPath)

  private fun readableFileName(path: String): String {
    val decoded = Uri.decode(path)
    val leaf = decoded
      .substringAfterLast('/')
      .substringAfterLast(':')
    return leaf.substringBeforeLast('.', leaf).ifBlank { "Unknown title" }
  }

  private fun publish(next: NativeQueueSnapshot) {
    mutableSnapshot.value = next
    listeners.forEach { it(next) }
  }

  private fun thumbFileName(hash: String): String {
    val stem = hash.substringBeforeLast('.', hash)
    return "$stem.jpg"
  }

  companion object {
    @Volatile
    private var instance: QueueCoordinator? = null

    fun get(context: Context): QueueCoordinator =
      instance ?: synchronized(this) {
        instance ?: QueueCoordinator(context).also { instance = it }
      }
  }
}
