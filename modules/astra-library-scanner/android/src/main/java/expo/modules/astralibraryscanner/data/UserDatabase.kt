package expo.modules.astralibraryscanner.data

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.room.Transaction
import androidx.room.Upsert
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import expo.modules.astralibraryscanner.queue.QUEUE_PARK_OFFSET
import expo.modules.astralibraryscanner.queue.QueueReorder
import expo.modules.astralibraryscanner.queue.QueueRowKey
import expo.modules.astralibraryscanner.queue.QueueWritePlan
import kotlinx.coroutines.flow.Flow

data class RemotePlaylistSyncPlan(
  val playlist: PlaylistEntity,
  val entries: List<PlaylistTrackEntity>,
)

@Dao
interface UserDao {
  @Query("SELECT * FROM settings WHERE key IN (:keys)")
  suspend fun getSettings(keys: List<String>): List<SettingEntity>

  @Query("SELECT value FROM settings WHERE key = :key")
  suspend fun getSetting(key: String): String?

  @Upsert
  suspend fun putSettings(settings: List<SettingEntity>)

  @Query("DELETE FROM settings WHERE key IN (:keys)")
  suspend fun deleteSettings(keys: List<String>)

  @Query("SELECT * FROM settings ORDER BY key")
  suspend fun snapshotSettings(): List<SettingEntity>

  @Query("SELECT * FROM folders ORDER BY added_at, id")
  suspend fun getFolders(): List<FolderEntity>

  @Query("SELECT * FROM folders WHERE id = :id")
  suspend fun getFolder(id: Long): FolderEntity?

  @Query("SELECT * FROM folders WHERE tree_uri = :treeUri")
  suspend fun getFolderByTreeUri(treeUri: String): FolderEntity?

  @Insert(onConflict = OnConflictStrategy.IGNORE)
  suspend fun insertFolder(folder: FolderEntity): Long

  @Upsert
  suspend fun putFolders(folders: List<FolderEntity>)

  @Query(
    """
      UPDATE folders
      SET display_name = :displayName
      WHERE tree_uri = :treeUri
    """,
  )
  suspend fun updateFolderName(treeUri: String, displayName: String)

  @Query(
    """
      UPDATE folders
      SET last_scanned_at = :scannedAt,
          last_scan_status = :status,
          last_scan_error = :error
      WHERE id = :folderId
    """,
  )
  suspend fun updateFolderScanState(
    folderId: Long,
    scannedAt: Long?,
    status: String,
    error: String?,
  )

  @Delete
  suspend fun deleteFolder(folder: FolderEntity)

  @Query("SELECT * FROM playlists ORDER BY COALESCE(last_played_at, 0) DESC, updated_at DESC, id")
  suspend fun getPlaylists(): List<PlaylistEntity>

  @Query("SELECT * FROM playlists WHERE id = :id")
  suspend fun getPlaylist(id: Long): PlaylistEntity?

  @Query("SELECT * FROM playlists WHERE sync_uid = :syncUid LIMIT 1")
  suspend fun getPlaylistBySyncUid(syncUid: String): PlaylistEntity?

  @Query("SELECT * FROM playlists WHERE remote_source_id IS NULL ORDER BY id")
  suspend fun getLocalPlaylists(): List<PlaylistEntity>

  @Insert
  suspend fun insertPlaylist(playlist: PlaylistEntity): Long

  @Upsert
  suspend fun putPlaylist(playlist: PlaylistEntity)

  @Upsert
  suspend fun putPlaylists(playlists: List<PlaylistEntity>)

  @Query("DELETE FROM playlists WHERE id = :id")
  suspend fun deletePlaylistById(id: Long)

  @Query("DELETE FROM playlists WHERE sync_uid = :syncUid")
  suspend fun deletePlaylistBySyncUid(syncUid: String)

  @Query("UPDATE playlists SET sync_uid = :syncUid WHERE id = :playlistId")
  suspend fun updatePlaylistSyncUid(playlistId: Long, syncUid: String)

  @Query("SELECT * FROM playlist_tracks WHERE playlist_id = :playlistId ORDER BY position, id")
  suspend fun getPlaylistTracks(playlistId: Long): List<PlaylistTrackEntity>

  @Query("SELECT * FROM playlist_tracks WHERE playlist_id = :playlistId ORDER BY position, id LIMIT :limit OFFSET :offset")
  suspend fun getPlaylistTrackPage(playlistId: Long, limit: Int, offset: Int): List<PlaylistTrackEntity>

  @Query("SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = :playlistId")
  suspend fun countPlaylistTracks(playlistId: Long): Long

  @Query("SELECT COALESCE(MAX(position), -1) FROM playlist_tracks WHERE playlist_id = :playlistId")
  suspend fun maxPlaylistPosition(playlistId: Long): Int

  @Query("SELECT * FROM playlist_tracks WHERE playlist_id = :playlistId AND track_path = :path")
  suspend fun getPlaylistTrackByPath(playlistId: Long, path: String): PlaylistTrackEntity?

  @Query("SELECT * FROM playlist_tracks ORDER BY playlist_id, position, id")
  suspend fun snapshotPlaylistTracks(): List<PlaylistTrackEntity>

  @Insert(onConflict = OnConflictStrategy.IGNORE)
  suspend fun insertPlaylistTracks(entries: List<PlaylistTrackEntity>): List<Long>

  @Upsert
  suspend fun putPlaylistTracks(entries: List<PlaylistTrackEntity>)

  @Query("DELETE FROM playlist_tracks WHERE id = :entryId")
  suspend fun deletePlaylistTrack(entryId: Long)

  @Query("DELETE FROM playlist_tracks WHERE playlist_id = :playlistId")
  suspend fun clearPlaylistTracks(playlistId: Long)

  @Query("UPDATE playlist_tracks SET position = :position WHERE id = :entryId")
  suspend fun updatePlaylistTrackPosition(entryId: Long, position: Int)

  @Query("UPDATE playlists SET updated_at = :updatedAt WHERE id = :playlistId")
  suspend fun touchPlaylist(playlistId: Long, updatedAt: Long)

  @Query("SELECT * FROM favorites ORDER BY added_at DESC")
  suspend fun getFavorites(): List<FavoriteEntity>

  @Query("SELECT EXISTS(SELECT 1 FROM favorites WHERE track_path = :path)")
  suspend fun isFavorite(path: String): Boolean

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun putFavorite(favorite: FavoriteEntity)

  @Upsert
  suspend fun putFavorites(favorites: List<FavoriteEntity>)

  @Query("DELETE FROM favorites WHERE track_path = :path")
  suspend fun deleteFavorite(path: String)

  @Query("DELETE FROM favorites WHERE track_path LIKE :prefix || '%'")
  suspend fun deleteFavoritesByPrefix(prefix: String)

  @Query("DELETE FROM playlists WHERE remote_source_id = :sourceId")
  suspend fun deleteRemotePlaylists(sourceId: Long)

  @Query("SELECT * FROM playlists WHERE remote_source_id = :sourceId")
  suspend fun getRemotePlaylists(sourceId: Long): List<PlaylistEntity>

  @Query("SELECT * FROM playback_history ORDER BY last_played_at DESC")
  suspend fun getPlaybackHistory(): List<PlaybackHistoryEntity>

  @Query("SELECT * FROM playback_history WHERE track_path = :path")
  suspend fun getPlaybackHistory(path: String): PlaybackHistoryEntity?

  @Upsert
  suspend fun putPlaybackHistory(history: PlaybackHistoryEntity)

  @Upsert
  suspend fun putPlaybackHistories(history: List<PlaybackHistoryEntity>)

  @Query("SELECT * FROM listening_history_meta WHERE id = 1")
  suspend fun getListeningHistoryMeta(): ListeningHistoryMetaEntity?

  @Upsert
  suspend fun putListeningHistoryMeta(meta: ListeningHistoryMetaEntity)

  @Query("SELECT * FROM listening_sessions WHERE session_key = :sessionKey")
  suspend fun getListeningSession(sessionKey: String): ListeningSessionEntity?

  @Upsert
  suspend fun putListeningSession(session: ListeningSessionEntity)

  @Query(
    """
      SELECT * FROM listening_sessions
      WHERE generation = :generation
        AND (
          session_key IN (
            SELECT session_key FROM listening_segments
            WHERE generation = :generation
              AND last_observed_at >= :startAt
              AND started_at <= :endAt
          )
          OR (qualified_at >= :startAt AND qualified_at <= :endAt)
        )
      ORDER BY started_at
    """,
  )
  suspend fun getListeningSessionsInRange(
    generation: String,
    startAt: Long,
    endAt: Long,
  ): List<ListeningSessionEntity>

  @Query(
    """
      UPDATE listening_sessions
      SET qualified_at = :qualifiedAt
      WHERE session_key = :sessionKey
        AND generation = :generation
        AND qualified_at IS NULL
    """,
  )
  suspend fun qualifyListeningSession(
    sessionKey: String,
    generation: String,
    qualifiedAt: Long,
  ): Int

  @Query(
    """
      SELECT * FROM listening_segments
      WHERE generation = :generation
        AND last_observed_at >= :startAt
        AND started_at <= :endAt
      ORDER BY started_at
    """,
  )
  suspend fun getListeningSegmentsInRange(
    generation: String,
    startAt: Long,
    endAt: Long,
  ): List<ListeningSegmentEntity>

  @Query(
    """
      SELECT * FROM listening_segments
      WHERE session_key = :sessionKey AND segment_key = :segmentKey
    """,
  )
  suspend fun getListeningSegment(
    sessionKey: String,
    segmentKey: String,
  ): ListeningSegmentEntity?

  @Upsert
  suspend fun putListeningSegment(segment: ListeningSegmentEntity)

  @Query("DELETE FROM listening_segments")
  suspend fun clearListeningSegments()

  @Query("DELETE FROM listening_sessions")
  suspend fun clearListeningSessions()

  @Query("DELETE FROM listening_history_meta")
  suspend fun clearListeningHistoryMeta()

  @Query("SELECT * FROM remote_sources ORDER BY created_at, id")
  suspend fun getRemoteSources(): List<RemoteSourceEntity>

  @Query("SELECT * FROM remote_sources WHERE id = :id")
  suspend fun getRemoteSource(id: Long): RemoteSourceEntity?

  @Insert
  suspend fun insertRemoteSource(source: RemoteSourceEntity): Long

  @Upsert
  suspend fun putRemoteSource(source: RemoteSourceEntity)

  @Upsert
  suspend fun putRemoteSources(sources: List<RemoteSourceEntity>)

  @Query("DELETE FROM remote_sources WHERE id = :id")
  suspend fun deleteRemoteSource(id: Long)

  @Query("SELECT * FROM favorite_tombstones ORDER BY sync_key")
  suspend fun getFavoriteTombstones(): List<FavoriteTombstoneEntity>

  @Upsert
  suspend fun putFavoriteTombstones(rows: List<FavoriteTombstoneEntity>)

  @Query("DELETE FROM favorite_tombstones WHERE sync_key IN (:syncKeys)")
  suspend fun deleteFavoriteTombstones(syncKeys: List<String>)

  @Query("SELECT * FROM favorite_sync_pending ORDER BY sync_key")
  suspend fun getPendingFavorites(): List<PendingFavoriteEntity>

  @Upsert
  suspend fun putPendingFavorites(rows: List<PendingFavoriteEntity>)

  @Query("DELETE FROM favorite_sync_pending WHERE sync_key IN (:syncKeys)")
  suspend fun deletePendingFavorites(syncKeys: List<String>)

  @Query("SELECT * FROM playlist_tombstones ORDER BY sync_uid")
  suspend fun getPlaylistTombstones(): List<PlaylistTombstoneEntity>

  @Upsert
  suspend fun putPlaylistTombstones(rows: List<PlaylistTombstoneEntity>)

  @Query("DELETE FROM playlist_tombstones WHERE sync_uid IN (:syncUids)")
  suspend fun deletePlaylistTombstones(syncUids: List<String>)

  @Query("SELECT * FROM playlist_sync_state ORDER BY sync_uid")
  suspend fun getPlaylistSyncStates(): List<PlaylistSyncStateEntity>

  @Upsert
  suspend fun putPlaylistSyncStates(rows: List<PlaylistSyncStateEntity>)

  @Query("DELETE FROM playlist_sync_state WHERE sync_uid IN (:syncUids)")
  suspend fun deletePlaylistSyncStates(syncUids: List<String>)

  @Query("DELETE FROM playlist_sync_state")
  suspend fun clearPlaylistSyncStates()

  @Query("SELECT * FROM playback_sessions WHERE id = :id")
  suspend fun getPlaybackSession(id: String): PlaybackSessionEntity?

  @Query("SELECT * FROM playback_sessions WHERE id = :id")
  fun observePlaybackSession(id: String): Flow<PlaybackSessionEntity?>

  @Query("SELECT * FROM playback_sessions ORDER BY updated_at DESC LIMIT 1")
  suspend fun getLatestPlaybackSession(): PlaybackSessionEntity?

  @Query("SELECT * FROM playback_sessions ORDER BY id")
  suspend fun getPlaybackSessions(): List<PlaybackSessionEntity>

  @Upsert
  suspend fun putPlaybackSession(session: PlaybackSessionEntity)

  @Query(
    """
      UPDATE playback_sessions
      SET active_position = :activePosition,
          anchor_path = :anchorPath,
          updated_at = :updatedAt
      WHERE id = :sessionId
    """,
  )
  suspend fun updatePlaybackPosition(
    sessionId: String,
    activePosition: Long,
    anchorPath: String?,
    updatedAt: Long,
  )

  @Query("DELETE FROM playback_sessions WHERE id = :id")
  suspend fun deletePlaybackSession(id: String)

  @Query(
    """
      SELECT * FROM playback_queue_entries
      WHERE session_id = :sessionId
        AND position >= :start
      ORDER BY position
      LIMIT :limit
    """,
  )
  suspend fun getQueueWindow(
    sessionId: String,
    start: Long,
    limit: Int,
  ): List<PlaybackQueueEntryEntity>

  @Query("SELECT * FROM playback_queue_entries WHERE session_id = :sessionId ORDER BY position")
  suspend fun getAllQueueEntries(sessionId: String): List<PlaybackQueueEntryEntity>

  @Query("SELECT * FROM playback_queue_entries WHERE session_id = :sessionId ORDER BY position")
  fun observeQueueEntries(sessionId: String): Flow<List<PlaybackQueueEntryEntity>>

  @Upsert
  suspend fun putQueueEntries(entries: List<PlaybackQueueEntryEntity>)

  @Query("DELETE FROM playback_queue_entries WHERE session_id = :sessionId")
  suspend fun clearQueueEntries(sessionId: String)

  @Query(
    """
      UPDATE playback_queue_entries
      SET position = position + :offset
      WHERE session_id = :sessionId AND position >= :start
    """,
  )
  suspend fun parkQueuePositions(
    sessionId: String,
    start: Long,
    offset: Long,
  )

  @Query(
    """
      DELETE FROM playback_queue_entries
      WHERE session_id = :sessionId AND entry_id IN (:entryIds)
    """,
  )
  suspend fun deleteQueueEntriesById(sessionId: String, entryIds: List<Long>)

  @Query(
    """
      UPDATE playback_queue_entries
      SET position = position + :delta
      WHERE session_id = :sessionId
        AND position >= :fromPosition
        AND position <= :toPosition
    """,
  )
  suspend fun shiftQueueRange(
    sessionId: String,
    fromPosition: Long,
    toPosition: Long,
    delta: Long,
  )

  @Query(
    """
      UPDATE playback_queue_entries
      SET position = :position
      WHERE session_id = :sessionId AND entry_id = :entryId
    """,
  )
  suspend fun setQueueEntryPosition(sessionId: String, entryId: Long, position: Long)

  @Query("SELECT COUNT(*) FROM playback_queue_entries WHERE session_id = :sessionId")
  suspend fun countQueueEntries(sessionId: String): Long

  @Query("SELECT * FROM playback_original_queue_entries WHERE session_id = :sessionId ORDER BY position")
  suspend fun getOriginalQueueEntries(sessionId: String): List<PlaybackOriginalQueueEntryEntity>

  @Upsert
  suspend fun putOriginalQueueEntries(entries: List<PlaybackOriginalQueueEntryEntity>)

  @Query("DELETE FROM playback_original_queue_entries WHERE session_id = :sessionId")
  suspend fun clearOriginalQueueEntries(sessionId: String)

  @Query(
    """
      UPDATE playback_original_queue_entries
      SET position = position + :offset
      WHERE session_id = :sessionId AND position >= :start
    """,
  )
  suspend fun parkOriginalQueuePositions(
    sessionId: String,
    start: Long,
    offset: Long,
  )

  @Query(
    """
      DELETE FROM playback_original_queue_entries
      WHERE session_id = :sessionId AND entry_id IN (:entryIds)
    """,
  )
  suspend fun deleteOriginalQueueEntriesById(sessionId: String, entryIds: List<Long>)

  @Query(
    """
      UPDATE playback_original_queue_entries
      SET position = position + :delta
      WHERE session_id = :sessionId
        AND position >= :fromPosition
        AND position <= :toPosition
    """,
  )
  suspend fun shiftOriginalQueueRange(
    sessionId: String,
    fromPosition: Long,
    toPosition: Long,
    delta: Long,
  )

  @Query(
    """
      UPDATE playback_original_queue_entries
      SET position = :position
      WHERE session_id = :sessionId AND entry_id = :entryId
    """,
  )
  suspend fun setOriginalQueueEntryPosition(sessionId: String, entryId: Long, position: Long)

  @Query("SELECT * FROM snapshot_metadata WHERE id = 1")
  suspend fun getSnapshotMetadata(): SnapshotMetadataEntity?

  @Upsert
  suspend fun putSnapshotMetadata(metadata: SnapshotMetadataEntity)

  @Transaction
  suspend fun replacePlaybackQueue(
    session: PlaybackSessionEntity,
    entries: List<PlaybackQueueEntryEntity>,
    originalEntries: List<PlaybackOriginalQueueEntryEntity> = emptyList(),
  ) {
    putPlaybackSession(session)
    clearQueueEntries(session.id)
    if (entries.isNotEmpty()) putQueueEntries(entries)
    clearOriginalQueueEntries(session.id)
    if (originalEntries.isNotEmpty()) putOriginalQueueEntries(originalEntries)
  }

  /**
   * Rewrites only the position range changed by an edit. Rows are parked in a
   * disjoint position space first so the unique (session, position) index never
   * observes a transient collision during moves.
   */
  @Transaction
  suspend fun applyPlaybackQueueMutation(
    session: PlaybackSessionEntity,
    entries: List<PlaybackQueueEntryEntity>,
    originalEntries: List<PlaybackOriginalQueueEntryEntity>,
  ) {
    val oldEntries = getAllQueueEntries(session.id)
    putPlaybackSession(session)
    // Removals and single moves — the edits a user performs on an open queue —
    // become a handful of range UPDATEs. The fallback below rewrites every row
    // from the change point, which for an edit near the active track means
    // marshalling almost the whole queue through Room on every tap.
    when (val plan = QueueReorder.planWrite(oldEntries.asRowKeys(), entries.asRowKeys())) {
      QueueWritePlan.NoChange -> Unit

      is QueueWritePlan.Removal -> {
        deleteQueueEntriesById(session.id, plan.removedIds)
        parkQueuePositions(session.id, plan.removedPositions.min(), QUEUE_PARK_OFFSET)
        QueueReorder.compactionShifts(plan.removedPositions).forEach { shift ->
          shiftQueueRange(session.id, shift.fromPosition, shift.toPosition, shift.delta)
        }
      }

      is QueueWritePlan.Move -> {
        val move = QueueReorder.movePlan(plan.from, plan.to)
        if (move == null) {
          rebuildQueueTail(session.id, oldEntries, entries)
        } else {
          setQueueEntryPosition(session.id, plan.entryId, move.parkedMovedPosition)
          move.spanOut?.let { shiftQueueRange(session.id, it.fromPosition, it.toPosition, it.delta) }
          move.spanBack?.let { shiftQueueRange(session.id, it.fromPosition, it.toPosition, it.delta) }
          setQueueEntryPosition(session.id, plan.entryId, move.finalPosition)
        }
      }

      QueueWritePlan.Rebuild -> rebuildQueueTail(session.id, oldEntries, entries)
    }

    val oldOriginal = getOriginalQueueEntries(session.id)
    if (originalEntries.isEmpty()) {
      if (oldOriginal.isNotEmpty()) clearOriginalQueueEntries(session.id)
      return
    }
    when (
      val plan = QueueReorder.planWrite(oldOriginal.asOriginalRowKeys(), originalEntries.asOriginalRowKeys())
    ) {
      QueueWritePlan.NoChange -> Unit

      is QueueWritePlan.Removal -> {
        deleteOriginalQueueEntriesById(session.id, plan.removedIds)
        parkOriginalQueuePositions(session.id, plan.removedPositions.min(), QUEUE_PARK_OFFSET)
        QueueReorder.compactionShifts(plan.removedPositions).forEach { shift ->
          shiftOriginalQueueRange(session.id, shift.fromPosition, shift.toPosition, shift.delta)
        }
      }

      is QueueWritePlan.Move -> {
        val move = QueueReorder.movePlan(plan.from, plan.to)
        if (move == null) {
          rebuildOriginalQueueTail(session.id, oldOriginal, originalEntries)
        } else {
          setOriginalQueueEntryPosition(session.id, plan.entryId, move.parkedMovedPosition)
          move.spanOut?.let {
            shiftOriginalQueueRange(session.id, it.fromPosition, it.toPosition, it.delta)
          }
          move.spanBack?.let {
            shiftOriginalQueueRange(session.id, it.fromPosition, it.toPosition, it.delta)
          }
          setOriginalQueueEntryPosition(session.id, plan.entryId, move.finalPosition)
        }
      }

      QueueWritePlan.Rebuild -> rebuildOriginalQueueTail(session.id, oldOriginal, originalEntries)
    }
  }

  /** The pre-existing write path: park the tail, drop removals, upsert from the change point. */
  private suspend fun rebuildQueueTail(
    sessionId: String,
    before: List<PlaybackQueueEntryEntity>,
    after: List<PlaybackQueueEntryEntity>,
  ) {
    val changedAt = firstChangedQueuePosition(before, after) ?: return
    parkQueuePositions(sessionId, changedAt.toLong(), QUEUE_PARK_OFFSET)
    val retainedIds = after.mapTo(hashSetOf(), PlaybackQueueEntryEntity::entryId)
    val removedIds = before
      .asSequence()
      .map(PlaybackQueueEntryEntity::entryId)
      .filterNot(retainedIds::contains)
      .toList()
    if (removedIds.isNotEmpty()) deleteQueueEntriesById(sessionId, removedIds)
    val changedRows = after.drop(changedAt)
    if (changedRows.isNotEmpty()) putQueueEntries(changedRows)
  }

  private suspend fun rebuildOriginalQueueTail(
    sessionId: String,
    before: List<PlaybackOriginalQueueEntryEntity>,
    after: List<PlaybackOriginalQueueEntryEntity>,
  ) {
    val changedAt = firstChangedOriginalPosition(before, after) ?: return
    parkOriginalQueuePositions(sessionId, changedAt.toLong(), QUEUE_PARK_OFFSET)
    val retainedIds = after.mapTo(hashSetOf(), PlaybackOriginalQueueEntryEntity::entryId)
    val removedIds = before
      .asSequence()
      .map(PlaybackOriginalQueueEntryEntity::entryId)
      .filterNot(retainedIds::contains)
      .toList()
    if (removedIds.isNotEmpty()) deleteOriginalQueueEntriesById(sessionId, removedIds)
    val changedRows = after.drop(changedAt)
    if (changedRows.isNotEmpty()) putOriginalQueueEntries(changedRows)
  }

  private fun List<PlaybackQueueEntryEntity>.asRowKeys(): List<QueueRowKey> =
    map { QueueRowKey(it.entryId, it.trackPath, it.position) }

  private fun List<PlaybackOriginalQueueEntryEntity>.asOriginalRowKeys(): List<QueueRowKey> =
    map { QueueRowKey(it.entryId, it.trackPath, it.position) }

  private fun firstChangedQueuePosition(
    before: List<PlaybackQueueEntryEntity>,
    after: List<PlaybackQueueEntryEntity>,
  ): Int? {
    val shared = minOf(before.size, after.size)
    for (index in 0 until shared) {
      if (
        before[index].entryId != after[index].entryId ||
        before[index].trackPath != after[index].trackPath
      ) return index
    }
    return shared.takeIf { before.size != after.size }
  }

  private fun firstChangedOriginalPosition(
    before: List<PlaybackOriginalQueueEntryEntity>,
    after: List<PlaybackOriginalQueueEntryEntity>,
  ): Int? {
    val shared = minOf(before.size, after.size)
    for (index in 0 until shared) {
      if (
        before[index].entryId != after[index].entryId ||
        before[index].trackPath != after[index].trackPath
      ) return index
    }
    return shared.takeIf { before.size != after.size }
  }

  @Transaction
  suspend fun replaceRemoteUserState(
    sourceId: Long,
    favoritePrefix: String,
    favorites: List<FavoriteEntity>,
    playlists: List<RemotePlaylistSyncPlan>,
  ) {
    deleteFavoritesByPrefix(favoritePrefix)
    if (favorites.isNotEmpty()) putFavorites(favorites)

    val existing = getRemotePlaylists(sourceId).associateBy { it.remotePlaylistId }
    val incomingIds = playlists.mapNotNullTo(hashSetOf()) { it.playlist.remotePlaylistId }
    for (stale in existing.values) {
      if (stale.remotePlaylistId !in incomingIds) deletePlaylistById(stale.id)
    }
    for (plan in playlists) {
      val remoteId = plan.playlist.remotePlaylistId ?: continue
      val old = existing[remoteId]
      val playlistId = if (old == null) {
        insertPlaylist(plan.playlist)
      } else {
        putPlaylist(
          plan.playlist.copy(
            id = old.id,
            createdAt = old.createdAt,
            lastPlayedAt = old.lastPlayedAt,
          ),
        )
        old.id
      }
      replacePlaylistEntries(
        playlistId,
        plan.entries.map { it.copy(playlistId = playlistId) },
      )
    }
  }

  @Transaction
  suspend fun replacePlaylistEntries(
    playlistId: Long,
    entries: List<PlaylistTrackEntity>,
  ) {
    clearPlaylistTracks(playlistId)
    if (entries.isNotEmpty()) putPlaylistTracks(entries)
  }

  @Transaction
  suspend fun appendPlaylistTracks(
    playlistId: Long,
    entries: List<PlaylistTrackEntity>,
    updatedAt: Long,
  ): Int {
    val existing = getPlaylistTracks(playlistId).mapTo(hashSetOf()) { it.trackPath }
    var position = maxPlaylistPosition(playlistId)
    var inserted = 0
    for (entry in entries) {
      if (!existing.add(entry.trackPath)) continue
      position += 1
      val result = insertPlaylistTracks(listOf(entry.copy(position = position, addedAt = updatedAt)))
      if (result.firstOrNull() != -1L) inserted += 1
    }
    if (inserted > 0) touchPlaylist(playlistId, updatedAt)
    return inserted
  }

  @Transaction
  suspend fun removePlaylistTrackByPath(playlistId: Long, path: String, updatedAt: Long) {
    val row = getPlaylistTrackByPath(playlistId, path) ?: return
    deletePlaylistTrack(row.id)
    getPlaylistTracks(playlistId).forEachIndexed { index, entry ->
      if (entry.position != index) updatePlaylistTrackPosition(entry.id, index)
    }
    touchPlaylist(playlistId, updatedAt)
  }

  @Transaction
  suspend fun movePlaylistTrackByPath(
    playlistId: Long,
    path: String,
    direction: Int,
    updatedAt: Long,
  ) {
    val rows = getPlaylistTracks(playlistId)
    val index = rows.indexOfFirst { it.trackPath == path }
    if (index < 0) return
    val neighborIndex = index + direction
    if (neighborIndex !in rows.indices) return
    val row = rows[index]
    val neighbor = rows[neighborIndex]
    updatePlaylistTrackPosition(row.id, neighbor.position)
    updatePlaylistTrackPosition(neighbor.id, row.position)
    touchPlaylist(playlistId, updatedAt)
  }
}

@Database(
  entities = [
    SettingEntity::class,
    FolderEntity::class,
    PlaylistEntity::class,
    PlaylistTrackEntity::class,
    FavoriteEntity::class,
    PlaybackHistoryEntity::class,
    ListeningHistoryMetaEntity::class,
    ListeningSessionEntity::class,
    ListeningSegmentEntity::class,
    RemoteSourceEntity::class,
    FavoriteTombstoneEntity::class,
    PendingFavoriteEntity::class,
    PlaylistTombstoneEntity::class,
    PlaylistSyncStateEntity::class,
    PlaybackSessionEntity::class,
    PlaybackQueueEntryEntity::class,
    PlaybackOriginalQueueEntryEntity::class,
    SnapshotMetadataEntity::class,
  ],
  version = 3,
  exportSchema = true,
)
abstract class AstraUserDatabase : RoomDatabase() {
  abstract fun userDao(): UserDao
}

internal val USER_MIGRATION_1_2 = object : Migration(1, 2) {
  override fun migrate(database: SupportSQLiteDatabase) {
    database.execSQL(
      """
        CREATE TABLE IF NOT EXISTS `listening_history_meta` (
          `id` INTEGER NOT NULL,
          `generation` TEXT NOT NULL,
          `started_at` INTEGER,
          PRIMARY KEY(`id`)
        )
      """.trimIndent(),
    )
    database.execSQL(
      """
        CREATE TABLE IF NOT EXISTS `listening_sessions` (
          `session_key` TEXT NOT NULL,
          `generation` TEXT NOT NULL,
          `track_path` TEXT NOT NULL,
          `title` TEXT NOT NULL,
          `artist` TEXT NOT NULL,
          `artist_names_json` TEXT,
          `album` TEXT NOT NULL,
          `album_artist` TEXT,
          `album_artist_names_json` TEXT,
          `album_identity_key` TEXT NOT NULL,
          `artwork_hash` TEXT,
          `source_type` TEXT NOT NULL,
          `source_id` INTEGER,
          `artwork_source_id` TEXT,
          `duration_seconds` REAL NOT NULL,
          `started_at` INTEGER NOT NULL,
          `ended_at` INTEGER,
          `listened_seconds` REAL NOT NULL,
          `qualified_at` INTEGER,
          PRIMARY KEY(`session_key`)
        )
      """.trimIndent(),
    )
    database.execSQL(
      """
        CREATE TABLE IF NOT EXISTS `listening_segments` (
          `session_key` TEXT NOT NULL,
          `segment_key` TEXT NOT NULL,
          `generation` TEXT NOT NULL,
          `started_at` INTEGER NOT NULL,
          `last_observed_at` INTEGER NOT NULL,
          `ended_at` INTEGER,
          `listened_seconds` REAL NOT NULL,
          PRIMARY KEY(`session_key`, `segment_key`),
          FOREIGN KEY(`session_key`) REFERENCES `listening_sessions`(`session_key`)
            ON UPDATE NO ACTION ON DELETE CASCADE
        )
      """.trimIndent(),
    )
    database.execSQL(
      "CREATE INDEX IF NOT EXISTS `index_listening_sessions_generation_started_at` " +
        "ON `listening_sessions` (`generation`, `started_at`)",
    )
    database.execSQL(
      "CREATE INDEX IF NOT EXISTS `index_listening_sessions_generation_qualified_at` " +
        "ON `listening_sessions` (`generation`, `qualified_at`)",
    )
    database.execSQL(
      "CREATE INDEX IF NOT EXISTS `index_listening_sessions_track_path` " +
        "ON `listening_sessions` (`track_path`)",
    )
    database.execSQL(
      "CREATE INDEX IF NOT EXISTS `index_listening_segments_generation_started_at_last_observed_at` " +
        "ON `listening_segments` (`generation`, `started_at`, `last_observed_at`)",
    )
    database.execSQL(
      "CREATE INDEX IF NOT EXISTS `index_listening_segments_session_key` " +
        "ON `listening_segments` (`session_key`)",
    )
  }
}

internal val USER_MIGRATION_2_3 = object : Migration(2, 3) {
  override fun migrate(database: SupportSQLiteDatabase) {
    database.execSQL(
      "ALTER TABLE `playback_sessions` ADD COLUMN `queue_revision` INTEGER NOT NULL DEFAULT 0",
    )
    database.execSQL(
      "ALTER TABLE `playback_sessions` ADD COLUMN `catalog_revision` INTEGER",
    )
    database.execSQL(
      "ALTER TABLE `playback_sessions` ADD COLUMN `is_dirty` INTEGER NOT NULL DEFAULT 0",
    )
    database.execSQL(
      "ALTER TABLE `playback_sessions` ADD COLUMN `next_entry_id` INTEGER NOT NULL DEFAULT 0",
    )

    database.execSQL(
      """
        CREATE TABLE IF NOT EXISTS `playback_queue_entries_new` (
          `session_id` TEXT NOT NULL,
          `entry_id` INTEGER NOT NULL,
          `position` INTEGER NOT NULL,
          `track_path` TEXT NOT NULL,
          PRIMARY KEY(`session_id`, `entry_id`),
          FOREIGN KEY(`session_id`) REFERENCES `playback_sessions`(`id`)
            ON UPDATE NO ACTION ON DELETE CASCADE
        )
      """.trimIndent(),
    )
    database.execSQL(
      """
        INSERT INTO `playback_queue_entries_new` (`session_id`, `entry_id`, `position`, `track_path`)
        SELECT `session_id`, `position`, `position`, `track_path`
        FROM `playback_queue_entries`
      """.trimIndent(),
    )

    database.execSQL(
      """
        CREATE TABLE IF NOT EXISTS `playback_original_queue_entries_new` (
          `session_id` TEXT NOT NULL,
          `entry_id` INTEGER NOT NULL,
          `position` INTEGER NOT NULL,
          `track_path` TEXT NOT NULL,
          PRIMARY KEY(`session_id`, `entry_id`),
          FOREIGN KEY(`session_id`) REFERENCES `playback_sessions`(`id`)
            ON UPDATE NO ACTION ON DELETE CASCADE
        )
      """.trimIndent(),
    )

    val idsBySessionAndPath = mutableMapOf<Pair<String, String>, java.util.ArrayDeque<Long>>()
    var nextSyntheticId = 0L
    database.query(
      """
        SELECT `session_id`, `entry_id`, `track_path`
        FROM `playback_queue_entries_new`
        ORDER BY `session_id`, `position`
      """.trimIndent(),
    ).use { cursor ->
      while (cursor.moveToNext()) {
        val sessionId = cursor.getString(0)
        val entryId = cursor.getLong(1)
        val path = cursor.getString(2)
        idsBySessionAndPath
          .getOrPut(sessionId to path) { java.util.ArrayDeque() }
          .addLast(entryId)
        nextSyntheticId = maxOf(nextSyntheticId, entryId + 1)
      }
    }
    database.compileStatement(
      """
        INSERT INTO `playback_original_queue_entries_new`
          (`session_id`, `entry_id`, `position`, `track_path`)
        VALUES (?, ?, ?, ?)
      """.trimIndent(),
    ).use { insert ->
      database.query(
        """
          SELECT `session_id`, `position`, `track_path`
          FROM `playback_original_queue_entries`
          ORDER BY `session_id`, `position`
        """.trimIndent(),
      ).use { cursor ->
        while (cursor.moveToNext()) {
          val sessionId = cursor.getString(0)
          val position = cursor.getLong(1)
          val path = cursor.getString(2)
          val matchingIds = idsBySessionAndPath[sessionId to path]
          val entryId = if (matchingIds != null && matchingIds.isNotEmpty()) {
            matchingIds.removeFirst()
          } else {
            nextSyntheticId++
          }
          insert.clearBindings()
          insert.bindString(1, sessionId)
          insert.bindLong(2, entryId)
          insert.bindLong(3, position)
          insert.bindString(4, path)
          insert.executeInsert()
        }
      }
    }

    database.execSQL("DROP TABLE `playback_queue_entries`")
    database.execSQL("ALTER TABLE `playback_queue_entries_new` RENAME TO `playback_queue_entries`")
    database.execSQL("DROP TABLE `playback_original_queue_entries`")
    database.execSQL(
      "ALTER TABLE `playback_original_queue_entries_new` RENAME TO `playback_original_queue_entries`",
    )
    database.execSQL(
      "CREATE UNIQUE INDEX IF NOT EXISTS `index_playback_queue_entries_session_id_position` " +
        "ON `playback_queue_entries` (`session_id`, `position`)",
    )
    database.execSQL(
      "CREATE INDEX IF NOT EXISTS `index_playback_queue_entries_session_id_track_path` " +
        "ON `playback_queue_entries` (`session_id`, `track_path`)",
    )
    database.execSQL(
      "CREATE UNIQUE INDEX IF NOT EXISTS `index_playback_original_queue_entries_session_id_position` " +
        "ON `playback_original_queue_entries` (`session_id`, `position`)",
    )
    database.execSQL(
      "CREATE INDEX IF NOT EXISTS `index_playback_original_queue_entries_session_id_track_path` " +
        "ON `playback_original_queue_entries` (`session_id`, `track_path`)",
    )
    database.execSQL(
      """
        UPDATE `playback_sessions`
        SET `queue_revision` = CASE
              WHEN EXISTS (
                SELECT 1 FROM `playback_queue_entries`
                WHERE `session_id` = `playback_sessions`.`id`
              ) THEN 1
              ELSE 0
            END,
            `next_entry_id` = COALESCE(
              (
                SELECT MAX(`entry_id`) + 1
                FROM `playback_queue_entries`
                WHERE `session_id` = `playback_sessions`.`id`
              ),
              0
            )
      """.trimIndent(),
    )
  }
}
