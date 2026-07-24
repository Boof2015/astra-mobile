package expo.modules.astralibraryscanner.data

import android.content.Context
import android.database.sqlite.SQLiteDatabaseCorruptException
import android.database.sqlite.SQLiteException
import androidx.room.Room
import androidx.room.RoomDatabase
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.text.Normalizer
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArraySet
import kotlin.random.Random
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

private const val USER_DB_NAME = "astra-user.db"
private const val CATALOG_DB_NAME = "astra-catalog.db"
private const val LEGACY_DB_NAME = "astra-library.db"
private const val CUTOVER_PREFS = "astra-room-cutover"
private const val CUTOVER_COMPLETE = "room-cutover-v1-complete"
private const val SNAPSHOT_DEBOUNCE_MS = 2_000L
private const val MOBILE_SESSION_ID = "mobile"
private const val ACTIVE_PLAYBACK_CONTEXT_ID = "active-context"

class StaleRevisionException : IllegalStateException("STALE_REVISION")

internal fun boundedPlaybackWindowStart(start: Long, total: Long): Long? {
  val normalized = start.coerceAtLeast(0)
  return normalized.takeIf { it < total }
}

private data class RemoteSyncHandle(
  val syncId: String,
  val sourceKey: String,
  val sourceId: Long,
  val sourceType: String,
  val generationId: String,
  val previousGenerationId: String?,
  val startedAt: Long,
  val existingByPath: Map<String, TrackEntity>,
  val seenPaths: MutableSet<String> = ConcurrentHashMap.newKeySet(),
)

/**
 * Single owner for both Room files. Every app surface—including Android Auto—
 * reaches SQLite through this repository so connection and recovery policy
 * cannot diverge between JavaScript and native callers.
 */
class AstraLibraryRepository private constructor(
  private val context: Context,
) {
  private val applicationContext = context.applicationContext
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val bootstrapMutex = Mutex()
  private val catalogRecoveryMutex = Mutex()
  private val userRecoveryMutex = Mutex()
  private val catalogWriterMutex = Mutex()
  private val snapshotMutex = Mutex()
  private val listeners = CopyOnWriteArraySet<(LibraryStatusSnapshot) -> Unit>()
  private val catalogListeners = CopyOnWriteArraySet<(Long) -> Unit>()
  private val snapshots = UserSnapshotStore(applicationContext)
  private val remoteSyncs = ConcurrentHashMap<String, RemoteSyncHandle>()

  @Volatile
  private var initialized = false

  @Volatile
  private var userDatabase: AstraUserDatabase? = null

  @Volatile
  private var catalogDatabase: AstraCatalogDatabase? = null

  @Volatile
  private var currentStatus = LibraryStatusSnapshot(
    status = LibraryStatus.INITIALIZING,
    catalogRevision = 0,
    trackCount = 0,
  )

  private var pendingSnapshot: Job? = null
  private var catalogRecoveredAtBootstrap = false

  suspend fun initialize(): LibraryStatusSnapshot {
    if (initialized) return currentStatus
    return bootstrapMutex.withLock {
      if (initialized) return@withLock currentStatus

      updateStatus(LibraryStatus.INITIALIZING, 0, 0)
      val recoveryNotice = performLegacyCutoverIfNeeded()
      val userOpen = openUserDatabaseWithRecovery()
      if (userOpen == null) {
        updateStatus(
          LibraryStatus.FATAL_USER_DATA,
          0,
          0,
          message = "Astra could not restore its user database.",
          recoveryNotice = recoveryNotice,
        )
        initialized = true
        return@withLock currentStatus
      }
      userDatabase = userOpen

      val catalogOpen = openCatalogDatabaseWithRecovery()
      catalogDatabase = catalogOpen
      val dao = catalogOpen.catalogDao()
      val existingMeta = dao.getMeta()
      dao.insertMeta(
        CatalogMetaEntity(
          revision = 0,
          collationVersion = COLLATION_VERSION,
          updatedAt = System.currentTimeMillis(),
        ),
      )
      if (existingMeta != null && existingMeta.collationVersion < COLLATION_VERSION) {
        dao.migrateSectionLabels(COLLATION_VERSION, System.currentTimeMillis())
      }
      dao.discardAbandonedGenerations()
      reconcileUserFacts()

      val revision = dao.getRevision()
      val count = dao.countActiveTracks()
      val canRebuild = catalogRecoveredAtBootstrap &&
        userOpen.userDao().getFolders().any { folder ->
          applicationContext.contentResolver.persistedUriPermissions.any {
            it.uri.toString() == folder.treeUri
          }
        }
      updateStatus(
        when {
          canRebuild -> LibraryStatus.REBUILDING
          count == 0L -> LibraryStatus.EMPTY
          else -> LibraryStatus.READY
        },
        revision,
        count,
        message = if (canRebuild) "The catalog was damaged and is being rebuilt." else null,
        recoveryNotice = recoveryNotice,
      )
      initialized = true
      currentStatus
    }
  }

  fun addStatusListener(listener: (LibraryStatusSnapshot) -> Unit) {
    listeners.add(listener)
  }

  fun removeStatusListener(listener: (LibraryStatusSnapshot) -> Unit) {
    listeners.remove(listener)
  }

  fun addCatalogListener(listener: (Long) -> Unit) {
    catalogListeners.add(listener)
  }

  fun removeCatalogListener(listener: (Long) -> Unit) {
    catalogListeners.remove(listener)
  }

  fun status(): LibraryStatusSnapshot = currentStatus

  /**
   * Runs a bridge operation against the current user database and retries it
   * once after restoring the newest valid rotating snapshot if SQLite reports
   * runtime corruption. The damaged handle is never reused.
   */
  suspend fun <T> withUserRecovery(
    block: suspend AstraLibraryRepository.() -> T,
  ): T {
    initialize()
    val database = requireUser()
    return try {
      block()
    } catch (error: Throwable) {
      if (!isCorruption(error)) throw error
      userRecoveryMutex.withLock {
        if (userDatabase === database) {
          pendingSnapshot?.cancel()
          database.close()
          userDatabase = null
          quarantineDatabase(USER_DB_NAME, "user")
          val snapshot = snapshots.newestValid()
          if (snapshot == null) {
            updateStatus(
              LibraryStatus.FATAL_USER_DATA,
              currentStatus.catalogRevision,
              currentStatus.trackCount,
              message = "Astra could not restore its user database.",
              recoveryNotice = currentStatus.recoveryNotice,
            )
            throw error
          }
          val replacement = buildUserDatabase()
          try {
            forceOpen(replacement)
            snapshots.restore(replacement, snapshot)
            userDatabase = replacement
            reconcileUserFacts()
            refreshReadyStatus()
          } catch (restoreError: Throwable) {
            replacement.close()
            userDatabase = null
            updateStatus(
              LibraryStatus.FATAL_USER_DATA,
              currentStatus.catalogRevision,
              currentStatus.trackCount,
              message = "Astra could not restore its user database.",
              recoveryNotice = currentStatus.recoveryNotice,
            )
            throw restoreError
          }
        }
      }
      block()
    }
  }

  suspend fun getSettings(keys: List<String>): Map<String, String?> {
    initialize()
    val rows = requireUser().userDao().getSettings(keys)
    val byKey = rows.associate { it.key to it.value }
    return keys.associateWith { byKey[it] }
  }

  suspend fun setSettings(values: Map<String, String?>) {
    initialize()
    val dao = requireUser().userDao()
    val deletes = values.filterValues { it == null }.keys.toList()
    val writes = values.mapNotNull { (key, value) -> value?.let { SettingEntity(key, it) } }
    if (deletes.isNotEmpty()) dao.deleteSettings(deletes)
    if (writes.isNotEmpty()) dao.putSettings(writes)
    scheduleSnapshot()
  }

  suspend fun listFolders(): List<Map<String, Any?>> {
    initialize()
    val persisted = applicationContext.contentResolver.persistedUriPermissions
      .mapTo(hashSetOf()) { it.uri.toString() }
    val catalogDao = requireCatalog().catalogDao()
    return requireUser().userDao().getFolders().map { folder ->
      mapOf(
        "id" to folder.id.toDouble(),
        "tree_uri" to folder.treeUri,
        "display_name" to folder.displayName,
        "added_at" to folder.addedAt.toDouble(),
        "last_scanned_at" to folder.lastScannedAt?.toDouble(),
        "available" to persisted.contains(folder.treeUri),
        "scan_status" to folder.lastScanStatus,
        "scan_error" to folder.lastScanError,
        "track_count" to catalogDao.countActiveTracksForFolder(folder.id).toDouble(),
      )
    }
  }

  suspend fun getFolderNodes(parentNodeId: String?): List<Map<String, Any?>> {
    initialize()
    val catalogDao = requireCatalog().catalogDao()
    val revision = catalogDao.getRevision()
    val availability = applicationContext.contentResolver.persistedUriPermissions
      .mapTo(hashSetOf()) { it.uri.toString() }
    val folders = requireUser().userDao().getFolders().associateBy(FolderEntity::id)
    return catalogDao.getDirectoryChildren(revision, parentNodeId).map { node ->
      val folder = folders[node.folderId]
      mapOf(
        "id" to node.nodeId,
        "folderId" to node.folderId.toDouble(),
        "parentNodeId" to node.parentNodeId,
        "name" to (if (node.depth == 0) folder?.displayName ?: node.name else node.name),
        "depth" to node.depth,
        "directTrackCount" to node.directTrackCount.toDouble(),
        "totalTrackCount" to node.totalTrackCount.toDouble(),
        "available" to (folder != null && availability.contains(folder.treeUri)),
        "catalogRevision" to revision.toString(),
      )
    }
  }

  suspend fun getFolderTracks(
    nodeId: String,
    offset: Int,
    requestedLimit: Int,
  ): Map<String, Any?> {
    initialize()
    val dao = requireCatalog().catalogDao()
    val revision = dao.getRevision()
    val node = dao.getDirectoryNode(revision, nodeId)
      ?: return mapOf(
        "items" to emptyList<Map<String, Any?>>(),
        "nextOffset" to null,
        "totalCount" to 0,
        "catalogRevision" to revision.toString(),
      )
    val safeOffset = offset.coerceAtLeast(0)
    val limit = requestedLimit.coerceIn(1, MAX_PAGE_SIZE)
    val items = node.documentUri?.let {
      dao.getDirectoryTrackPage(it, safeOffset, limit).map(ActiveTrackView::toBridgeMap)
    }.orEmpty()
    return mapOf(
      "items" to items,
      "nextOffset" to if (safeOffset + items.size < node.directTrackCount) {
        safeOffset + items.size
      } else {
        null
      },
      "totalCount" to node.directTrackCount.toDouble(),
      "catalogRevision" to revision.toString(),
    )
  }

  suspend fun registerFolder(treeUri: String, displayName: String): Map<String, Any?> {
    initialize()
    val dao = requireUser().userDao()
    val existing = dao.getFolderByTreeUri(treeUri)
    val row = if (existing != null) {
      dao.updateFolderName(treeUri, displayName)
      existing.copy(displayName = displayName)
    } else {
      val created = FolderEntity(
        treeUri = treeUri,
        displayName = displayName,
        addedAt = System.currentTimeMillis(),
      )
      created.copy(id = dao.insertFolder(created))
    }
    flushSnapshot()
    return mapOf(
      "id" to row.id.toDouble(),
      "tree_uri" to row.treeUri,
      "display_name" to row.displayName,
      "added_at" to row.addedAt.toDouble(),
      "last_scanned_at" to row.lastScannedAt?.toDouble(),
      "available" to true,
      "scan_status" to row.lastScanStatus,
      "scan_error" to row.lastScanError,
    )
  }

  suspend fun scanLocalFolder(
    folderId: Long,
    full: Boolean,
    discover: suspend (String) -> List<LocalAudioFile>,
    extract: suspend (LocalAudioFile) -> LocalAudioMetadata,
    onProgress: (phase: String, processed: Int, total: Int, folderName: String) -> Unit,
  ): NativeScanResult {
    initialize()
    return catalogWriterMutex.withLock {
      val userDao = requireUser().userDao()
      val folder = userDao.getFolder(folderId) ?: error("Folder $folderId does not exist")
      val database = requireCatalog()
      val dao = database.catalogDao()
      val sourceKey = localSourceKey(folderId)
      val previousSource = dao.getSource(sourceKey)
      val generationId = UUID.randomUUID().toString()
      val startedAt = System.currentTimeMillis()

      dao.putSource(
        previousSource ?: CatalogSourceEntity(
          sourceKey = sourceKey,
          sourceType = "local",
          sourceId = folderId,
          updatedAt = startedAt,
        ),
      )
      dao.insertGeneration(
        ScanGenerationEntity(
          id = generationId,
          sourceKey = sourceKey,
          state = "staging",
          startedAt = startedAt,
        ),
      )
      userDao.updateFolderScanState(folderId, folder.lastScannedAt, "scanning", null)
      updateOperationalStatus(LibraryStatus.SCANNING)

      try {
        onProgress("discovering", 0, 0, folder.displayName)
        val files = discover(folder.treeUri)
        onProgress("discovering", files.size, files.size, folder.displayName)

        val existing = dao.getActiveTrackEntitiesForSource(sourceKey)
        val existingByPath = existing.associateBy(TrackEntity::path)
        val seenPaths = files.mapTo(hashSetOf(), LocalAudioFile::uri)
        val removed = existing.count { it.path !in seenPaths }
        var added = 0
        var updated = 0
        var errors = 0
        var processed = 0

        for (batch in files.chunked(24)) {
          val rows = coroutineScope {
            batch.map { file ->
              async(Dispatchers.IO) {
                val old = existingByPath[file.uri]
                val unchanged = !full &&
                  old != null &&
                  old.mtime == file.lastModified &&
                  old.size == file.size
                if (unchanged) {
                  old!!.copy(
                    id = 0,
                    generationId = generationId,
                    sourceKey = sourceKey,
                    titleSortKey = SortKeys.forText(old.title),
                    artistSortKey = SortKeys.forText(old.artist),
                    albumSortKey = SortKeys.forText(old.album),
                    fileNameSortKey = SortKeys.forText(old.fileName),
                    sectionLabel = SortKeys.sectionLabel(old.title),
                  ) to false
                } else {
                  val metadata = extract(file)
                  if (!metadata.ok) {
                    if (old != null) {
                      old.copy(id = 0, generationId = generationId, sourceKey = sourceKey) to true
                    } else {
                      null to true
                    }
                  } else {
                    trackFromMetadata(
                      generationId = generationId,
                      sourceKey = sourceKey,
                      folderId = folderId,
                      file = file,
                      metadata = metadata,
                      addedAt = old?.addedAt ?: startedAt,
                    ) to false
                  }
                }
              }
            }.awaitAll()
          }
          val insertRows = ArrayList<TrackEntity>(rows.size)
          for ((row, failed) in rows) {
            if (failed) errors += 1
            if (row == null) continue
            insertRows += row
            if (existingByPath.containsKey(row.path)) updated += if (failed) 0 else 1 else added += 1
          }
          if (insertRows.isNotEmpty()) dao.putTracks(insertRows)
          processed += batch.size
          onProgress("extracting", processed, files.size, folder.displayName)
        }

        val prospective = dao.getProspectiveTracks(sourceKey, generationId)
        val nextRevision = dao.getRevision() + 1
        onProgress("indexing", prospective.size, prospective.size, folder.displayName)
        val readModels = withContext(Dispatchers.Default) {
          CatalogReadModelBuilder.build(
            prospective,
            nextRevision,
            userDao.getFolders().associateBy(FolderEntity::id),
          )
        }
        val revision = dao.publishGeneration(
          sourceKey = sourceKey,
          generationId = generationId,
          previousGenerationId = previousSource?.activeGenerationId,
          now = System.currentTimeMillis(),
          albumIdentityUpdates = readModels.identityUpdates,
          albums = readModels.albums,
          artists = readModels.artists,
          artistTrackIndex = readModels.artistTrackIndex,
          directories = readModels.directories,
          ftsRows = readModels.ftsRows,
        )
        userDao.updateFolderScanState(folderId, System.currentTimeMillis(), "ready", null)
        scheduleSnapshot()
        refreshReadyStatus()
        for (listener in catalogListeners) listener(revision)
        NativeScanResult(
          added = added,
          updated = updated,
          removed = removed,
          errors = errors,
          total = files.size,
          revision = revision,
        )
      } catch (error: Throwable) {
        runCatching {
          dao.deleteGenerationTracks(generationId)
          dao.setGenerationState(
            generationId,
            "failed",
            System.currentTimeMillis(),
            error.message ?: error.javaClass.simpleName,
          )
        }
        userDao.updateFolderScanState(
          folderId,
          folder.lastScannedAt,
          "failed",
          error.message ?: error.javaClass.simpleName,
        )
        val oldCount = runCatching { dao.countActiveTracks() }.getOrDefault(0)
        updateStatus(
          status = if (oldCount > 0) LibraryStatus.DEGRADED else LibraryStatus.EMPTY,
          revision = runCatching { dao.getRevision() }.getOrDefault(0),
          count = oldCount,
          message = "Scan failed; the previous library is still available.",
          recoveryNotice = currentStatus.recoveryNotice,
        )
        scheduleSnapshot()
        throw error
      }
    }
  }

  suspend fun removeFolder(folderId: Long) {
    initialize()
    val dao = requireUser().userDao()
    val folder = dao.getFolder(folderId) ?: return
    val sourceKey = localSourceKey(folderId)
    catalogWriterMutex.withLock {
      val catalogDao = requireCatalog().catalogDao()
      val source = catalogDao.getSource(sourceKey)
      val remaining = catalogDao.getActiveTrackEntitiesExcludingSource(sourceKey)
      val nextRevision = catalogDao.getRevision() + 1
      val readModels = withContext(Dispatchers.Default) {
        CatalogReadModelBuilder.build(
          remaining,
          nextRevision,
          dao.getFolders().filter { it.id != folderId }.associateBy(FolderEntity::id),
        )
      }
      val revision = catalogDao.removeSourceAndPublish(
        sourceKey = sourceKey,
        generationId = source?.activeGenerationId,
        now = System.currentTimeMillis(),
        albumIdentityUpdates = readModels.identityUpdates,
        albums = readModels.albums,
        artists = readModels.artists,
        artistTrackIndex = readModels.artistTrackIndex,
        directories = readModels.directories,
        ftsRows = readModels.ftsRows,
      )
      dao.deleteFolder(folder)
      for (listener in catalogListeners) listener(revision)
    }
    runCatching {
      applicationContext.contentResolver.releasePersistableUriPermission(
        android.net.Uri.parse(folder.treeUri),
        android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION or
          android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
      )
    }
    flushSnapshot()
    refreshReadyStatus()
  }

  suspend fun getTrackPage(
    sort: String,
    cursorRaw: String?,
    requestedLimit: Int,
  ): Map<String, Any?> = withCatalogRecovery { database ->
    initialize()
    val dao = database.catalogDao()
    val revision = dao.getRevision()
    val cursor = validateCursor(cursorRaw, revision, "tracks:$sort")
    val limit = requestedLimit.coerceIn(1, MAX_PAGE_SIZE)
    val rows = when (sort) {
      "artist" -> dao.getArtistOrderPage(
        afterArtistKey = cursor?.text1,
        afterAlbumKey = cursor?.text2.orEmpty(),
        afterDisc = cursor?.number1?.toInt() ?: 0,
        afterTrack = cursor?.number2?.toInt() ?: 0,
        afterTitleKey = cursor?.let(::cursorTitleKey).orEmpty(),
        afterPath = cursor?.let { cursorPath(it) }.orEmpty(),
        limit = limit,
      )
      "recently_added" -> dao.getRecentlyAddedPage(
        afterAddedAt = cursor?.number1,
        afterPath = cursor?.text1.orEmpty(),
        limit = limit,
      )
      "duration" -> dao.getDurationPage(
        afterDuration = cursor?.decimal1,
        afterPath = cursor?.text1.orEmpty(),
        limit = limit,
      )
      else -> dao.getTitlePage(
        afterTitleKey = cursor?.text1,
        afterPath = cursor?.text2.orEmpty(),
        limit = limit,
      )
    }
    val next = rows.lastOrNull()?.let { row ->
      when (sort) {
        "artist" -> TrackPageCursor(
          revision = revision,
          kind = "tracks:$sort",
          text1 = row.artistSortKey,
          text2 = row.albumSortKey,
          text3 = "${row.titleSortKey}\u0000${row.path}",
          number1 = row.discSort.toLong(),
          number2 = row.trackSort.toLong(),
          // Artist cursor needs one extra string. Encode the path alongside the
          // title key with a NUL delimiter; SAF paths cannot contain NUL.
        )
        "recently_added" -> TrackPageCursor(
          revision = revision,
          kind = "tracks:$sort",
          text1 = row.path,
          number1 = row.addedAt,
        )
        "duration" -> TrackPageCursor(
          revision = revision,
          kind = "tracks:$sort",
          text1 = row.path,
          decimal1 = row.duration,
        )
        else -> TrackPageCursor(
          revision = revision,
          kind = "tracks:$sort",
          text1 = row.titleSortKey,
          text2 = row.path,
        )
      }.encode()
    }
    mapOf(
      "items" to rows.map(ActiveTrackView::toBridgeMap),
      "nextCursor" to next,
      "previousCursor" to null,
      "totalCount" to dao.countActiveTracks().toDouble(),
      "catalogRevision" to revision.toString(),
    )
  }

  suspend fun getTrack(path: String): Map<String, Any?>? =
    withCatalogRecovery { database -> database.catalogDao().getActiveTrack(path)?.toBridgeMap() }

  suspend fun getTrackLoudness(paths: List<String>): List<Map<String, Any?>> =
    withCatalogRecovery { database ->
      if (paths.isEmpty()) return@withCatalogRecovery emptyList()
      require(paths.size <= MAX_PAGE_SIZE) { "At most $MAX_PAGE_SIZE paths may be requested" }
      database.catalogDao().getActiveTracks(paths.distinct()).map { row ->
        mapOf(
          "path" to row.path,
          "loudness_lufs" to row.loudnessLufs,
          "sample_peak" to row.samplePeak,
          "replay_gain_track_db" to row.replayGainTrackDb,
          "replay_gain_album_db" to row.replayGainAlbumDb,
          "replay_gain_track_peak" to row.replayGainTrackPeak,
          "replay_gain_album_peak" to row.replayGainAlbumPeak,
          "rg_scanned" to if (row.replayGainScanned) 1 else 0,
        )
      }
    }

  suspend fun setTrackLoudness(path: String, lufs: Double?, samplePeak: Double?) {
    withCatalogRecovery { database ->
      database.catalogDao().updateActiveTrackLoudness(path, lufs, samplePeak)
    }
  }

  suspend fun setTrackReplayGain(
    path: String,
    trackGainDb: Double?,
    albumGainDb: Double?,
    trackPeak: Double?,
    albumPeak: Double?,
  ) {
    withCatalogRecovery { database ->
      database.catalogDao().updateActiveTrackReplayGain(
        path,
        trackGainDb,
        albumGainDb,
        trackPeak,
        albumPeak,
      )
    }
  }

  suspend fun getLibraryLoudnessStats(): Map<String, Any?> =
    withCatalogRecovery { database ->
      val row = database.catalogDao().getLibraryLoudnessStats()
      mapOf(
        "lufsCount" to row.lufsCount.toDouble(),
        "medianLufs" to row.medianLufs,
        "rgCount" to row.rgCount.toDouble(),
        "medianRgTrackDb" to row.medianRgTrackDb,
      )
    }

  suspend fun getWaveform(path: String): List<Double>? =
    withCatalogRecovery { database ->
      val row = database.catalogDao().getWaveform(path) ?: return@withCatalogRecovery null
      if (row.peaks.size != row.bins * Float.SIZE_BYTES) return@withCatalogRecovery null
      val buffer = ByteBuffer.wrap(row.peaks).order(ByteOrder.LITTLE_ENDIAN)
      List(row.bins) { buffer.float.toDouble() }
    }

  suspend fun putWaveform(path: String, peaks: List<Double>) {
    require(peaks.size in 1..4_096) { "Waveform must contain between 1 and 4096 peaks" }
    val bytes = ByteBuffer
      .allocate(peaks.size * Float.SIZE_BYTES)
      .order(ByteOrder.LITTLE_ENDIAN)
    for (peak in peaks) bytes.putFloat(peak.toFloat().coerceIn(0f, 1f))
    withCatalogRecovery { database ->
      database.catalogDao().putWaveform(
        WaveformPeaksEntity(
          trackPath = path,
          bins = peaks.size,
          peaks = bytes.array(),
          createdAt = System.currentTimeMillis(),
        ),
      )
    }
  }

  suspend fun countWaveforms(): Long =
    withCatalogRecovery { database -> database.catalogDao().countWaveforms() }

  suspend fun clearWaveforms() {
    withCatalogRecovery { database -> database.catalogDao().clearWaveforms() }
  }

  suspend fun getLyrics(path: String, metadataSignature: String): Map<String, Any?>? =
    withCatalogRecovery { database ->
      val row = database.catalogDao().getLyrics(path) ?: return@withCatalogRecovery null
      if (row.metadataSignature != metadataSignature) return@withCatalogRecovery null
      mapOf(
        "status" to row.status,
        "source" to row.source,
        "provider" to row.provider,
        "format" to row.format,
        "plainLyrics" to row.plainLyrics,
        "syncedLyrics" to row.syncedLyrics,
        "syncedLinesJson" to row.syncedLinesJson,
      )
    }

  suspend fun putLyrics(path: String, values: Map<String, Any?>) {
    withCatalogRecovery { database ->
      database.catalogDao().putLyrics(
        LyricsCacheEntity(
          trackPath = path,
          metadataSignature = values["metadataSignature"] as? String,
          status = values["status"] as? String ?: "not_found",
          source = values["source"] as? String,
          provider = values["provider"] as? String,
          format = values["format"] as? String,
          plainLyrics = values["plainLyrics"] as? String,
          syncedLyrics = values["syncedLyrics"] as? String,
          syncedLinesJson = values["syncedLinesJson"] as? String ?: "[]",
          updatedAt = System.currentTimeMillis(),
        ),
      )
    }
  }

  suspend fun deleteLyrics(path: String) {
    withCatalogRecovery { database -> database.catalogDao().deleteLyrics(path) }
  }

  suspend fun countLyrics(): Long =
    withCatalogRecovery { database -> database.catalogDao().countLyrics() }

  suspend fun clearLyrics() {
    withCatalogRecovery { database -> database.catalogDao().clearLyrics() }
  }

  suspend fun readMobileSession(): String? {
    initialize()
    return requireUser().userDao().getPlaybackSession(MOBILE_SESSION_ID)?.contextJson
  }

  suspend fun writeMobileSession(snapshotJson: String) {
    initialize()
    val dao = requireUser().userDao()
    val previous = dao.getPlaybackSession(MOBILE_SESSION_ID)
    val now = System.currentTimeMillis()
    val playback = runCatching {
      org.json.JSONObject(snapshotJson).optJSONObject("playback")
    }.getOrNull()
    val activePosition = playback?.optLong("activeIndex", 0L) ?: 0L
    val queue = playback?.optJSONArray("queuePaths")
    val anchorPath = if (queue != null && activePosition in 0 until queue.length().toLong()) {
      queue.optString(activePosition.toInt()).takeIf(String::isNotBlank)
    } else {
      null
    }
    dao.putPlaybackSession(
      PlaybackSessionEntity(
        id = MOBILE_SESSION_ID,
        contextJson = snapshotJson,
        anchorPath = anchorPath,
        shuffleSeed = previous?.shuffleSeed,
        activePosition = activePosition,
        createdAt = previous?.createdAt ?: now,
        updatedAt = now,
      ),
    )
    scheduleSnapshot()
  }

  suspend fun createPlaybackContext(
    context: Map<String, Any?>,
    anchorPath: String?,
    shuffle: Boolean,
    requestedSeed: Long?,
  ): Map<String, Any?> {
    initialize()
    val catalogDao = requireCatalog().catalogDao()
    val userDao = requireUser().userDao()
    val paths = resolvePlaybackPaths(context, catalogDao, userDao)
    val availablePaths = filterAvailablePaths(paths, catalogDao)
    val seed = requestedSeed ?: System.currentTimeMillis()
    val ordered = availablePaths.toMutableList()
    var activePosition = anchorPath?.let(ordered::indexOf)?.takeIf { it >= 0 } ?: 0
    if (shuffle && ordered.size > 1) {
      val anchor = ordered.getOrNull(activePosition)
      if (anchor != null) ordered.removeAt(activePosition)
      ordered.shuffle(Random(seed))
      if (anchor != null) ordered.add(0, anchor)
      activePosition = 0
    }
    val now = System.currentTimeMillis()
    userDao.replacePlaybackQueue(
      PlaybackSessionEntity(
        id = ACTIVE_PLAYBACK_CONTEXT_ID,
        contextJson = org.json.JSONObject(context).toString(),
        anchorPath = ordered.getOrNull(activePosition),
        shuffleSeed = if (shuffle) seed else null,
        activePosition = activePosition.toLong(),
        createdAt = now,
        updatedAt = now,
      ),
      ordered.mapIndexed { index, path ->
        PlaybackQueueEntryEntity(
          sessionId = ACTIVE_PLAYBACK_CONTEXT_ID,
          position = index.toLong(),
          trackPath = path,
        )
      },
      availablePaths.mapIndexed { index, path ->
        PlaybackOriginalQueueEntryEntity(
          sessionId = ACTIVE_PLAYBACK_CONTEXT_ID,
          position = index.toLong(),
          trackPath = path,
        )
      },
    )
    scheduleSnapshot()
    return playbackWindow(
      ACTIVE_PLAYBACK_CONTEXT_ID,
      (activePosition - 25).coerceAtLeast(0).toLong(),
      226,
    )
  }

  suspend fun getPlaybackWindow(
    sessionId: String,
    start: Long,
    requestedLimit: Int,
  ): Map<String, Any?> {
    initialize()
    return playbackWindow(sessionId, start.coerceAtLeast(0), requestedLimit.coerceIn(1, 250))
  }

  suspend fun updatePlaybackPosition(sessionId: String, activePosition: Long) {
    initialize()
    val dao = requireUser().userDao()
    val total = dao.countQueueEntries(sessionId)
    if (total == 0L) return
    val bounded = activePosition.coerceIn(0, total - 1)
    val anchor = dao.getQueueWindow(sessionId, bounded, 1).firstOrNull()?.trackPath
    dao.updatePlaybackPosition(sessionId, bounded, anchor, System.currentTimeMillis())
    scheduleSnapshot()
  }

  suspend fun restorePlaybackContext(): Map<String, Any?>? {
    initialize()
    val database = requireUser()
    val dao = database.userDao()
    val session = dao.getPlaybackSession(ACTIVE_PLAYBACK_CONTEXT_ID) ?: return null
    val existing = dao.getAllQueueEntries(session.id)
    if (existing.isEmpty()) return null
    val available = filterAvailablePaths(
      existing.map(PlaybackQueueEntryEntity::trackPath),
      requireCatalog().catalogDao(),
    ).toHashSet()
    val retained = existing.filter { it.trackPath in available }
    if (retained.isEmpty()) {
      dao.deletePlaybackSession(session.id)
      scheduleSnapshot()
      return null
    }
    val oldActive = session.activePosition
    val activePath = session.anchorPath
    val activeIndex = activePath?.let { path ->
      retained.indexOfFirst { it.trackPath == path }.takeIf { it >= 0 }
    } ?: retained.indexOfLast { it.position <= oldActive }.coerceAtLeast(0)
    val normalized = retained.mapIndexed { index, row ->
      row.copy(position = index.toLong())
    }
    val original = dao.getOriginalQueueEntries(session.id)
      .filter { it.trackPath in available }
      .mapIndexed { index, row -> row.copy(position = index.toLong()) }
    database.userDao().replacePlaybackQueue(
      session.copy(
        anchorPath = normalized[activeIndex].trackPath,
        activePosition = activeIndex.toLong(),
        updatedAt = System.currentTimeMillis(),
      ),
      normalized,
      original,
    )
    val start = (activeIndex - 25).coerceAtLeast(0).toLong()
    return playbackWindow(session.id, start, 226)
  }

  suspend fun mutatePlaybackContext(
    operation: String,
    values: Map<String, Any?>,
  ): Map<String, Any?>? {
    initialize()
    val database = requireUser()
    val dao = database.userDao()
    val session = dao.getPlaybackSession(ACTIVE_PLAYBACK_CONTEXT_ID) ?: return null
    val current = dao.getAllQueueEntries(session.id).map(PlaybackQueueEntryEntity::trackPath).toMutableList()
    if (current.isEmpty()) return null
    val originalRows = dao.getOriginalQueueEntries(session.id)
    val original = (if (originalRows.isEmpty()) current else originalRows.map(PlaybackOriginalQueueEntryEntity::trackPath))
      .toMutableList()
    var active = session.activePosition.toInt().coerceIn(current.indices)
    val activePath = current[active]

    fun move(paths: MutableList<String>, from: Int, to: Int) {
      if (from !in paths.indices || to !in paths.indices || from == to) return
      val item = paths.removeAt(from)
      paths.add(to.coerceIn(0, paths.size), item)
    }

    when (operation) {
      "insertAfterActive", "append", "insertQueryAfterActive", "appendQuery" -> {
        @Suppress("UNCHECKED_CAST")
        val context = values["context"] as? Map<String, Any?>
        val requested = if (context == null) {
          (values["paths"] as? List<*>)?.mapNotNull { it as? String }.orEmpty()
        } else {
          resolvePlaybackPaths(context, requireCatalog().catalogDao(), dao)
        }
        val paths = filterAvailablePaths(requested, requireCatalog().catalogDao())
        if (paths.isNotEmpty()) {
          val append = operation == "append" || operation == "appendQuery"
          val insertAt = if (append) current.size else active + 1
          current.addAll(insertAt, paths)
          val originalAnchor = original.indexOf(activePath)
          val originalInsert = if (append || originalAnchor < 0) {
            original.size
          } else {
            originalAnchor + 1
          }
          original.addAll(originalInsert, paths)
        }
      }
      "remove" -> {
        @Suppress("UNCHECKED_CAST")
        val positions = (values["positions"] as? List<*>)
          ?.mapNotNull { (it as? Number)?.toInt() }
          ?.distinct()
          ?.sortedDescending()
          .orEmpty()
        for (position in positions) {
          if (position !in current.indices || position == active) continue
          val removed = current.removeAt(position)
          original.indexOf(removed).takeIf { it >= 0 }?.let(original::removeAt)
          if (position < active) active -= 1
        }
      }
      "move" -> {
        val from = (values["from"] as? Number)?.toInt() ?: -1
        val to = (values["to"] as? Number)?.toInt() ?: -1
        if (from in current.indices && to in current.indices && from != active && to != active) {
          val movedPath = current[from]
          val targetPath = current[to]
          move(current, from, to)
          val originalFrom = original.indexOf(movedPath)
          val originalTo = original.indexOf(targetPath)
          if (originalFrom >= 0 && originalTo >= 0) move(original, originalFrom, originalTo)
          active = current.indexOf(activePath).coerceAtLeast(0)
        }
      }
      "moveManyAfterActive" -> {
        @Suppress("UNCHECKED_CAST")
        val positions = (values["positions"] as? List<*>)
          ?.mapNotNull { (it as? Number)?.toInt() }
          ?.distinct()
          ?.filter { it in current.indices && it != active }
          ?.sorted()
          .orEmpty()
        if (positions.isNotEmpty()) {
          val selected = positions.map(current::get)
          positions.asReversed().forEach { current.removeAt(it) }
          active = current.indexOf(activePath).coerceAtLeast(0)
          current.addAll(active + 1, selected)

          val selectedCounts = selected.groupingBy { it }.eachCount().toMutableMap()
          val remainingOriginal = original.filter { path ->
            val count = selectedCounts[path] ?: 0
            if (count <= 0) true else {
              if (count == 1) selectedCounts.remove(path) else selectedCounts[path] = count - 1
              false
            }
          }.toMutableList()
          val originalActive = remainingOriginal.indexOf(activePath)
          remainingOriginal.addAll(
            if (originalActive >= 0) originalActive + 1 else 0,
            selected,
          )
          original.clear()
          original.addAll(remainingOriginal)
        }
      }
      "shuffle" -> {
        val enabled = values["enabled"] == true
        if (enabled) {
          val seed = (values["seed"] as? Number)?.toLong() ?: System.currentTimeMillis()
          val prefix = current.take(active + 1)
          val upcoming = current.drop(active + 1).toMutableList().apply { shuffle(Random(seed)) }
          current.clear()
          current.addAll(prefix)
          current.addAll(upcoming)
        } else {
          current.clear()
          current.addAll(original)
          active = current.indexOf(activePath).coerceAtLeast(0)
        }
      }
      else -> error("Unknown playback context mutation.")
    }

    val now = System.currentTimeMillis()
    val shuffleEnabled = operation == "shuffle" && values["enabled"] == true
    val nextSeed = when {
      operation != "shuffle" -> session.shuffleSeed
      shuffleEnabled -> (values["seed"] as? Number)?.toLong() ?: now
      else -> null
    }
    dao.replacePlaybackQueue(
      session.copy(
        anchorPath = current.getOrNull(active),
        activePosition = active.toLong(),
        shuffleSeed = nextSeed,
        updatedAt = now,
      ),
      current.mapIndexed { index, path ->
        PlaybackQueueEntryEntity(session.id, index.toLong(), path)
      },
      original.mapIndexed { index, path ->
        PlaybackOriginalQueueEntryEntity(session.id, index.toLong(), path)
      },
    )
    scheduleSnapshot()
    return playbackWindow(session.id, (active - 25).coerceAtLeast(0).toLong(), 226)
  }

  suspend fun recordTrackPlayed(path: String): Boolean {
    initialize()
    val userDao = requireUser().userDao()
    val existing = userDao.getPlaybackHistory(path)
    val now = System.currentTimeMillis()
    userDao.putPlaybackHistory(
      PlaybackHistoryEntity(
        trackPath = path,
        lastPlayedAt = now,
        playCount = (existing?.playCount ?: 0) + 1,
      ),
    )
    requireCatalog().catalogDao().putTrackUserFacts(
      listOf(
        TrackUserFactEntity(
          path = path,
          isFavorite = userDao.isFavorite(path),
          playCount = (existing?.playCount ?: 0) + 1,
          lastPlayedAt = now,
        ),
      ),
    )
    scheduleSnapshot()
    return true
  }

  suspend fun listRemoteSources(): List<Map<String, Any?>> {
    initialize()
    return requireUser().userDao().getRemoteSources().map(RemoteSourceEntity::toBridgeMap)
  }

  suspend fun getRemoteSource(sourceId: Long): Map<String, Any?>? {
    initialize()
    return requireUser().userDao().getRemoteSource(sourceId)?.toBridgeMap()
  }

  suspend fun createRemoteSource(
    type: String,
    name: String,
    baseUrl: String,
    username: String,
    enabled: Boolean,
  ): Map<String, Any?> {
    initialize()
    val now = System.currentTimeMillis()
    val dao = requireUser().userDao()
    val entity = RemoteSourceEntity(
      type = type,
      name = name,
      baseUrl = baseUrl,
      username = username,
      enabled = enabled,
      createdAt = now,
      updatedAt = now,
    )
    val row = entity.copy(id = dao.insertRemoteSource(entity))
    flushSnapshot()
    return row.toBridgeMap()
  }

  suspend fun updateRemoteSource(sourceId: Long, fields: Map<String, Any?>) {
    initialize()
    val dao = requireUser().userDao()
    val row = dao.getRemoteSource(sourceId) ?: return
    dao.putRemoteSource(
      row.copy(
        name = fields["name"] as? String ?: row.name,
        baseUrl = fields["base_url"] as? String ?: row.baseUrl,
        username = fields["username"] as? String ?: row.username,
        enabled = fields["enabled"] as? Boolean ?: row.enabled,
        updatedAt = System.currentTimeMillis(),
      ),
    )
    flushSnapshot()
  }

  suspend fun setRemoteSourceStatus(sourceId: Long, status: String, error: String?) {
    initialize()
    val dao = requireUser().userDao()
    val row = dao.getRemoteSource(sourceId) ?: return
    val now = System.currentTimeMillis()
    dao.putRemoteSource(
      row.copy(
        lastStatus = status,
        lastError = error,
        lastCheckedAt = now,
        lastSyncAt = if (status == "ok") now else row.lastSyncAt,
        updatedAt = now,
      ),
    )
    scheduleSnapshot()
  }

  suspend fun deleteRemoteSource(sourceId: Long, purgeCatalog: Boolean) {
    initialize()
    val userDao = requireUser().userDao()
    val source = userDao.getRemoteSource(sourceId) ?: return
    if (purgeCatalog) removeCatalogSource("${source.type}:$sourceId")
    userDao.deleteRemotePlaylists(sourceId)
    userDao.deleteFavoritesByPrefix("${source.type}://$sourceId/track/")
    userDao.deleteRemoteSource(sourceId)
    reconcileUserFacts()
    flushSnapshot()
  }

  suspend fun replaceRemoteUserState(
    sourceId: Long,
    sourceType: String,
    favoritePaths: List<String>,
    playlists: List<Map<String, Any?>>,
  ) {
    initialize()
    require(favoritePaths.size <= 100_000) { "Remote favorite batch is too large" }
    require(playlists.size <= 10_000) { "Remote playlist batch is too large" }
    val now = System.currentTimeMillis()
    val plans = playlists.mapNotNull { row ->
      val remoteId = row["source_playlist_id"] as? String ?: return@mapNotNull null
      val name = (row["name"] as? String)?.trim()?.takeIf(String::isNotEmpty)
        ?: "Remote playlist"
      val tracks = (row["tracks"] as? List<*>)
        .orEmpty()
        .mapNotNull { it as? Map<*, *> }
        .mapNotNull { track ->
          val path = track["path"] as? String ?: return@mapNotNull null
          PlaylistTrackEntity(
            playlistId = 0,
            trackPath = path,
            position = 0,
            addedAt = now,
            fallbackTitle = track["title"] as? String,
            fallbackArtist = track["artist"] as? String,
            fallbackAlbum = track["album"] as? String,
          )
        }
        .distinctBy(PlaylistTrackEntity::trackPath)
        .mapIndexed { index, entry -> entry.copy(position = index) }
      RemotePlaylistSyncPlan(
        playlist = PlaylistEntity(
          name = name,
          createdAt = now,
          updatedAt = now,
          kind = "normal",
          remoteSourceId = sourceId,
          remotePlaylistId = remoteId,
          syncUid = "remote:$sourceType:$sourceId:$remoteId",
        ),
        entries = tracks,
      )
    }
    requireUser().userDao().replaceRemoteUserState(
      sourceId = sourceId,
      favoritePrefix = "$sourceType://$sourceId/track/",
      favorites = favoritePaths.distinct().map { FavoriteEntity(it, now) },
      playlists = plans,
    )
    reconcileUserFacts()
    scheduleSnapshot()
  }

  suspend fun beginRemoteSync(sourceId: Long, sourceType: String): String =
    catalogWriterMutex.withLock {
      initialize()
      val dao = requireCatalog().catalogDao()
      val sourceKey = "$sourceType:$sourceId"
      val previous = dao.getSource(sourceKey)
      val generationId = UUID.randomUUID().toString()
      val syncId = UUID.randomUUID().toString()
      val now = System.currentTimeMillis()
      dao.putSource(
        previous ?: CatalogSourceEntity(
          sourceKey = sourceKey,
          sourceType = sourceType,
          sourceId = sourceId,
          updatedAt = now,
        ),
      )
      dao.insertGeneration(
        ScanGenerationEntity(
          id = generationId,
          sourceKey = sourceKey,
          state = "staging",
          startedAt = now,
        ),
      )
      remoteSyncs[syncId] = RemoteSyncHandle(
        syncId = syncId,
        sourceKey = sourceKey,
        sourceId = sourceId,
        sourceType = sourceType,
        generationId = generationId,
        previousGenerationId = previous?.activeGenerationId,
        startedAt = now,
        existingByPath = dao.getActiveTrackEntitiesForSource(sourceKey).associateBy(TrackEntity::path),
      )
      syncId
    }

  suspend fun appendRemoteTracks(syncId: String, rows: List<Map<String, Any?>>): Int =
    catalogWriterMutex.withLock {
      val handle = remoteSyncs[syncId] ?: error("Remote sync is not active")
      val tracks = rows.mapNotNull { row ->
        val path = row["path"] as? String ?: return@mapNotNull null
        handle.seenPaths += path
        remoteTrackFromMap(handle, row, handle.existingByPath[path]?.addedAt ?: handle.startedAt)
      }
      if (tracks.isNotEmpty()) requireCatalog().catalogDao().putTracks(tracks)
      tracks.size
    }

  suspend fun commitRemoteSync(syncId: String): Map<String, Any> =
    catalogWriterMutex.withLock {
      val handle = remoteSyncs.remove(syncId) ?: error("Remote sync is not active")
      val dao = requireCatalog().catalogDao()
      try {
        val prospective = dao.getProspectiveTracks(handle.sourceKey, handle.generationId)
        val nextRevision = dao.getRevision() + 1
        val readModels = withContext(Dispatchers.Default) {
          CatalogReadModelBuilder.build(
            prospective,
            nextRevision,
            requireUser().userDao().getFolders().associateBy(FolderEntity::id),
          )
        }
        val revision = dao.publishGeneration(
          sourceKey = handle.sourceKey,
          generationId = handle.generationId,
          previousGenerationId = handle.previousGenerationId,
          now = System.currentTimeMillis(),
          albumIdentityUpdates = readModels.identityUpdates,
          albums = readModels.albums,
          artists = readModels.artists,
          artistTrackIndex = readModels.artistTrackIndex,
          directories = readModels.directories,
          ftsRows = readModels.ftsRows,
        )
        refreshReadyStatus()
        for (listener in catalogListeners) listener(revision)
        mapOf(
          "tracksScanned" to handle.seenPaths.size,
          "removed" to handle.existingByPath.keys.count { it !in handle.seenPaths },
          "catalogRevision" to revision.toString(),
        )
      } catch (error: Throwable) {
        dao.deleteGenerationTracks(handle.generationId)
        dao.setGenerationState(
          handle.generationId,
          "failed",
          System.currentTimeMillis(),
          error.message ?: error.javaClass.simpleName,
        )
        throw error
      }
    }

  suspend fun abortRemoteSync(syncId: String) {
    catalogWriterMutex.withLock {
      val handle = remoteSyncs.remove(syncId) ?: return@withLock
      val dao = requireCatalog().catalogDao()
      dao.deleteGenerationTracks(handle.generationId)
      dao.setGenerationState(handle.generationId, "failed", System.currentTimeMillis(), "aborted")
    }
  }

  suspend fun getRecentlyPlayed(limit: Int): List<Map<String, Any?>> {
    initialize()
    val history = requireUser().userDao().getPlaybackHistory().take(limit.coerceIn(1, 100))
    if (history.isEmpty()) return emptyList()
    val tracks = requireCatalog().catalogDao().getActiveTracks(history.map { it.trackPath }).associateBy { it.path }
    return history.mapNotNull { item ->
      tracks[item.trackPath]?.toBridgeMap()?.toMutableMap()?.apply {
        this["play_count"] = item.playCount.toDouble()
        this["last_played_at"] = item.lastPlayedAt.toDouble()
      }
    }
  }

  suspend fun listPlaylists(): List<Map<String, Any?>> {
    initialize()
    val userDao = requireUser().userDao()
    val catalogDao = requireCatalog().catalogDao()
    return userDao.getPlaylists().map { playlist ->
      if (playlist.kind == "dynamic") {
        val queries = DynamicPlaylistCompiler.compile(playlist.dynamicRulesJson, 0, 1)
        val count = catalogDao.runDynamicCountQuery(queries.count)
        val first = catalogDao.runDynamicTrackQuery(queries.tracks).firstOrNull()
        playlist.toBridgeMap(
          trackCount = count,
          missingCount = 0,
          artworkHash = first?.artworkHash,
        )
      } else {
        val entries = userDao.getPlaylistTracks(playlist.id)
        val active = entries.chunked(400).flatMap { chunk ->
          catalogDao.getActiveTracks(chunk.map(PlaylistTrackEntity::trackPath))
        }
        val activeByPath = active.associateBy(ActiveTrackView::path)
        val activePaths = activeByPath.keys
        playlist.toBridgeMap(
          trackCount = activePaths.size.toLong(),
          missingCount = entries.count { it.trackPath !in activePaths }.toLong(),
          artworkHash = entries.asSequence()
            .mapNotNull { entry -> activeByPath[entry.trackPath]?.artworkHash }
            .firstOrNull(),
        )
      }
    }
  }

  suspend fun createPlaylist(name: String, kind: String, rulesJson: String?): Map<String, Any?> {
    initialize()
    val trimmed = name.trim()
    require(trimmed.isNotEmpty()) { "Playlist name is required." }
    val now = System.currentTimeMillis()
    val entity = PlaylistEntity(
      name = trimmed,
      createdAt = now,
      updatedAt = now,
      kind = if (kind == "dynamic") "dynamic" else "normal",
      dynamicRulesJson = if (kind == "dynamic") rulesJson else null,
    )
    val row = entity.copy(id = requireUser().userDao().insertPlaylist(entity))
    flushSnapshot()
    return row.toBridgeMap(0, 0, null)
  }

  suspend fun getDynamicPlaylistRules(playlistId: Long): String {
    initialize()
    val playlist = requireUser().userDao().getPlaylist(playlistId)
      ?: error("Playlist not found.")
    require(playlist.kind == "dynamic") { "Playlist is not dynamic." }
    return playlist.dynamicRulesJson ?: """{"version":1,"conditions":[],"sort":{"field":"title","direction":"asc"},"limit":null}"""
  }

  suspend fun updateDynamicPlaylistRules(playlistId: Long, rulesJson: String) {
    initialize()
    val dao = requireUser().userDao()
    val playlist = dao.getPlaylist(playlistId) ?: error("Playlist not found.")
    require(playlist.kind == "dynamic") { "Playlist is not dynamic." }
    dao.putPlaylist(
      playlist.copy(
        dynamicRulesJson = rulesJson,
        updatedAt = System.currentTimeMillis(),
      ),
    )
    scheduleSnapshot()
  }

  suspend fun previewDynamicPlaylist(rulesJson: String): Map<String, Any?> {
    initialize()
    val dao = requireCatalog().catalogDao()
    val queries = DynamicPlaylistCompiler.compile(rulesJson, 0, 25)
    return mapOf(
      "track_count" to dao.runDynamicCountQuery(queries.count).toDouble(),
      "tracks" to dao.runDynamicTrackQuery(queries.tracks).map { track ->
        mapOf(
          "path" to track.path,
          "title" to track.title,
          "artist" to track.artist,
          "album" to track.album,
        )
      },
    )
  }

  suspend fun renamePlaylist(playlistId: Long, name: String) {
    initialize()
    val dao = requireUser().userDao()
    val playlist = dao.getPlaylist(playlistId) ?: return
    dao.putPlaylist(playlist.copy(name = name.trim(), updatedAt = System.currentTimeMillis()))
    scheduleSnapshot()
  }

  suspend fun deletePlaylist(playlistId: Long) {
    initialize()
    requireUser().userDao().deletePlaylistById(playlistId)
    flushSnapshot()
  }

  suspend fun markPlaylistPlayed(playlistId: Long) {
    initialize()
    val dao = requireUser().userDao()
    val playlist = dao.getPlaylist(playlistId) ?: return
    dao.putPlaylist(playlist.copy(lastPlayedAt = System.currentTimeMillis()))
    scheduleSnapshot()
  }

  suspend fun addPlaylistEntries(
    playlistId: Long,
    entries: List<Map<String, Any?>>,
  ): Int {
    initialize()
    val dao = requireUser().userDao()
    val playlist = dao.getPlaylist(playlistId) ?: error("Playlist not found.")
    require(playlist.kind != "dynamic") { "Dynamic playlists cannot accept manual tracks." }
    val rows = entries.mapNotNull { entry ->
      val path = entry["trackPath"] as? String ?: return@mapNotNull null
      PlaylistTrackEntity(
        playlistId = playlistId,
        trackPath = path,
        position = 0,
        addedAt = 0,
        fallbackTitle = entry["fallbackTitle"] as? String,
        fallbackArtist = entry["fallbackArtist"] as? String,
        fallbackAlbum = entry["fallbackAlbum"] as? String,
      )
    }
    val inserted = dao.appendPlaylistTracks(playlistId, rows, System.currentTimeMillis())
    scheduleSnapshot()
    return inserted
  }

  suspend fun removePlaylistEntry(playlistId: Long, path: String) {
    initialize()
    val dao = requireUser().userDao()
    val playlist = dao.getPlaylist(playlistId) ?: return
    require(playlist.kind != "dynamic") { "Dynamic playlists cannot remove tracks manually." }
    dao.removePlaylistTrackByPath(playlistId, path, System.currentTimeMillis())
    scheduleSnapshot()
  }

  suspend fun movePlaylistEntry(playlistId: Long, path: String, direction: Int) {
    initialize()
    val dao = requireUser().userDao()
    val playlist = dao.getPlaylist(playlistId) ?: return
    require(playlist.kind != "dynamic") { "Dynamic playlists cannot reorder tracks manually." }
    dao.movePlaylistTrackByPath(
      playlistId,
      path,
      direction.coerceIn(-1, 1),
      System.currentTimeMillis(),
    )
    scheduleSnapshot()
  }

  suspend fun getPlaylistEntries(
    playlistId: Long,
    offset: Int,
    requestedLimit: Int,
  ): Map<String, Any?> {
    initialize()
    val userDao = requireUser().userDao()
    val catalogDao = requireCatalog().catalogDao()
    val playlist = userDao.getPlaylist(playlistId) ?: error("Playlist not found.")
    val limit = requestedLimit.coerceIn(1, MAX_PAGE_SIZE)
    if (playlist.kind == "dynamic") {
      val queries = DynamicPlaylistCompiler.compile(playlist.dynamicRulesJson, offset, limit)
      val rows = catalogDao.runDynamicTrackQuery(queries.tracks)
      val total = catalogDao.runDynamicCountQuery(queries.count)
      return mapOf(
        "items" to rows.mapIndexed { index, track ->
          mapOf(
            "id" to (-(offset + index) - 1).toDouble(),
            "track_path" to track.path,
            "position" to offset + index,
            "added_at" to track.addedAt.toDouble(),
            "missing" to false,
            "fallback_title" to null,
            "fallback_artist" to null,
            "fallback_album" to null,
            "track" to track.toBridgeMap(),
          )
        },
        "nextOffset" to if (offset + rows.size < total) offset + rows.size else null,
        "totalCount" to total.toDouble(),
      )
    }
    val entries = userDao.getPlaylistTrackPage(playlistId, limit, offset)
    val tracks = catalogDao.getActiveTracks(entries.map(PlaylistTrackEntity::trackPath))
      .associateBy(ActiveTrackView::path)
    val total = userDao.countPlaylistTracks(playlistId)
    return mapOf(
      "items" to entries.map { entry ->
        val track = tracks[entry.trackPath]
        mapOf(
          "id" to entry.id.toDouble(),
          "track_path" to entry.trackPath,
          "position" to entry.position,
          "added_at" to entry.addedAt.toDouble(),
          "missing" to (track == null),
          "fallback_title" to entry.fallbackTitle,
          "fallback_artist" to entry.fallbackArtist,
          "fallback_album" to entry.fallbackAlbum,
          "track" to track?.toBridgeMap(),
        )
      },
      "nextOffset" to if (offset + entries.size < total) offset + entries.size else null,
      "totalCount" to total.toDouble(),
    )
  }

  suspend fun getFavoritePaths(): List<String> {
    initialize()
    return requireUser().userDao().getFavorites().map(FavoriteEntity::trackPath)
  }

  suspend fun getFavoriteTracks(limit: Int): List<Map<String, Any?>> {
    initialize()
    val favorites = requireUser().userDao().getFavorites().take(limit.coerceIn(1, 500))
    val tracks = requireCatalog().catalogDao().getActiveTracks(favorites.map(FavoriteEntity::trackPath))
      .associateBy(ActiveTrackView::path)
    return favorites.mapNotNull { tracks[it.trackPath]?.toBridgeMap() }
  }

  suspend fun setFavorite(path: String, favorite: Boolean) {
    initialize()
    val userDao = requireUser().userDao()
    if (favorite) userDao.putFavorite(FavoriteEntity(path, System.currentTimeMillis()))
    else userDao.deleteFavorite(path)
    val history = userDao.getPlaybackHistory(path)
    requireCatalog().catalogDao().putTrackUserFacts(
      listOf(
        TrackUserFactEntity(
          path = path,
          isFavorite = favorite,
          playCount = history?.playCount ?: 0,
          lastPlayedAt = history?.lastPlayedAt,
        ),
      ),
    )
    scheduleSnapshot()
  }

  suspend fun getDesktopSyncState(): Map<String, Any?> {
    initialize()
    val result = NativeDesktopSync.getState(requireUser(), requireCatalog())
    if (result["mutated"] == true) {
      reconcileUserFacts()
      scheduleSnapshot()
    }
    return result
  }

  suspend fun applyDesktopSyncPlan(plan: Map<String, Any?>): Map<String, Any?> {
    initialize()
    val result = NativeDesktopSync.applyPlan(requireUser(), requireCatalog(), plan)
    reconcileUserFacts()
    scheduleSnapshot()
    return result
  }

  suspend fun resolveDesktopSyncConflict(
    conflict: Map<String, Any?>,
    resolution: String,
    mergedPlaylist: Map<String, Any?>?,
  ) {
    initialize()
    NativeDesktopSync.resolveConflict(
      requireUser(),
      requireCatalog(),
      conflict,
      resolution,
      mergedPlaylist,
    )
    reconcileUserFacts()
    flushSnapshot()
  }

  suspend fun clearDesktopSyncBaselines() {
    initialize()
    requireUser().userDao().clearPlaylistSyncStates()
    scheduleSnapshot()
  }

  suspend fun getAlbumPage(
    sort: String,
    includeSingles: Boolean,
    cursorRaw: String?,
    requestedLimit: Int,
  ): Map<String, Any?> = withCatalogRecovery { database ->
    val dao = database.catalogDao()
    val revision = dao.getRevision()
    val kind = "albums:$sort:${if (includeSingles) 1 else 0}"
    val cursor = validateCursor(cursorRaw, revision, kind)
    val limit = requestedLimit.coerceIn(1, MAX_PAGE_SIZE)
    val rows = when (sort) {
      "artist" -> dao.getAlbumArtistPage(
        revision,
        includeSingles,
        cursor?.text1,
        cursor?.text2.orEmpty(),
        cursor?.text3.orEmpty(),
        limit,
      )
      "recently_added" -> dao.getAlbumRecentPage(
        revision,
        includeSingles,
        cursor?.number1,
        cursor?.text1.orEmpty(),
        limit,
      )
      "year" -> dao.getAlbumYearPage(
        revision,
        includeSingles,
        cursor?.number1?.toInt(),
        cursor?.text1.orEmpty(),
        cursor?.text2.orEmpty(),
        limit,
      )
      else -> dao.getAlbumNamePage(
        revision,
        includeSingles,
        cursor?.text1,
        cursor?.text2.orEmpty(),
        limit,
      )
    }
    val next = rows.lastOrNull()?.let { row ->
      when (sort) {
        "artist" -> TrackPageCursor(
          revision,
          kind,
          text1 = row.artistSortKey,
          text2 = row.nameSortKey,
          text3 = row.identityKey,
        )
        "recently_added" -> TrackPageCursor(
          revision,
          kind,
          text1 = row.identityKey,
          number1 = row.latestAddedAt,
        )
        "year" -> TrackPageCursor(
          revision,
          kind,
          text1 = row.nameSortKey,
          text2 = row.identityKey,
          number1 = (row.year ?: 0).toLong(),
        )
        else -> TrackPageCursor(
          revision,
          kind,
          text1 = row.nameSortKey,
          text2 = row.identityKey,
        )
      }.encode()
    }
    mapOf(
      "items" to rows.map(AlbumSummaryEntity::toBridgeMap),
      "nextCursor" to next,
      "previousCursor" to null,
      "totalCount" to dao.countAlbums(revision, includeSingles).toDouble(),
      "catalogRevision" to revision.toString(),
    )
  }

  suspend fun getArtistPage(
    sort: String,
    groupingMode: String,
    includeCollaborations: Boolean,
    cursorRaw: String?,
    requestedLimit: Int,
  ): Map<String, Any?> = withCatalogRecovery { database ->
    val dao = database.catalogDao()
    val revision = dao.getRevision()
    val mode = if (groupingMode == "fileTags") "fileTags" else "astra"
    val kind = "artists:$sort:$mode:${if (includeCollaborations) 1 else 0}"
    val cursor = validateCursor(cursorRaw, revision, kind)
    val limit = requestedLimit.coerceIn(1, MAX_PAGE_SIZE)
    val rows = if (sort == "track_count") {
      dao.getArtistCountPage(
        revision,
        mode,
        includeCollaborations,
        cursor?.number1,
        cursor?.text1.orEmpty(),
        cursor?.text2.orEmpty(),
        limit,
      )
    } else {
      dao.getArtistNamePage(
        revision,
        mode,
        includeCollaborations,
        cursor?.text1,
        cursor?.text2.orEmpty(),
        limit,
      )
    }
    val next = rows.lastOrNull()?.let { row ->
      TrackPageCursor(
        revision,
        kind,
        text1 = row.nameSortKey,
        text2 = row.artistKey,
        number1 = if (sort == "track_count") row.trackCount else null,
      ).encode()
    }
    mapOf(
      "items" to rows.map(ArtistSummaryEntity::toBridgeMap),
      "nextCursor" to next,
      "previousCursor" to null,
      "totalCount" to dao.countArtists(revision, mode, includeCollaborations).toDouble(),
      "catalogRevision" to revision.toString(),
    )
  }

  suspend fun getAlbumDetail(
    albumKey: String,
    cursorRaw: String?,
    requestedLimit: Int,
  ): Map<String, Any?> = withCatalogRecovery { database ->
    val dao = database.catalogDao()
    val revision = dao.getRevision()
    val kind = "album:$albumKey"
    val cursor = validateCursor(cursorRaw, revision, kind)
    val limit = requestedLimit.coerceIn(1, MAX_PAGE_SIZE)
    val rows = dao.getAlbumTrackPage(
      albumKey,
      cursor?.number1?.toInt(),
      cursor?.number2?.toInt() ?: 0,
      cursor?.let(::cursorTitleKey).orEmpty(),
      cursor?.let(::cursorPath).orEmpty(),
      limit,
    )
    val next = rows.lastOrNull()?.let { row ->
      TrackPageCursor(
        revision,
        kind,
        text3 = "${row.titleSortKey}\u0000${row.path}",
        number1 = row.discSort.toLong(),
        number2 = row.trackSort.toLong(),
      ).encode()
    }
    mapOf(
      "summary" to dao.getAlbumSummary(revision, albumKey)?.toBridgeMap(),
      "items" to rows.map(ActiveTrackView::toBridgeMap),
      "nextCursor" to next,
      "previousCursor" to null,
      "totalCount" to dao.countAlbumTracks(albumKey).toDouble(),
      "catalogRevision" to revision.toString(),
    )
  }

  suspend fun getArtistDetail(
    artistKey: String,
    groupingMode: String,
    section: String,
    cursorRaw: String?,
    requestedLimit: Int,
  ): Map<String, Any?> = withCatalogRecovery { database ->
    val dao = database.catalogDao()
    val revision = dao.getRevision()
    val mode = if (groupingMode == "fileTags") "fileTags" else "astra"
    val normalizedArtistKey = normalizeArtistKey(artistKey)
    val normalizedSection = when (section) {
      "songs" -> "song"
      "appearances" -> "appearance"
      else -> "all"
    }
    val kind = "artist:$mode:$normalizedArtistKey:$normalizedSection"
    val cursor = validateCursor(cursorRaw, revision, kind)
    val limit = requestedLimit.coerceIn(1, MAX_PAGE_SIZE)
    val rows = dao.getArtistTrackPage(
      revision,
      mode,
      normalizedArtistKey,
      normalizedSection,
      cursor?.text1,
      cursor?.number1?.toInt() ?: 0,
      cursor?.number2?.toInt() ?: 0,
      cursor?.let(::cursorTitleKey).orEmpty(),
      cursor?.let(::cursorPath).orEmpty(),
      limit,
    )
    val next = rows.lastOrNull()?.let { row ->
      TrackPageCursor(
        revision,
        kind,
        text1 = row.albumSortKey,
        text3 = "${row.titleSortKey}\u0000${row.path}",
        number1 = row.discSort.toLong(),
        number2 = row.trackSort.toLong(),
      ).encode()
    }
    mapOf(
      "summary" to dao.getArtistSummary(revision, mode, normalizedArtistKey)?.toBridgeMap(),
      "items" to rows.map(ActiveTrackView::toBridgeMap),
      "nextCursor" to next,
      "previousCursor" to null,
      "totalCount" to dao.countArtistTracks(revision, mode, normalizedArtistKey, normalizedSection).toDouble(),
      "catalogRevision" to revision.toString(),
    )
  }

  suspend fun getArtistAlbums(
    artistKey: String,
    groupingMode: String,
    offset: Int,
    requestedLimit: Int,
  ): Map<String, Any?> = withCatalogRecovery { database ->
    val dao = database.catalogDao()
    val revision = dao.getRevision()
    val mode = if (groupingMode == "fileTags") "fileTags" else "astra"
    val normalized = normalizeArtistKey(artistKey)
    val safeOffset = offset.coerceAtLeast(0)
    val limit = requestedLimit.coerceIn(1, MAX_PAGE_SIZE)
    val rows = dao.getArtistAlbumPage(revision, mode, normalized, safeOffset, limit)
    val total = dao.countArtistAlbums(revision, mode, normalized)
    mapOf(
      "items" to rows.map(AlbumSummaryEntity::toBridgeMap),
      "nextOffset" to if (safeOffset + rows.size < total) safeOffset + rows.size else null,
      "totalCount" to total.toDouble(),
      "catalogRevision" to revision.toString(),
    )
  }

  suspend fun searchTracks(query: String, requestedLimit: Int): List<Map<String, Any?>> =
    withCatalogRecovery { database ->
      val fts = compileFtsQuery(query)
      if (fts.isBlank()) emptyList()
      else {
        val dao = database.catalogDao()
        val limit = requestedLimit.coerceIn(1, 100)
        val rows = searchTrackRows(dao, query, fts, limit)
        rows.map(ActiveTrackView::toBridgeMap)
      }
    }

  suspend fun searchLibrary(
    query: String,
    requestedLimit: Int,
    includeSingles: Boolean,
    groupingMode: String,
    includeCollaborations: Boolean,
  ): Map<String, Any?> = withCatalogRecovery { database ->
    val fts = compileFtsQuery(query)
    if (fts.isBlank()) {
      return@withCatalogRecovery mapOf(
        "tracks" to emptyList<Map<String, Any?>>(),
        "albums" to emptyList<Map<String, Any?>>(),
        "artists" to emptyList<Map<String, Any?>>(),
      )
    }
    val dao = database.catalogDao()
    val revision = dao.getRevision()
    val limit = requestedLimit.coerceIn(1, 100)
    val mode = if (groupingMode == "fileTags") "fileTags" else "astra"
    val literal = useLiteralSearch(query)
    val pattern = literalSearchPattern(query)
    val tracks = searchTrackRows(dao, query, fts, limit)
    val albums = if (literal) {
      dao.searchAlbumsLiteral(revision, includeSingles, pattern, limit)
    } else {
      dao.searchAlbums(revision, includeSingles, fts, limit).ifEmpty {
        dao.searchAlbumsLiteral(revision, includeSingles, pattern, limit)
      }
    }
    val artists = if (literal) {
      dao.searchArtistsLiteral(revision, mode, includeCollaborations, pattern, limit)
    } else {
      dao.searchArtists(revision, mode, includeCollaborations, fts, limit).ifEmpty {
        dao.searchArtistsLiteral(revision, mode, includeCollaborations, pattern, limit)
      }
    }
    mapOf(
      "tracks" to tracks.map(ActiveTrackView::toBridgeMap),
      "albums" to albums.map(AlbumSummaryEntity::toBridgeMap),
      "artists" to artists.map(ArtistSummaryEntity::toBridgeMap),
    )
  }

  suspend fun matchSignal(
    title: String,
    artist: String,
    durationSeconds: Double?,
  ): Map<String, Any?> = withCatalogRecovery { database ->
    data class Candidate(
      val track: ActiveTrackView,
      val match: String,
      val delta: Double?,
    )

    fun exact(value: String): String =
      Normalizer.normalize(value, Normalizer.Form.NFKC)
        .replace(Regex("\\s+"), " ")
        .trim()
        .lowercase(java.util.Locale.ROOT)

    fun relaxed(value: String): String =
      Normalizer.normalize(value, Normalizer.Form.NFKD)
        .replace(Regex("\\p{M}+"), "")
        .lowercase(java.util.Locale.ROOT)
        .replace(Regex("[^\\p{L}\\p{N}]+"), " ")
        .replace(Regex("\\s+"), " ")
        .trim()

    val wantedTitle = exact(title)
    val wantedArtist = exact(artist)
    if (wantedTitle.isBlank() || wantedArtist.isBlank()) {
      return@withCatalogRecovery mapOf("kind" to "none", "candidates" to emptyList<Any>())
    }
    val wantedDuration = durationSeconds?.takeIf { it.isFinite() && it > 0 }
    val exactMatches = mutableListOf<Candidate>()
    val relaxedMatches = mutableListOf<Candidate>()
    for (track in database.catalogDao().getAllActiveTracksForNativeMatching()) {
      val trackDuration = track.duration.takeIf { it.isFinite() && it > 0 }
      val delta = if (wantedDuration != null && trackDuration != null) {
        kotlin.math.abs(wantedDuration - trackDuration)
      } else {
        null
      }
      if (exact(track.title) == wantedTitle && exact(track.artist) == wantedArtist) {
        if (wantedDuration != null && trackDuration == null) continue
        if (delta != null && delta > 3.0) continue
        exactMatches += Candidate(track, "exact", delta)
      } else if (
        wantedDuration != null &&
        trackDuration != null &&
        delta != null &&
        delta <= 2.0 &&
        relaxed(track.title) == relaxed(title) &&
        relaxed(track.artist) == relaxed(artist)
      ) {
        relaxedMatches += Candidate(track, "normalized", delta)
      }
    }
    val matches = (if (exactMatches.isNotEmpty()) exactMatches else relaxedMatches)
      .sortedWith(compareBy<Candidate>({ it.delta ?: Double.POSITIVE_INFINITY }, { it.track.path }))
      .take(20)
    mapOf(
      "kind" to when (matches.size) {
        0 -> "none"
        1 -> "match"
        else -> "ambiguous"
      },
      "candidates" to matches.map { candidate ->
        mapOf(
          "track" to candidate.track.toBridgeMap(),
          "match" to candidate.match,
          "durationDeltaSec" to candidate.delta,
        )
      },
    )
  }

  private fun compileFtsQuery(query: String): String =
    query
      .trim()
      .split(Regex("\\s+"))
      .filter(String::isNotBlank)
      .joinToString(" AND ") { "\"${it.replace("\"", "\"\"")}\"*" }

  private fun useLiteralSearch(query: String): Boolean =
    query.isNotBlank() && query.none(Character::isLetterOrDigit)

  private fun literalSearchPattern(query: String): String =
    "%${query.trim().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")}%"

  /**
   * unicode61 tokenization is fast for word-oriented scripts, but a prefix query
   * can legitimately miss a CJK substring or punctuation-heavy title. Keep FTS
   * as the primary path and fall back to an escaped, bounded literal LIKE query
   * when token search has no match, without ever hydrating the catalog.
   */
  private suspend fun searchTrackRows(
    dao: CatalogDao,
    query: String,
    fts: String,
    limit: Int,
  ): List<ActiveTrackView> {
    val pattern = literalSearchPattern(query)
    if (useLiteralSearch(query)) return dao.searchTracksLiteral(pattern, limit)
    return dao.searchTracks(fts, limit).ifEmpty {
      dao.searchTracksLiteral(pattern, limit)
    }
  }

  private fun normalizeArtistKey(value: String): String =
    value.replace(Regex("\\s+"), " ").trim().lowercase(java.util.Locale.ROOT)

  suspend fun getSectionAnchors(
    kind: String,
    sort: String,
    includeSingles: Boolean,
    groupingMode: String,
    includeCollaborations: Boolean,
  ): List<Map<String, Any?>> =
    withCatalogRecovery { database ->
      val dao = database.catalogDao()
      val revision = dao.getRevision()
      val anchors: List<Pair<String, TrackPageCursor>> = when (kind) {
        "albums" -> {
          val rows = dao.getAllAlbumSummaries(revision).filter { includeSingles || !it.isSingle }
          rows.groupBy { row ->
            if (sort == "artist") SortKeys.sectionLabel(row.artist) else SortKeys.sectionLabel(row.album)
          }.map { (label, section) ->
            if (sort == "artist") {
              val first = section.minWith(compareBy<AlbumSummaryEntity>({ it.artistSortKey }, { it.nameSortKey }, { it.identityKey }))
              label to TrackPageCursor(
                revision,
                "albums:artist:${if (includeSingles) 1 else 0}",
                text1 = first.artistSortKey,
              )
            } else {
              val first = section.minWith(compareBy<AlbumSummaryEntity>({ it.nameSortKey }, { it.identityKey }))
              label to TrackPageCursor(
                revision,
                "albums:name:${if (includeSingles) 1 else 0}",
                text1 = first.nameSortKey,
              )
            }
          }
        }
        "artists" -> {
          val mode = if (groupingMode == "fileTags") "fileTags" else "astra"
          dao.getAllArtistSummaries(revision, mode)
            .filter { includeCollaborations || !it.isCollaboration }
            .groupBy { row -> SortKeys.sectionLabel(row.artist) }
            .map { (label, section) ->
              val first = section.minWith(compareBy<ArtistSummaryEntity>({ it.nameSortKey }, { it.artistKey }))
              label to TrackPageCursor(
                revision,
                "artists:name:$mode:${if (includeCollaborations) 1 else 0}",
                text1 = first.nameSortKey,
              )
            }
        }
        else -> {
          if (sort == "artist") {
            dao.getArtistSectionAnchorCandidates()
              .groupBy { candidate -> SortKeys.sectionLabel(candidate.artist) }
              .map { (label, section) ->
                label to TrackPageCursor(
                  revision,
                  "tracks:artist",
                  text1 = section.minOf(ArtistSectionAnchorCandidate::sortKey),
                )
              }
          } else {
            dao.getTitleSectionAnchors().map { row ->
              row.sectionLabel to TrackPageCursor(
                revision,
                "tracks:title",
                text1 = row.sortKey,
              )
            }
          }
        }
      }
      anchors.sortedWith(compareBy<Pair<String, TrackPageCursor>> { it.second.text1 }.thenBy { it.first })
        .map { (label, cursor) ->
        mapOf(
          "label" to label,
          "cursor" to cursor.encode(),
        )
      }
    }

  private suspend fun filterAvailablePaths(
    paths: List<String>,
    catalogDao: CatalogDao,
  ): List<String> {
    if (paths.isEmpty()) return emptyList()
    val available = HashSet<String>(paths.size)
    for (chunk in paths.distinct().chunked(MAX_PAGE_SIZE)) {
      catalogDao.getActiveTracks(chunk).mapTo(available, ActiveTrackView::path)
    }
    return paths.filter(available::contains)
  }

  private suspend fun resolvePlaybackPaths(
    context: Map<String, Any?>,
    catalogDao: CatalogDao,
    userDao: UserDao,
  ): List<String> = when (context["kind"] as? String ?: "library") {
    "album" -> (context["albumKey"] as? String)?.let { catalogDao.getAlbumPaths(it) }.orEmpty()
    "artist" -> {
      val artistKey = (context["artistKey"] as? String)?.let(::normalizeArtistKey)
      if (artistKey == null) {
        emptyList()
      } else {
        catalogDao.getArtistPaths(
          revision = catalogDao.getRevision(),
          groupingMode = if (context["groupingMode"] == "fileTags") "fileTags" else "astra",
          artistKey = artistKey,
          section = when (context["section"]) {
            "songs" -> "song"
            "appearances" -> "appearance"
            else -> "all"
          },
        )
      }
    }
    "folder" -> when (val folderId = context["folderId"] as? Number) {
      null -> (context["folderNodeId"] as? String)
        ?.let { folderSubtreePaths(catalogDao, it) }
        .orEmpty()
      else -> catalogDao.getFolderPaths(folderId.toLong())
    }
    "playlist", "dynamicPlaylist" -> {
      val playlistId = (context["playlistId"] as? Number)?.toLong()
      val playlist = playlistId?.let { userDao.getPlaylist(it) }
      when {
        playlist == null -> emptyList()
        playlist.kind == "dynamic" -> {
          val total = DynamicPlaylistCompiler
            .compile(playlist.dynamicRulesJson, 0, 1)
            .let { catalogDao.runDynamicCountQuery(it.count).toInt() }
          val result = ArrayList<String>(total)
          for (offset in 0 until total step MAX_PAGE_SIZE) {
            val query = DynamicPlaylistCompiler.compile(
              playlist.dynamicRulesJson,
              offset,
              minOf(MAX_PAGE_SIZE, total - offset),
            )
            result += catalogDao.runDynamicTrackQuery(query.tracks).map(ActiveTrackView::path)
          }
          result
        }
        else -> userDao.getPlaylistTracks(playlist.id).map(PlaylistTrackEntity::trackPath)
      }
    }
    "favorites" -> userDao.getFavorites().map(FavoriteEntity::trackPath)
    "recent" -> userDao.getPlaybackHistory().map(PlaybackHistoryEntity::trackPath)
    "search" -> {
      val search = context["query"] as? String ?: ""
      val fts = compileFtsQuery(search)
      when {
        fts.isBlank() -> emptyList()
        useLiteralSearch(search) -> catalogDao.searchTrackPathsLiteral(literalSearchPattern(search))
        else -> catalogDao.searchTrackPaths(fts)
      }
    }
    "manual" -> (context["paths"] as? List<*>)
      ?.mapNotNull { it as? String }
      .orEmpty()
    else -> when (context["sort"] as? String) {
      "artist" -> catalogDao.getAllPathsByArtist()
      "recently_added" -> catalogDao.getAllPathsByRecentlyAdded()
      "duration" -> catalogDao.getAllPathsByDuration()
      else -> catalogDao.getAllPathsByTitle()
    }
  }

  private suspend fun playbackWindow(
    sessionId: String,
    start: Long,
    limit: Int,
  ): Map<String, Any?> {
    val userDao = requireUser().userDao()
    val session = userDao.getPlaybackSession(sessionId)
      ?: error("Playback context $sessionId does not exist")
    val total = userDao.countQueueEntries(sessionId)
    val requestedStart = start.coerceAtLeast(0)
    val boundedStart = boundedPlaybackWindowStart(requestedStart, total)
    val entries = if (boundedStart == null) {
      emptyList()
    } else {
      userDao.getQueueWindow(sessionId, boundedStart, limit)
    }
    val tracks = LinkedHashMap<String, ActiveTrackView>()
    for (chunk in entries.map(PlaybackQueueEntryEntity::trackPath).distinct().chunked(MAX_PAGE_SIZE)) {
      requireCatalog().catalogDao().getActiveTracks(chunk).forEach { tracks[it.path] = it }
    }
    val items = entries.mapNotNull { entry ->
      tracks[entry.trackPath]?.toBridgeMap()?.toMutableMap()?.apply {
        this["queuePosition"] = entry.position.toDouble()
      }
    }
    return mapOf(
      "sessionId" to session.id,
      "items" to items,
      "windowStart" to (boundedStart ?: requestedStart).toDouble(),
      "activePosition" to session.activePosition.toDouble(),
      "totalCount" to total.toDouble(),
      "contextJson" to session.contextJson,
      "shuffleSeed" to session.shuffleSeed?.toDouble(),
      "catalogRevision" to requireCatalog().catalogDao().getRevision().toString(),
    )
  }

  suspend fun flushSnapshot() {
    initialize()
    val database = userDatabase ?: return
    snapshotMutex.withLock {
      pendingSnapshot?.cancel()
      pendingSnapshot = null
      snapshots.write(database)
      database.userDao().putSnapshotMetadata(
        SnapshotMetadataEntity(lastSnapshotAt = System.currentTimeMillis()),
      )
    }
  }

  suspend fun userDb(): AstraUserDatabase {
    initialize()
    return requireUser()
  }

  suspend fun catalogDb(): AstraCatalogDatabase {
    initialize()
    return requireCatalog()
  }

  internal fun updateOperationalStatus(
    status: LibraryStatus,
    message: String? = null,
  ) {
    val previous = currentStatus
    updateStatus(
      status = status,
      revision = previous.catalogRevision,
      count = previous.trackCount,
      message = message,
      recoveryNotice = previous.recoveryNotice,
    )
  }

  internal suspend fun refreshReadyStatus(recoveryNotice: String? = currentStatus.recoveryNotice) {
    val dao = requireCatalog().catalogDao()
    val count = dao.countActiveTracks()
    updateStatus(
      if (count == 0L) LibraryStatus.EMPTY else LibraryStatus.READY,
      dao.getRevision(),
      count,
      recoveryNotice = recoveryNotice,
    )
  }

  private fun validateCursor(
    raw: String?,
    revision: Long,
    kind: String,
  ): TrackPageCursor? {
    if (raw.isNullOrBlank()) return null
    val cursor = TrackPageCursor.decode(raw) ?: throw IllegalArgumentException("INVALID_CURSOR")
    if (cursor.revision != revision || cursor.kind != kind) throw StaleRevisionException()
    return cursor
  }

  private fun cursorPath(cursor: TrackPageCursor): String =
    cursor.text3?.substringAfter('\u0000', "") ?: ""

  private fun cursorTitleKey(cursor: TrackPageCursor): String =
    cursor.text3?.substringBefore('\u0000') ?: ""

  private fun trackFromMetadata(
    generationId: String,
    sourceKey: String,
    folderId: Long,
    file: LocalAudioFile,
    metadata: LocalAudioMetadata,
    addedAt: Long,
  ): TrackEntity {
    fun clean(value: String?): String? = MediaTagCleanup.clean(value)
    val extension = file.name.substringAfterLast('.', "")
    val title = clean(metadata.title)
      ?: file.name.removeSuffix(if (extension.isEmpty()) "" else ".$extension")
    val artist = clean(metadata.artist) ?: "Unknown Artist"
    val album = clean(metadata.album) ?: "Unknown Album"
    val albumArtist = clean(metadata.albumArtist)
    val provisional = CatalogReadModelBuilder.provisionalIdentity(album, artist, albumArtist)
    val now = System.currentTimeMillis()
    return TrackEntity(
      generationId = generationId,
      sourceKey = sourceKey,
      path = file.uri,
      folderId = folderId,
      title = title,
      artist = artist,
      album = album,
      albumArtist = albumArtist,
      albumIdentityKey = provisional.first,
      albumDisplayArtist = provisional.second,
      duration = (metadata.durationMs ?: 0L) / 1_000.0,
      trackNumber = metadata.trackNumber,
      discNumber = metadata.discNumber,
      year = metadata.year,
      genre = clean(metadata.genre),
      artworkHash = metadata.artworkHash,
      format = extension.ifEmpty { "UNKNOWN" }.uppercase(java.util.Locale.ROOT),
      sampleRate = metadata.sampleRate,
      bitDepth = metadata.bitsPerSample,
      bitrate = metadata.bitrate,
      channels = metadata.channels,
      codec = codecFromMime(metadata.codecMime, metadata.mimeType),
      fileName = file.name,
      parentUri = file.parentUri,
      size = file.size,
      mtime = file.lastModified,
      addedAt = addedAt,
      modifiedAt = now,
      titleSortKey = SortKeys.forText(title),
      artistSortKey = SortKeys.forText(artist),
      albumSortKey = SortKeys.forText(album),
      fileNameSortKey = SortKeys.forText(file.name),
      discSort = metadata.discNumber ?: 0,
      trackSort = metadata.trackNumber ?: 0,
      sectionLabel = SortKeys.sectionLabel(title),
    )
  }

  private fun codecFromMime(trackMime: String?, containerMime: String?): String? {
    val mime = if (trackMime == "audio/raw" && containerMime != null) containerMime else trackMime
    return when (mime) {
      null -> null
      "audio/flac" -> "flac"
      "audio/mpeg" -> "mp3"
      "audio/mpeg-l2" -> "mp2"
      "audio/mp4a-latm", "audio/aac" -> "aac"
      "audio/alac" -> "alac"
      "audio/opus" -> "opus"
      "audio/vorbis" -> "vorbis"
      "audio/raw" -> "pcm"
      "audio/ac3" -> "ac3"
      "audio/eac3" -> "eac3"
      else -> mime.removePrefix("audio/")
    }
  }

  private suspend fun folderSubtreePaths(
    dao: CatalogDao,
    nodeId: String,
  ): List<String> {
    val revision = dao.getRevision()
    val node = dao.getDirectoryNode(revision, nodeId) ?: return emptyList()
    return dao.getActiveTracksForFolder(node.folderId)
      .asSequence()
      .filter { track ->
        val parentPath = track.parentUri?.let(::decodedSafDocumentPath) ?: return@filter false
        parentPath == node.directoryPath || parentPath.startsWith("${node.directoryPath}/")
      }
      .sortedWith(compareBy<ActiveTrackView>({ it.fileNameSortKey }, { it.path }))
      .map(ActiveTrackView::path)
      .toList()
  }

  private fun decodedSafDocumentPath(uri: String): String? = runCatching {
    android.net.Uri.decode(uri.substringAfter("/document/")).substringAfter(':')
  }.getOrNull()

  private fun remoteTrackFromMap(
    handle: RemoteSyncHandle,
    row: Map<String, Any?>,
    addedAt: Long,
  ): TrackEntity {
    fun string(key: String): String? = (row[key] as? String)?.trim()?.takeIf(String::isNotEmpty)
    fun int(key: String): Int? = (row[key] as? Number)?.toInt()
    fun double(key: String): Double? = (row[key] as? Number)?.toDouble()
    val path = requireNotNull(string("path"))
    val title = string("title") ?: path.substringAfterLast('/')
    val artist = string("artist") ?: "Unknown Artist"
    val album = string("album") ?: "Unknown Album"
    val albumArtist = string("album_artist")
    val provisional = CatalogReadModelBuilder.provisionalIdentity(album, artist, albumArtist)
    val now = System.currentTimeMillis()
    return TrackEntity(
      generationId = handle.generationId,
      sourceKey = handle.sourceKey,
      path = path,
      title = title,
      artist = artist,
      album = album,
      albumArtist = albumArtist,
      albumIdentityKey = provisional.first,
      albumDisplayArtist = provisional.second,
      duration = double("duration") ?: 0.0,
      trackNumber = int("track_number"),
      discNumber = int("disc_number"),
      year = int("year"),
      genre = string("genre"),
      artworkHash = string("artwork_hash"),
      format = string("format") ?: "UNKNOWN",
      sampleRate = int("sample_rate"),
      bitDepth = int("bit_depth"),
      bitrate = int("bitrate"),
      channels = int("channels"),
      codec = string("codec"),
      sourceType = handle.sourceType,
      sourceId = handle.sourceId,
      sourceTrackId = string("source_track_id"),
      sourcePath = string("source_path"),
      artworkSourceId = string("artwork_source_id"),
      fileName = string("source_path")?.substringAfterLast('/') ?: title,
      addedAt = addedAt,
      modifiedAt = now,
      replayGainTrackDb = double("replaygain_track_gain_db"),
      replayGainAlbumDb = double("replaygain_album_gain_db"),
      bpm = double("bpm"),
      musicalKey = string("musical_key"),
      titleSortKey = SortKeys.forText(title),
      artistSortKey = SortKeys.forText(artist),
      albumSortKey = SortKeys.forText(album),
      fileNameSortKey = SortKeys.forText(string("source_path") ?: title),
      discSort = int("disc_number") ?: 0,
      trackSort = int("track_number") ?: 0,
      sectionLabel = SortKeys.sectionLabel(title),
    )
  }

  private suspend fun removeCatalogSource(sourceKey: String) {
    catalogWriterMutex.withLock {
      val catalogDao = requireCatalog().catalogDao()
      val source = catalogDao.getSource(sourceKey) ?: return@withLock
      val remaining = catalogDao.getActiveTrackEntitiesExcludingSource(sourceKey)
      val nextRevision = catalogDao.getRevision() + 1
      val readModels = withContext(Dispatchers.Default) {
        CatalogReadModelBuilder.build(
          remaining,
          nextRevision,
          requireUser().userDao().getFolders().associateBy(FolderEntity::id),
        )
      }
      val revision = catalogDao.removeSourceAndPublish(
        sourceKey = sourceKey,
        generationId = source.activeGenerationId,
        now = System.currentTimeMillis(),
        albumIdentityUpdates = readModels.identityUpdates,
        albums = readModels.albums,
        artists = readModels.artists,
        artistTrackIndex = readModels.artistTrackIndex,
        directories = readModels.directories,
        ftsRows = readModels.ftsRows,
      )
      for (listener in catalogListeners) listener(revision)
    }
    refreshReadyStatus()
  }

  private suspend fun performLegacyCutoverIfNeeded(): String? {
    val preferences = applicationContext.getSharedPreferences(CUTOVER_PREFS, Context.MODE_PRIVATE)
    if (preferences.getBoolean(CUTOVER_COMPLETE, false)) return null

    val hadLegacyDatabase = applicationContext.getDatabasePath(LEGACY_DB_NAME).exists()
    applicationContext.deleteDatabase(LEGACY_DB_NAME)
    applicationContext.deleteDatabase(USER_DB_NAME)
    applicationContext.deleteDatabase(CATALOG_DB_NAME)
    for (permission in applicationContext.contentResolver.persistedUriPermissions) {
      runCatching {
        var flags = 0
        if (permission.isReadPermission) {
          flags = flags or android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION
        }
        if (permission.isWritePermission) {
          flags = flags or android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        }
        applicationContext.contentResolver.releasePersistableUriPermission(
          permission.uri,
          flags,
        )
      }
    }
    preferences.edit().putBoolean(CUTOVER_COMPLETE, true).commit()
    return if (hadLegacyDatabase) {
      "Astra's library engine was upgraded. Select your music folders to build the new library."
    } else {
      null
    }
  }

  private suspend fun openUserDatabaseWithRecovery(): AstraUserDatabase? {
    return try {
      buildUserDatabase().also(::forceOpen)
    } catch (error: Throwable) {
      if (!isCorruption(error)) throw error
      quarantineDatabase(USER_DB_NAME, "user")
      val snapshot = snapshots.newestValid() ?: return null
      runCatching {
        buildUserDatabase().also { database ->
          forceOpen(database)
          snapshots.restore(database, snapshot)
        }
      }.getOrNull()
    }
  }

  private fun openCatalogDatabaseWithRecovery(): AstraCatalogDatabase {
    return try {
      buildCatalogDatabase().also(::forceOpen)
    } catch (error: Throwable) {
      if (!isCorruption(error)) throw error
      quarantineDatabase(CATALOG_DB_NAME, "catalog")
      catalogRecoveredAtBootstrap = true
      buildCatalogDatabase().also(::forceOpen)
    }
  }

  private fun buildUserDatabase(): AstraUserDatabase =
    Room.databaseBuilder(applicationContext, AstraUserDatabase::class.java, USER_DB_NAME)
      .setJournalMode(RoomDatabase.JournalMode.WRITE_AHEAD_LOGGING)
      .build()

  private fun buildCatalogDatabase(): AstraCatalogDatabase =
    Room.databaseBuilder(applicationContext, AstraCatalogDatabase::class.java, CATALOG_DB_NAME)
      .setJournalMode(RoomDatabase.JournalMode.WRITE_AHEAD_LOGGING)
      .fallbackToDestructiveMigration(true)
      .build()

  private fun forceOpen(database: RoomDatabase) {
    database.openHelper.writableDatabase
  }

  private suspend fun <T> withCatalogRecovery(
    block: suspend (AstraCatalogDatabase) -> T,
  ): T {
    initialize()
    val database = requireCatalog()
    return try {
      block(database)
    } catch (error: Throwable) {
      if (!isCorruption(error)) throw error
      catalogRecoveryMutex.withLock {
        if (catalogDatabase === database) {
          database.close()
          quarantineDatabase(CATALOG_DB_NAME, "catalog")
          val replacement = buildCatalogDatabase()
          forceOpen(replacement)
          replacement.catalogDao().insertMeta(
            CatalogMetaEntity(
              collationVersion = COLLATION_VERSION,
              updatedAt = System.currentTimeMillis(),
            ),
          )
          catalogDatabase = replacement
          updateStatus(
            LibraryStatus.REBUILDING,
            0,
            0,
            message = "The catalog was damaged and is being rebuilt.",
            recoveryNotice = currentStatus.recoveryNotice,
          )
        }
      }
      block(requireCatalog())
    }
  }

  private suspend fun reconcileUserFacts() {
    val userDao = requireUser().userDao()
    val facts = LinkedHashMap<String, TrackUserFactEntity>()
    for (favorite in userDao.getFavorites()) {
      facts[favorite.trackPath] = TrackUserFactEntity(
        path = favorite.trackPath,
        isFavorite = true,
      )
    }
    for (history in userDao.getPlaybackHistory()) {
      val current = facts[history.trackPath]
      facts[history.trackPath] = TrackUserFactEntity(
        path = history.trackPath,
        isFavorite = current?.isFavorite ?: false,
        playCount = history.playCount,
        lastPlayedAt = history.lastPlayedAt,
      )
    }
    val dao = requireCatalog().catalogDao()
    dao.clearTrackUserFacts()
    if (facts.isNotEmpty()) dao.putTrackUserFacts(facts.values.toList())
  }

  private fun scheduleSnapshot() {
    pendingSnapshot?.cancel()
    pendingSnapshot = scope.launch {
      delay(SNAPSHOT_DEBOUNCE_MS)
      runCatching { flushSnapshot() }
    }
  }

  private fun updateStatus(
    status: LibraryStatus,
    revision: Long,
    count: Long,
    message: String? = null,
    recoveryNotice: String? = null,
  ) {
    val snapshot = LibraryStatusSnapshot(
      status = status,
      catalogRevision = revision,
      trackCount = count,
      message = message,
      recoveryNotice = recoveryNotice,
    )
    currentStatus = snapshot
    for (listener in listeners) listener(snapshot)
  }

  private fun requireUser(): AstraUserDatabase =
    userDatabase ?: error("Astra user database is unavailable")

  private fun requireCatalog(): AstraCatalogDatabase =
    catalogDatabase ?: error("Astra catalog database is unavailable")

  private fun quarantineDatabase(name: String, kind: String) {
    val quarantine = File(
      applicationContext.filesDir,
      "database-quarantine/${System.currentTimeMillis()}-${kind}-${UUID.randomUUID()}",
    )
    quarantine.mkdirs()
    for (suffix in listOf("", "-wal", "-shm")) {
      val source = File(applicationContext.getDatabasePath(name).path + suffix)
      if (!source.exists()) continue
      val target = File(quarantine, source.name)
      if (!source.renameTo(target)) {
        runCatching {
          source.copyTo(target, overwrite = true)
          source.delete()
        }
      }
    }
  }

  private fun isCorruption(error: Throwable): Boolean {
    var current: Throwable? = error
    while (current != null) {
      if (current is SQLiteDatabaseCorruptException) return true
      if (current is SQLiteException && current.message?.contains("malformed", ignoreCase = true) == true) {
        return true
      }
      current = current.cause
    }
    return false
  }

  companion object {
    @Volatile
    private var instance: AstraLibraryRepository? = null

    fun get(context: Context): AstraLibraryRepository =
      instance ?: synchronized(this) {
        instance ?: AstraLibraryRepository(context).also { instance = it }
      }

    fun localSourceKey(folderId: Long): String = "local:$folderId"

    fun remoteSourceKey(type: String, sourceId: Long): String = "$type:$sourceId"
  }
}
