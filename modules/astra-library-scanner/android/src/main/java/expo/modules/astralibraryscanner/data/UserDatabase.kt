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

  @Upsert
  suspend fun putQueueEntries(entries: List<PlaybackQueueEntryEntity>)

  @Query("DELETE FROM playback_queue_entries WHERE session_id = :sessionId")
  suspend fun clearQueueEntries(sessionId: String)

  @Query("SELECT COUNT(*) FROM playback_queue_entries WHERE session_id = :sessionId")
  suspend fun countQueueEntries(sessionId: String): Long

  @Query("SELECT * FROM playback_original_queue_entries WHERE session_id = :sessionId ORDER BY position")
  suspend fun getOriginalQueueEntries(sessionId: String): List<PlaybackOriginalQueueEntryEntity>

  @Upsert
  suspend fun putOriginalQueueEntries(entries: List<PlaybackOriginalQueueEntryEntity>)

  @Query("DELETE FROM playback_original_queue_entries WHERE session_id = :sessionId")
  suspend fun clearOriginalQueueEntries(sessionId: String)

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
  version = 1,
  exportSchema = true,
)
abstract class AstraUserDatabase : RoomDatabase() {
  abstract fun userDao(): UserDao
}
