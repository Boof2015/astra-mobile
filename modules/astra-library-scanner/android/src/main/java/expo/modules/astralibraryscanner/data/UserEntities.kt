package expo.modules.astralibraryscanner.data

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "settings")
data class SettingEntity(
  @PrimaryKey val key: String,
  val value: String,
)

@Entity(
  tableName = "folders",
  indices = [Index(value = ["tree_uri"], unique = true)],
)
data class FolderEntity(
  @PrimaryKey(autoGenerate = true) val id: Long = 0,
  @ColumnInfo(name = "tree_uri") val treeUri: String,
  @ColumnInfo(name = "display_name") val displayName: String,
  @ColumnInfo(name = "added_at") val addedAt: Long,
  @ColumnInfo(name = "last_scanned_at") val lastScannedAt: Long? = null,
  @ColumnInfo(name = "last_scan_status") val lastScanStatus: String = "never",
  @ColumnInfo(name = "last_scan_error") val lastScanError: String? = null,
)

@Entity(
  tableName = "playlists",
  indices = [
    Index(value = ["sync_uid"], unique = true),
    Index(value = ["remote_source_id", "remote_playlist_id"], unique = true),
    Index(value = ["kind"]),
  ],
)
data class PlaylistEntity(
  @PrimaryKey(autoGenerate = true) val id: Long = 0,
  val name: String,
  @ColumnInfo(name = "created_at") val createdAt: Long,
  @ColumnInfo(name = "updated_at") val updatedAt: Long,
  @ColumnInfo(name = "last_played_at") val lastPlayedAt: Long? = null,
  val kind: String = "normal",
  @ColumnInfo(name = "dynamic_rules_json") val dynamicRulesJson: String? = null,
  @ColumnInfo(name = "remote_source_id") val remoteSourceId: Long? = null,
  @ColumnInfo(name = "remote_playlist_id") val remotePlaylistId: String? = null,
  @ColumnInfo(name = "sync_uid") val syncUid: String? = null,
)

@Entity(
  tableName = "playlist_tracks",
  foreignKeys = [
    ForeignKey(
      entity = PlaylistEntity::class,
      parentColumns = ["id"],
      childColumns = ["playlist_id"],
      onDelete = ForeignKey.CASCADE,
    ),
  ],
  indices = [
    Index(value = ["playlist_id", "position"]),
    Index(value = ["playlist_id", "track_path"], unique = true),
  ],
)
data class PlaylistTrackEntity(
  @PrimaryKey(autoGenerate = true) val id: Long = 0,
  @ColumnInfo(name = "playlist_id") val playlistId: Long,
  @ColumnInfo(name = "track_path") val trackPath: String,
  val position: Int,
  @ColumnInfo(name = "added_at") val addedAt: Long,
  @ColumnInfo(name = "fallback_title") val fallbackTitle: String? = null,
  @ColumnInfo(name = "fallback_artist") val fallbackArtist: String? = null,
  @ColumnInfo(name = "fallback_album") val fallbackAlbum: String? = null,
)

@Entity(tableName = "favorites")
data class FavoriteEntity(
  @PrimaryKey
  @ColumnInfo(name = "track_path")
  val trackPath: String,
  @ColumnInfo(name = "added_at") val addedAt: Long,
)

@Entity(
  tableName = "playback_history",
  indices = [Index(value = ["last_played_at"])],
)
data class PlaybackHistoryEntity(
  @PrimaryKey
  @ColumnInfo(name = "track_path")
  val trackPath: String,
  @ColumnInfo(name = "last_played_at") val lastPlayedAt: Long,
  @ColumnInfo(name = "play_count") val playCount: Long = 1,
)

@Entity(
  tableName = "remote_sources",
  indices = [Index(value = ["type", "name"])],
)
data class RemoteSourceEntity(
  @PrimaryKey(autoGenerate = true) val id: Long = 0,
  val type: String,
  val name: String,
  @ColumnInfo(name = "base_url") val baseUrl: String,
  val username: String,
  val enabled: Boolean = true,
  @ColumnInfo(name = "last_status") val lastStatus: String = "unknown",
  @ColumnInfo(name = "last_error") val lastError: String? = null,
  @ColumnInfo(name = "last_sync_at") val lastSyncAt: Long? = null,
  @ColumnInfo(name = "last_checked_at") val lastCheckedAt: Long? = null,
  @ColumnInfo(name = "created_at") val createdAt: Long,
  @ColumnInfo(name = "updated_at") val updatedAt: Long,
)

@Entity(tableName = "favorite_tombstones")
data class FavoriteTombstoneEntity(
  @PrimaryKey
  @ColumnInfo(name = "sync_key")
  val syncKey: String,
  @ColumnInfo(name = "deleted_at") val deletedAt: Long,
)

@Entity(tableName = "favorite_sync_pending")
data class PendingFavoriteEntity(
  @PrimaryKey
  @ColumnInfo(name = "sync_key")
  val syncKey: String,
  val title: String,
  val artist: String,
  val album: String,
  @ColumnInfo(name = "added_at") val addedAt: Long,
)

@Entity(tableName = "playlist_tombstones")
data class PlaylistTombstoneEntity(
  @PrimaryKey
  @ColumnInfo(name = "sync_uid")
  val syncUid: String,
  @ColumnInfo(name = "deleted_at") val deletedAt: Long,
)

@Entity(tableName = "playlist_sync_state")
data class PlaylistSyncStateEntity(
  @PrimaryKey
  @ColumnInfo(name = "sync_uid")
  val syncUid: String,
  @ColumnInfo(name = "local_updated_at") val localUpdatedAt: Long,
  @ColumnInfo(name = "remote_updated_at") val remoteUpdatedAt: Long,
)

/**
 * Compact, durable descriptor for a virtual playback context. Track rows remain
 * in the rebuildable catalog and are resolved lazily when a window is requested.
 */
@Entity(tableName = "playback_sessions")
data class PlaybackSessionEntity(
  @PrimaryKey val id: String,
  @ColumnInfo(name = "context_json") val contextJson: String,
  @ColumnInfo(name = "anchor_path") val anchorPath: String?,
  @ColumnInfo(name = "shuffle_seed") val shuffleSeed: Long?,
  @ColumnInfo(name = "active_position") val activePosition: Long,
  @ColumnInfo(name = "created_at") val createdAt: Long,
  @ColumnInfo(name = "updated_at") val updatedAt: Long,
)

@Entity(
  tableName = "playback_queue_entries",
  primaryKeys = ["session_id", "position"],
  foreignKeys = [
    ForeignKey(
      entity = PlaybackSessionEntity::class,
      parentColumns = ["id"],
      childColumns = ["session_id"],
      onDelete = ForeignKey.CASCADE,
    ),
  ],
  indices = [
    Index(value = ["session_id", "track_path"]),
  ],
)
data class PlaybackQueueEntryEntity(
  @ColumnInfo(name = "session_id") val sessionId: String,
  val position: Long,
  @ColumnInfo(name = "track_path") val trackPath: String,
)

@Entity(
  tableName = "playback_original_queue_entries",
  primaryKeys = ["session_id", "position"],
  foreignKeys = [
    ForeignKey(
      entity = PlaybackSessionEntity::class,
      parentColumns = ["id"],
      childColumns = ["session_id"],
      onDelete = ForeignKey.CASCADE,
    ),
  ],
  indices = [Index(value = ["session_id", "track_path"])],
)
data class PlaybackOriginalQueueEntryEntity(
  @ColumnInfo(name = "session_id") val sessionId: String,
  val position: Long,
  @ColumnInfo(name = "track_path") val trackPath: String,
)

@Entity(tableName = "snapshot_metadata")
data class SnapshotMetadataEntity(
  @PrimaryKey val id: Int = 1,
  @ColumnInfo(name = "last_snapshot_at") val lastSnapshotAt: Long,
)
