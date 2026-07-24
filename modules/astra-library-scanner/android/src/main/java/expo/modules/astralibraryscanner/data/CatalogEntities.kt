package expo.modules.astralibraryscanner.data

import androidx.room.ColumnInfo
import androidx.room.DatabaseView
import androidx.room.Entity
import androidx.room.Fts4
import androidx.room.FtsOptions
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "catalog_meta")
data class CatalogMetaEntity(
  @PrimaryKey val id: Int = 1,
  val revision: Long = 0,
  @ColumnInfo(name = "collation_version") val collationVersion: Int,
  @ColumnInfo(name = "updated_at") val updatedAt: Long,
)

@Entity(tableName = "catalog_sources")
data class CatalogSourceEntity(
  @PrimaryKey
  @ColumnInfo(name = "source_key")
  val sourceKey: String,
  @ColumnInfo(name = "source_type") val sourceType: String,
  @ColumnInfo(name = "source_id") val sourceId: Long,
  @ColumnInfo(name = "active_generation_id") val activeGenerationId: String? = null,
  @ColumnInfo(name = "updated_at") val updatedAt: Long,
)

@Entity(
  tableName = "scan_generations",
  indices = [Index(value = ["source_key", "state"])],
)
data class ScanGenerationEntity(
  @PrimaryKey val id: String,
  @ColumnInfo(name = "source_key") val sourceKey: String,
  val state: String,
  @ColumnInfo(name = "started_at") val startedAt: Long,
  @ColumnInfo(name = "finished_at") val finishedAt: Long? = null,
  @ColumnInfo(name = "error_message") val errorMessage: String? = null,
)

@Entity(
  tableName = "tracks",
  indices = [
    Index(value = ["generation_id", "path"], unique = true),
    Index(value = ["source_key", "generation_id"]),
    Index(value = ["album_identity_key"]),
    Index(value = ["artist_sort_key", "album_sort_key", "disc_sort", "track_sort", "title_sort_key", "path"]),
    Index(value = ["title_sort_key", "path"]),
    Index(value = ["added_at", "path"]),
    Index(value = ["duration", "path"]),
  ],
)
data class TrackEntity(
  @PrimaryKey(autoGenerate = true) val id: Long = 0,
  @ColumnInfo(name = "generation_id") val generationId: String,
  @ColumnInfo(name = "source_key") val sourceKey: String,
  val path: String,
  @ColumnInfo(name = "folder_id") val folderId: Long? = null,
  val title: String,
  val artist: String,
  val album: String,
  @ColumnInfo(name = "album_artist") val albumArtist: String? = null,
  @ColumnInfo(name = "album_identity_key") val albumIdentityKey: String,
  @ColumnInfo(name = "album_display_artist") val albumDisplayArtist: String? = null,
  val duration: Double = 0.0,
  @ColumnInfo(name = "track_number") val trackNumber: Int? = null,
  @ColumnInfo(name = "disc_number") val discNumber: Int? = null,
  val year: Int? = null,
  val genre: String? = null,
  @ColumnInfo(name = "artwork_hash") val artworkHash: String? = null,
  val format: String,
  @ColumnInfo(name = "sample_rate") val sampleRate: Int? = null,
  @ColumnInfo(name = "bit_depth") val bitDepth: Int? = null,
  val bitrate: Int? = null,
  val channels: Int? = null,
  val codec: String? = null,
  @ColumnInfo(name = "source_type") val sourceType: String = "local",
  @ColumnInfo(name = "source_id") val sourceId: Long? = null,
  @ColumnInfo(name = "source_track_id") val sourceTrackId: String? = null,
  @ColumnInfo(name = "source_path") val sourcePath: String? = null,
  @ColumnInfo(name = "artwork_source_id") val artworkSourceId: String? = null,
  @ColumnInfo(name = "file_name") val fileName: String,
  @ColumnInfo(name = "parent_uri") val parentUri: String? = null,
  val size: Long? = null,
  val mtime: Long = 0,
  @ColumnInfo(name = "added_at") val addedAt: Long,
  @ColumnInfo(name = "modified_at") val modifiedAt: Long,
  @ColumnInfo(name = "loudness_lufs") val loudnessLufs: Double? = null,
  @ColumnInfo(name = "sample_peak") val samplePeak: Double? = null,
  @ColumnInfo(name = "replay_gain_track_db") val replayGainTrackDb: Double? = null,
  @ColumnInfo(name = "replay_gain_album_db") val replayGainAlbumDb: Double? = null,
  @ColumnInfo(name = "replay_gain_track_peak") val replayGainTrackPeak: Double? = null,
  @ColumnInfo(name = "replay_gain_album_peak") val replayGainAlbumPeak: Double? = null,
  @ColumnInfo(name = "rg_scanned") val replayGainScanned: Boolean = false,
  val bpm: Double? = null,
  @ColumnInfo(name = "musical_key") val musicalKey: String? = null,
  @ColumnInfo(name = "title_sort_key") val titleSortKey: String,
  @ColumnInfo(name = "artist_sort_key") val artistSortKey: String,
  @ColumnInfo(name = "album_sort_key") val albumSortKey: String,
  @ColumnInfo(name = "file_name_sort_key") val fileNameSortKey: String,
  @ColumnInfo(name = "disc_sort") val discSort: Int,
  @ColumnInfo(name = "track_sort") val trackSort: Int,
  @ColumnInfo(name = "section_label") val sectionLabel: String,
)

@DatabaseView(
  viewName = "active_tracks",
  value = """
    SELECT t.*
    FROM tracks t
    INNER JOIN catalog_sources s
      ON s.source_key = t.source_key
     AND s.active_generation_id = t.generation_id
  """,
)
data class ActiveTrackView(
  val id: Long,
  @ColumnInfo(name = "generation_id") val generationId: String,
  @ColumnInfo(name = "source_key") val sourceKey: String,
  val path: String,
  @ColumnInfo(name = "folder_id") val folderId: Long?,
  val title: String,
  val artist: String,
  val album: String,
  @ColumnInfo(name = "album_artist") val albumArtist: String?,
  @ColumnInfo(name = "album_identity_key") val albumIdentityKey: String,
  @ColumnInfo(name = "album_display_artist") val albumDisplayArtist: String?,
  val duration: Double,
  @ColumnInfo(name = "track_number") val trackNumber: Int?,
  @ColumnInfo(name = "disc_number") val discNumber: Int?,
  val year: Int?,
  val genre: String?,
  @ColumnInfo(name = "artwork_hash") val artworkHash: String?,
  val format: String,
  @ColumnInfo(name = "sample_rate") val sampleRate: Int?,
  @ColumnInfo(name = "bit_depth") val bitDepth: Int?,
  val bitrate: Int?,
  val channels: Int?,
  val codec: String?,
  @ColumnInfo(name = "source_type") val sourceType: String,
  @ColumnInfo(name = "source_id") val sourceId: Long?,
  @ColumnInfo(name = "source_track_id") val sourceTrackId: String?,
  @ColumnInfo(name = "source_path") val sourcePath: String?,
  @ColumnInfo(name = "artwork_source_id") val artworkSourceId: String?,
  @ColumnInfo(name = "file_name") val fileName: String,
  @ColumnInfo(name = "parent_uri") val parentUri: String?,
  val size: Long?,
  val mtime: Long,
  @ColumnInfo(name = "added_at") val addedAt: Long,
  @ColumnInfo(name = "modified_at") val modifiedAt: Long,
  @ColumnInfo(name = "loudness_lufs") val loudnessLufs: Double?,
  @ColumnInfo(name = "sample_peak") val samplePeak: Double?,
  @ColumnInfo(name = "replay_gain_track_db") val replayGainTrackDb: Double?,
  @ColumnInfo(name = "replay_gain_album_db") val replayGainAlbumDb: Double?,
  @ColumnInfo(name = "replay_gain_track_peak") val replayGainTrackPeak: Double?,
  @ColumnInfo(name = "replay_gain_album_peak") val replayGainAlbumPeak: Double?,
  @ColumnInfo(name = "rg_scanned") val replayGainScanned: Boolean,
  val bpm: Double?,
  @ColumnInfo(name = "musical_key") val musicalKey: String?,
  @ColumnInfo(name = "title_sort_key") val titleSortKey: String,
  @ColumnInfo(name = "artist_sort_key") val artistSortKey: String,
  @ColumnInfo(name = "album_sort_key") val albumSortKey: String,
  @ColumnInfo(name = "file_name_sort_key") val fileNameSortKey: String,
  @ColumnInfo(name = "disc_sort") val discSort: Int,
  @ColumnInfo(name = "track_sort") val trackSort: Int,
  @ColumnInfo(name = "section_label") val sectionLabel: String,
)

@Entity(
  tableName = "album_summaries",
  primaryKeys = ["revision", "identity_key"],
  indices = [
    Index(value = ["revision", "name_sort_key", "identity_key"]),
    Index(value = ["revision", "artist_sort_key", "name_sort_key", "identity_key"]),
    Index(value = ["revision", "latest_added_at", "identity_key"]),
    Index(value = ["revision", "year", "name_sort_key", "identity_key"]),
  ],
)
data class AlbumSummaryEntity(
  val revision: Long,
  @ColumnInfo(name = "identity_key") val identityKey: String,
  val album: String,
  val artist: String,
  val year: Int? = null,
  @ColumnInfo(name = "artwork_hash") val artworkHash: String? = null,
  @ColumnInfo(name = "source_type") val sourceType: String? = null,
  @ColumnInfo(name = "source_id") val sourceId: Long? = null,
  @ColumnInfo(name = "artwork_source_id") val artworkSourceId: String? = null,
  @ColumnInfo(name = "track_count") val trackCount: Long,
  @ColumnInfo(name = "total_duration") val totalDuration: Double,
  @ColumnInfo(name = "latest_added_at") val latestAddedAt: Long,
  @ColumnInfo(name = "name_sort_key") val nameSortKey: String,
  @ColumnInfo(name = "artist_sort_key") val artistSortKey: String,
  @ColumnInfo(name = "section_label") val sectionLabel: String,
  @ColumnInfo(name = "is_single") val isSingle: Boolean,
)

@Entity(
  tableName = "artist_summaries",
  primaryKeys = ["revision", "artist_key", "grouping_mode"],
  indices = [
    Index(value = ["revision", "grouping_mode", "name_sort_key", "artist_key"]),
    Index(value = ["revision", "grouping_mode", "track_count", "name_sort_key", "artist_key"]),
  ],
)
data class ArtistSummaryEntity(
  val revision: Long,
  @ColumnInfo(name = "artist_key") val artistKey: String,
  val artist: String,
  @ColumnInfo(name = "grouping_mode") val groupingMode: String,
  @ColumnInfo(name = "track_count") val trackCount: Long,
  @ColumnInfo(name = "primary_track_count") val primaryTrackCount: Long,
  @ColumnInfo(name = "album_count") val albumCount: Long,
  @ColumnInfo(name = "artwork_hash") val artworkHash: String? = null,
  @ColumnInfo(name = "source_type") val sourceType: String? = null,
  @ColumnInfo(name = "source_id") val sourceId: Long? = null,
  @ColumnInfo(name = "artwork_source_id") val artworkSourceId: String? = null,
  @ColumnInfo(name = "name_sort_key") val nameSortKey: String,
  @ColumnInfo(name = "section_label") val sectionLabel: String,
  @ColumnInfo(name = "is_collaboration") val isCollaboration: Boolean,
  @ColumnInfo(name = "artwork_hashes_json") val artworkHashesJson: String,
)

@Entity(
  tableName = "artist_track_index",
  primaryKeys = ["revision", "grouping_mode", "artist_key", "track_id"],
  indices = [
    Index(value = ["revision", "grouping_mode", "artist_key", "relationship", "track_id"]),
    Index(value = ["track_id"]),
  ],
)
data class ArtistTrackIndexEntity(
  val revision: Long,
  @ColumnInfo(name = "grouping_mode") val groupingMode: String,
  @ColumnInfo(name = "artist_key") val artistKey: String,
  @ColumnInfo(name = "track_id") val trackId: Long,
  val relationship: String,
)

@Entity(
  tableName = "directory_summaries",
  primaryKeys = ["revision", "node_id"],
  indices = [Index(value = ["revision", "folder_id", "parent_node_id", "name_sort_key"])],
)
data class DirectorySummaryEntity(
  val revision: Long,
  @ColumnInfo(name = "node_id") val nodeId: String,
  @ColumnInfo(name = "folder_id") val folderId: Long,
  @ColumnInfo(name = "parent_node_id") val parentNodeId: String? = null,
  val name: String,
  val depth: Int,
  @ColumnInfo(name = "directory_path") val directoryPath: String,
  @ColumnInfo(name = "document_uri") val documentUri: String? = null,
  @ColumnInfo(name = "direct_track_count") val directTrackCount: Long,
  @ColumnInfo(name = "total_track_count") val totalTrackCount: Long,
  @ColumnInfo(name = "name_sort_key") val nameSortKey: String,
)

@Entity(tableName = "track_user_facts")
data class TrackUserFactEntity(
  @PrimaryKey val path: String,
  @ColumnInfo(name = "is_favorite") val isFavorite: Boolean = false,
  @ColumnInfo(name = "play_count") val playCount: Long = 0,
  @ColumnInfo(name = "last_played_at") val lastPlayedAt: Long? = null,
)

@Entity(tableName = "waveform_peaks")
data class WaveformPeaksEntity(
  @PrimaryKey
  @ColumnInfo(name = "track_path")
  val trackPath: String,
  val bins: Int,
  val peaks: ByteArray,
  @ColumnInfo(name = "created_at") val createdAt: Long,
)

@Entity(
  tableName = "lyrics_cache",
  indices = [Index(value = ["updated_at"])],
)
data class LyricsCacheEntity(
  @PrimaryKey
  @ColumnInfo(name = "track_path")
  val trackPath: String,
  @ColumnInfo(name = "metadata_signature") val metadataSignature: String? = null,
  val status: String,
  val source: String? = null,
  val provider: String? = null,
  val format: String? = null,
  @ColumnInfo(name = "plain_lyrics") val plainLyrics: String? = null,
  @ColumnInfo(name = "synced_lyrics") val syncedLyrics: String? = null,
  @ColumnInfo(name = "synced_lines_json") val syncedLinesJson: String,
  @ColumnInfo(name = "updated_at") val updatedAt: Long,
)

@Fts4(tokenizer = FtsOptions.TOKENIZER_UNICODE61)
@Entity(tableName = "track_fts")
data class TrackFtsEntity(
  @PrimaryKey
  @ColumnInfo(name = "rowid")
  val rowId: Long,
  val title: String,
  val artist: String,
  val album: String,
  @ColumnInfo(name = "file_name") val fileName: String,
)
