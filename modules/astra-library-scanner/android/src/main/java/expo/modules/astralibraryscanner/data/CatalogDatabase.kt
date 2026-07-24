package expo.modules.astralibraryscanner.data

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.RawQuery
import androidx.room.RoomDatabase
import androidx.room.Transaction
import androidx.room.Upsert
import androidx.sqlite.db.SupportSQLiteQuery

data class TrackSyncRow(
  val path: String,
  val size: Long?,
  val mtime: Long,
)

data class SectionAnchorRow(
  @androidx.room.ColumnInfo(name = "section_label") val sectionLabel: String,
  @androidx.room.ColumnInfo(name = "sort_key") val sortKey: String,
)

data class ArtistSectionAnchorCandidate(
  val artist: String,
  @androidx.room.ColumnInfo(name = "sort_key") val sortKey: String,
)

data class TrackSectionLabelCandidate(
  val id: Long,
  val title: String,
  @androidx.room.ColumnInfo(name = "section_label") val sectionLabel: String,
)

data class LibraryLoudnessStatsRow(
  val lufsCount: Long,
  val medianLufs: Double?,
  val rgCount: Long,
  val medianRgTrackDb: Double?,
)

@Dao
interface CatalogDao {
  @Query("SELECT * FROM catalog_meta WHERE id = 1")
  suspend fun getMeta(): CatalogMetaEntity?

  @Insert(onConflict = OnConflictStrategy.IGNORE)
  suspend fun insertMeta(meta: CatalogMetaEntity): Long

  @Query(
    """
      UPDATE catalog_meta
      SET revision = revision + 1,
          updated_at = :updatedAt
      WHERE id = 1
    """,
  )
  suspend fun incrementRevision(updatedAt: Long)

  @Query("SELECT revision FROM catalog_meta WHERE id = 1")
  suspend fun getRevision(): Long

  @Query(
    """
      UPDATE catalog_meta
      SET collation_version = :version,
          updated_at = :updatedAt
      WHERE id = 1
    """,
  )
  suspend fun setCollationVersion(version: Int, updatedAt: Long)

  @Query("SELECT * FROM catalog_sources WHERE source_key = :sourceKey")
  suspend fun getSource(sourceKey: String): CatalogSourceEntity?

  @Query("SELECT * FROM catalog_sources ORDER BY source_key")
  suspend fun getSources(): List<CatalogSourceEntity>

  @Query("DELETE FROM catalog_sources WHERE source_key = :sourceKey")
  suspend fun deleteSource(sourceKey: String)

  @Upsert
  suspend fun putSource(source: CatalogSourceEntity)

  @Query(
    """
      UPDATE catalog_sources
      SET active_generation_id = :generationId,
          updated_at = :updatedAt
      WHERE source_key = :sourceKey
    """,
  )
  suspend fun setActiveGeneration(
    sourceKey: String,
    generationId: String,
    updatedAt: Long,
  )

  @Insert(onConflict = OnConflictStrategy.ABORT)
  suspend fun insertGeneration(generation: ScanGenerationEntity)

  @Query("SELECT * FROM scan_generations WHERE id = :id")
  suspend fun getGeneration(id: String): ScanGenerationEntity?

  @Query(
    """
      UPDATE scan_generations
      SET state = :state,
          finished_at = :finishedAt,
          error_message = :errorMessage
      WHERE id = :id
    """,
  )
  suspend fun setGenerationState(
    id: String,
    state: String,
    finishedAt: Long?,
    errorMessage: String?,
  )

  @Query("DELETE FROM scan_generations WHERE state = 'staging'")
  suspend fun deleteAbandonedGenerationRecords()

  @Query(
    """
      DELETE FROM tracks
      WHERE generation_id IN (
        SELECT id FROM scan_generations WHERE state = 'staging'
      )
    """,
  )
  suspend fun deleteAbandonedGenerationTracks()

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun putTracks(tracks: List<TrackEntity>): List<Long>

  @Query(
    """
      SELECT t.*
      FROM tracks t
      INNER JOIN catalog_sources s ON s.source_key = t.source_key
      WHERE t.source_key = :sourceKey
        AND t.generation_id = s.active_generation_id
    """,
  )
  suspend fun getActiveTrackEntitiesForSource(sourceKey: String): List<TrackEntity>

  @Query(
    """
      SELECT t.*
      FROM tracks t
      INNER JOIN catalog_sources s ON s.source_key = t.source_key
      WHERE (t.source_key = :sourceKey AND t.generation_id = :pendingGenerationId)
         OR (t.source_key <> :sourceKey AND t.generation_id = s.active_generation_id)
    """,
  )
  suspend fun getProspectiveTracks(
    sourceKey: String,
    pendingGenerationId: String,
  ): List<TrackEntity>

  @Query(
    """
      SELECT t.*
      FROM tracks t
      INNER JOIN catalog_sources s ON s.source_key = t.source_key
      WHERE t.source_key <> :excludedSourceKey
        AND t.generation_id = s.active_generation_id
    """,
  )
  suspend fun getActiveTrackEntitiesExcludingSource(excludedSourceKey: String): List<TrackEntity>

  @Query(
    """
      UPDATE tracks
      SET album_identity_key = :identityKey,
          album_display_artist = :displayArtist
      WHERE id = :trackId
    """,
  )
  suspend fun updateAlbumIdentity(
    trackId: Long,
    identityKey: String,
    displayArtist: String,
  )

  @Query("DELETE FROM tracks WHERE generation_id = :generationId")
  suspend fun deleteGenerationTracks(generationId: String)

  @Query("DELETE FROM scan_generations WHERE id = :generationId")
  suspend fun deleteGeneration(generationId: String)

  @Query("SELECT COUNT(*) FROM active_tracks")
  suspend fun countActiveTracks(): Long

  @Query("SELECT COUNT(*) FROM active_tracks WHERE folder_id = :folderId")
  suspend fun countActiveTracksForFolder(folderId: Long): Long

  @Query("SELECT * FROM active_tracks WHERE path = :path LIMIT 1")
  suspend fun getActiveTrack(path: String): ActiveTrackView?

  @Query("SELECT * FROM active_tracks WHERE path IN (:paths)")
  suspend fun getActiveTracks(paths: List<String>): List<ActiveTrackView>

  @Query("SELECT * FROM active_tracks ORDER BY path")
  suspend fun getAllActiveTracksForNativeMatching(): List<ActiveTrackView>

  @Query("SELECT path FROM active_tracks ORDER BY title_sort_key, path")
  suspend fun getAllPathsByTitle(): List<String>

  @Query(
    """
      SELECT path FROM active_tracks
      ORDER BY artist_sort_key, album_sort_key, disc_sort, track_sort, title_sort_key, path
    """,
  )
  suspend fun getAllPathsByArtist(): List<String>

  @Query("SELECT path FROM active_tracks ORDER BY added_at DESC, path")
  suspend fun getAllPathsByRecentlyAdded(): List<String>

  @Query("SELECT path FROM active_tracks ORDER BY duration DESC, path")
  suspend fun getAllPathsByDuration(): List<String>

  @Query(
    """
      SELECT path FROM active_tracks
      WHERE album_identity_key = :albumKey
      ORDER BY disc_sort, track_sort, title_sort_key, path
    """,
  )
  suspend fun getAlbumPaths(albumKey: String): List<String>

  @Query(
    """
      SELECT t.path
      FROM active_tracks t
      INNER JOIN artist_track_index i ON i.track_id = t.id
      WHERE i.revision = :revision
        AND i.grouping_mode = :groupingMode
        AND i.artist_key = :artistKey
        AND (:section = 'all' OR i.relationship = :section)
      ORDER BY t.album_sort_key, t.disc_sort, t.track_sort, t.title_sort_key, t.path
    """,
  )
  suspend fun getArtistPaths(
    revision: Long,
    groupingMode: String,
    artistKey: String,
    section: String,
  ): List<String>

  @Query(
    """
      SELECT path FROM active_tracks
      WHERE folder_id = :folderId
      ORDER BY parent_uri, file_name_sort_key, path
    """,
  )
  suspend fun getFolderPaths(folderId: Long): List<String>

  @Query("SELECT * FROM active_tracks WHERE folder_id = :folderId")
  suspend fun getActiveTracksForFolder(folderId: Long): List<ActiveTrackView>

  @Query(
    """
      UPDATE tracks
      SET loudness_lufs = :lufs,
          sample_peak = :samplePeak
      WHERE path = :path
        AND generation_id = (
          SELECT active_generation_id
          FROM catalog_sources
          WHERE source_key = tracks.source_key
        )
    """,
  )
  suspend fun updateActiveTrackLoudness(
    path: String,
    lufs: Double?,
    samplePeak: Double?,
  )

  @Query(
    """
      UPDATE tracks
      SET replay_gain_track_db = :trackGainDb,
          replay_gain_album_db = :albumGainDb,
          replay_gain_track_peak = :trackPeak,
          replay_gain_album_peak = :albumPeak,
          rg_scanned = 1
      WHERE path = :path
        AND generation_id = (
          SELECT active_generation_id
          FROM catalog_sources
          WHERE source_key = tracks.source_key
        )
    """,
  )
  suspend fun updateActiveTrackReplayGain(
    path: String,
    trackGainDb: Double?,
    albumGainDb: Double?,
    trackPeak: Double?,
    albumPeak: Double?,
  )

  @Query(
    """
      SELECT
        (SELECT COUNT(*) FROM active_tracks WHERE loudness_lufs IS NOT NULL) AS lufsCount,
        (SELECT loudness_lufs
           FROM active_tracks
          WHERE loudness_lufs IS NOT NULL
          ORDER BY loudness_lufs
          LIMIT 1
          OFFSET (
            SELECT MAX((COUNT(*) - 1) / 2, 0)
            FROM active_tracks
            WHERE loudness_lufs IS NOT NULL
          )) AS medianLufs,
        (SELECT COUNT(*) FROM active_tracks WHERE replay_gain_track_db IS NOT NULL) AS rgCount,
        (SELECT replay_gain_track_db
           FROM active_tracks
          WHERE replay_gain_track_db IS NOT NULL
          ORDER BY replay_gain_track_db
          LIMIT 1
          OFFSET (
            SELECT MAX((COUNT(*) - 1) / 2, 0)
            FROM active_tracks
            WHERE replay_gain_track_db IS NOT NULL
          )) AS medianRgTrackDb
    """,
  )
  suspend fun getLibraryLoudnessStats(): LibraryLoudnessStatsRow

  @Query(
    """
      SELECT path, size, mtime
      FROM active_tracks
      WHERE folder_id = :folderId
    """,
  )
  suspend fun getFolderSyncRows(folderId: Long): List<TrackSyncRow>

  @Query(
    """
      SELECT * FROM active_tracks
      WHERE (:afterTitleKey IS NULL
        OR title_sort_key > :afterTitleKey
        OR (title_sort_key = :afterTitleKey AND path > :afterPath))
      ORDER BY title_sort_key, path
      LIMIT :limit
    """,
  )
  suspend fun getTitlePage(
    afterTitleKey: String?,
    afterPath: String,
    limit: Int,
  ): List<ActiveTrackView>

  @Query(
    """
      SELECT * FROM active_tracks
      WHERE (:afterArtistKey IS NULL
        OR artist_sort_key > :afterArtistKey
        OR (artist_sort_key = :afterArtistKey AND album_sort_key > :afterAlbumKey)
        OR (artist_sort_key = :afterArtistKey AND album_sort_key = :afterAlbumKey AND disc_sort > :afterDisc)
        OR (artist_sort_key = :afterArtistKey AND album_sort_key = :afterAlbumKey AND disc_sort = :afterDisc
            AND track_sort > :afterTrack)
        OR (artist_sort_key = :afterArtistKey AND album_sort_key = :afterAlbumKey AND disc_sort = :afterDisc
            AND track_sort = :afterTrack AND title_sort_key > :afterTitleKey)
        OR (artist_sort_key = :afterArtistKey AND album_sort_key = :afterAlbumKey AND disc_sort = :afterDisc
            AND track_sort = :afterTrack AND title_sort_key = :afterTitleKey AND path > :afterPath))
      ORDER BY artist_sort_key, album_sort_key, disc_sort, track_sort, title_sort_key, path
      LIMIT :limit
    """,
  )
  suspend fun getArtistOrderPage(
    afterArtistKey: String?,
    afterAlbumKey: String,
    afterDisc: Int,
    afterTrack: Int,
    afterTitleKey: String,
    afterPath: String,
    limit: Int,
  ): List<ActiveTrackView>

  @Query(
    """
      SELECT * FROM active_tracks
      WHERE (:afterAddedAt IS NULL
        OR added_at < :afterAddedAt
        OR (added_at = :afterAddedAt AND path > :afterPath))
      ORDER BY added_at DESC, path
      LIMIT :limit
    """,
  )
  suspend fun getRecentlyAddedPage(
    afterAddedAt: Long?,
    afterPath: String,
    limit: Int,
  ): List<ActiveTrackView>

  @Query(
    """
      SELECT * FROM active_tracks
      WHERE (:afterDuration IS NULL
        OR duration < :afterDuration
        OR (duration = :afterDuration AND path > :afterPath))
      ORDER BY duration DESC, path
      LIMIT :limit
    """,
  )
  suspend fun getDurationPage(
    afterDuration: Double?,
    afterPath: String,
    limit: Int,
  ): List<ActiveTrackView>

  @Query(
    """
      SELECT * FROM active_tracks
      WHERE album_identity_key = :albumKey
        AND (:afterDisc IS NULL
          OR disc_sort > :afterDisc
          OR (disc_sort = :afterDisc AND track_sort > :afterTrack)
          OR (disc_sort = :afterDisc AND track_sort = :afterTrack AND title_sort_key > :afterTitleKey)
          OR (disc_sort = :afterDisc AND track_sort = :afterTrack AND title_sort_key = :afterTitleKey
              AND path > :afterPath))
      ORDER BY disc_sort, track_sort, title_sort_key, path
      LIMIT :limit
    """,
  )
  suspend fun getAlbumTrackPage(
    albumKey: String,
    afterDisc: Int?,
    afterTrack: Int,
    afterTitleKey: String,
    afterPath: String,
    limit: Int,
  ): List<ActiveTrackView>

  @Query("SELECT COUNT(*) FROM active_tracks WHERE album_identity_key = :albumKey")
  suspend fun countAlbumTracks(albumKey: String): Long

  @Query(
    """
      SELECT * FROM active_tracks
      WHERE album_identity_key = :albumKey
      ORDER BY disc_sort, track_sort, title_sort_key, path
    """,
  )
  suspend fun getAlbumTracks(albumKey: String): List<ActiveTrackView>

  @Query(
    """
      SELECT * FROM active_tracks
      WHERE artist = :artist
        AND (:afterAlbumKey IS NULL
          OR album_sort_key > :afterAlbumKey
          OR (album_sort_key = :afterAlbumKey AND disc_sort > :afterDisc)
          OR (album_sort_key = :afterAlbumKey AND disc_sort = :afterDisc AND track_sort > :afterTrack)
          OR (album_sort_key = :afterAlbumKey AND disc_sort = :afterDisc AND track_sort = :afterTrack
              AND title_sort_key > :afterTitleKey)
          OR (album_sort_key = :afterAlbumKey AND disc_sort = :afterDisc AND track_sort = :afterTrack
              AND title_sort_key = :afterTitleKey AND path > :afterPath))
      ORDER BY album_sort_key, disc_sort, track_sort, title_sort_key, path
      LIMIT :limit
    """,
  )
  suspend fun getExactArtistTrackPage(
    artist: String,
    afterAlbumKey: String?,
    afterDisc: Int,
    afterTrack: Int,
    afterTitleKey: String,
    afterPath: String,
    limit: Int,
  ): List<ActiveTrackView>

  @Query(
    """
      SELECT section_label, MIN(title_sort_key) AS sort_key
      FROM active_tracks
      GROUP BY section_label
      ORDER BY sort_key
    """,
  )
  suspend fun getTitleSectionAnchors(): List<SectionAnchorRow>

  @Query(
    """
      SELECT artist, MIN(artist_sort_key) AS sort_key
      FROM active_tracks
      GROUP BY artist
      ORDER BY sort_key
    """,
  )
  suspend fun getArtistSectionAnchorCandidates(): List<ArtistSectionAnchorCandidate>

  @Query(
    """
      SELECT id, title, section_label
      FROM tracks
      WHERE id > :afterId
      ORDER BY id
      LIMIT :limit
    """,
  )
  suspend fun getTrackSectionLabelCandidates(
    afterId: Long,
    limit: Int,
  ): List<TrackSectionLabelCandidate>

  @Query("UPDATE tracks SET section_label = :sectionLabel WHERE id = :trackId")
  suspend fun updateTrackSectionLabel(trackId: Long, sectionLabel: String)

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun putAlbumSummaries(rows: List<AlbumSummaryEntity>)

  @Query("DELETE FROM album_summaries WHERE revision <> :revision")
  suspend fun deleteOldAlbumSummaries(revision: Long)

  @Query(
    """
      SELECT * FROM album_summaries
      WHERE revision = :revision
        AND (:includeSingles OR is_single = 0)
        AND (:afterKey IS NULL
          OR name_sort_key > :afterKey
          OR (name_sort_key = :afterKey AND identity_key > :afterId))
      ORDER BY name_sort_key, identity_key
      LIMIT :limit
    """,
  )
  suspend fun getAlbumNamePage(
    revision: Long,
    includeSingles: Boolean,
    afterKey: String?,
    afterId: String,
    limit: Int,
  ): List<AlbumSummaryEntity>

  @Query(
    """
      SELECT * FROM album_summaries
      WHERE revision = :revision
        AND (:includeSingles OR is_single = 0)
        AND (:afterArtistKey IS NULL
          OR artist_sort_key > :afterArtistKey
          OR (artist_sort_key = :afterArtistKey AND name_sort_key > :afterNameKey)
          OR (artist_sort_key = :afterArtistKey AND name_sort_key = :afterNameKey
              AND identity_key > :afterId))
      ORDER BY artist_sort_key, name_sort_key, identity_key
      LIMIT :limit
    """,
  )
  suspend fun getAlbumArtistPage(
    revision: Long,
    includeSingles: Boolean,
    afterArtistKey: String?,
    afterNameKey: String,
    afterId: String,
    limit: Int,
  ): List<AlbumSummaryEntity>

  @Query(
    """
      SELECT * FROM album_summaries
      WHERE revision = :revision
        AND (:includeSingles OR is_single = 0)
        AND (:afterAddedAt IS NULL
          OR latest_added_at < :afterAddedAt
          OR (latest_added_at = :afterAddedAt AND identity_key > :afterId))
      ORDER BY latest_added_at DESC, identity_key
      LIMIT :limit
    """,
  )
  suspend fun getAlbumRecentPage(
    revision: Long,
    includeSingles: Boolean,
    afterAddedAt: Long?,
    afterId: String,
    limit: Int,
  ): List<AlbumSummaryEntity>

  @Query(
    """
      SELECT * FROM album_summaries
      WHERE revision = :revision
        AND (:includeSingles OR is_single = 0)
        AND (:afterYear IS NULL
          OR COALESCE(year, 0) < :afterYear
          OR (COALESCE(year, 0) = :afterYear AND name_sort_key > :afterNameKey)
          OR (COALESCE(year, 0) = :afterYear AND name_sort_key = :afterNameKey
              AND identity_key > :afterId))
      ORDER BY COALESCE(year, 0) DESC, name_sort_key, identity_key
      LIMIT :limit
    """,
  )
  suspend fun getAlbumYearPage(
    revision: Long,
    includeSingles: Boolean,
    afterYear: Int?,
    afterNameKey: String,
    afterId: String,
    limit: Int,
  ): List<AlbumSummaryEntity>

  @Query("SELECT * FROM album_summaries WHERE revision = :revision AND identity_key = :identityKey")
  suspend fun getAlbumSummary(revision: Long, identityKey: String): AlbumSummaryEntity?

  @Query("SELECT COUNT(*) FROM album_summaries WHERE revision = :revision AND (:includeSingles OR is_single = 0)")
  suspend fun countAlbums(revision: Long, includeSingles: Boolean): Long

  @Query(
    """
      SELECT * FROM album_summaries
      WHERE revision = :revision
      ORDER BY artist_sort_key, name_sort_key, identity_key
    """,
  )
  suspend fun getAllAlbumSummaries(revision: Long): List<AlbumSummaryEntity>

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun putArtistSummaries(rows: List<ArtistSummaryEntity>)

  @Query("DELETE FROM artist_summaries WHERE revision <> :revision")
  suspend fun deleteOldArtistSummaries(revision: Long)

  @Query(
    """
      SELECT * FROM artist_summaries
      WHERE revision = :revision
        AND grouping_mode = :groupingMode
        AND (:includeCollaborations OR is_collaboration = 0)
        AND (:afterKey IS NULL
          OR name_sort_key > :afterKey
          OR (name_sort_key = :afterKey AND artist_key > :afterId))
      ORDER BY name_sort_key, artist_key
      LIMIT :limit
    """,
  )
  suspend fun getArtistNamePage(
    revision: Long,
    groupingMode: String,
    includeCollaborations: Boolean,
    afterKey: String?,
    afterId: String,
    limit: Int,
  ): List<ArtistSummaryEntity>

  @Query(
    """
      SELECT * FROM artist_summaries
      WHERE revision = :revision
        AND grouping_mode = :groupingMode
        AND (:includeCollaborations OR is_collaboration = 0)
        AND (:afterCount IS NULL
          OR track_count < :afterCount
          OR (track_count = :afterCount AND name_sort_key > :afterNameKey)
          OR (track_count = :afterCount AND name_sort_key = :afterNameKey AND artist_key > :afterId))
      ORDER BY track_count DESC, name_sort_key, artist_key
      LIMIT :limit
    """,
  )
  suspend fun getArtistCountPage(
    revision: Long,
    groupingMode: String,
    includeCollaborations: Boolean,
    afterCount: Long?,
    afterNameKey: String,
    afterId: String,
    limit: Int,
  ): List<ArtistSummaryEntity>

  @Query(
    """
      SELECT * FROM artist_summaries
      WHERE revision = :revision
        AND grouping_mode = :groupingMode
        AND artist_key = :artistKey
    """,
  )
  suspend fun getArtistSummary(
    revision: Long,
    groupingMode: String,
    artistKey: String,
  ): ArtistSummaryEntity?

  @Query(
    """
      SELECT COUNT(*) FROM artist_summaries
      WHERE revision = :revision
        AND grouping_mode = :groupingMode
        AND (:includeCollaborations OR is_collaboration = 0)
    """,
  )
  suspend fun countArtists(
    revision: Long,
    groupingMode: String,
    includeCollaborations: Boolean,
  ): Long

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun putArtistTrackIndex(rows: List<ArtistTrackIndexEntity>)

  @Query("DELETE FROM artist_track_index WHERE revision <> :revision")
  suspend fun deleteOldArtistTrackIndex(revision: Long)

  @Query(
    """
      SELECT t.* FROM active_tracks t
      INNER JOIN artist_track_index i ON i.track_id = t.id
      WHERE i.revision = :revision
        AND i.grouping_mode = :groupingMode
        AND i.artist_key = :artistKey
        AND (:section = 'all' OR i.relationship = :section)
        AND (:afterAlbumKey IS NULL
          OR t.album_sort_key > :afterAlbumKey
          OR (t.album_sort_key = :afterAlbumKey AND t.disc_sort > :afterDisc)
          OR (t.album_sort_key = :afterAlbumKey AND t.disc_sort = :afterDisc AND t.track_sort > :afterTrack)
          OR (t.album_sort_key = :afterAlbumKey AND t.disc_sort = :afterDisc AND t.track_sort = :afterTrack
              AND t.title_sort_key > :afterTitleKey)
          OR (t.album_sort_key = :afterAlbumKey AND t.disc_sort = :afterDisc AND t.track_sort = :afterTrack
              AND t.title_sort_key = :afterTitleKey AND t.path > :afterPath))
      ORDER BY t.album_sort_key, t.disc_sort, t.track_sort, t.title_sort_key, t.path
      LIMIT :limit
    """,
  )
  suspend fun getArtistTrackPage(
    revision: Long,
    groupingMode: String,
    artistKey: String,
    section: String,
    afterAlbumKey: String?,
    afterDisc: Int,
    afterTrack: Int,
    afterTitleKey: String,
    afterPath: String,
    limit: Int,
  ): List<ActiveTrackView>

  @Query(
    """
      SELECT COUNT(*) FROM artist_track_index
      WHERE revision = :revision
        AND grouping_mode = :groupingMode
        AND artist_key = :artistKey
        AND (:section = 'all' OR relationship = :section)
    """,
  )
  suspend fun countArtistTracks(
    revision: Long,
    groupingMode: String,
    artistKey: String,
    section: String,
  ): Long

  @Query(
    """
      SELECT t.*
      FROM active_tracks t
      INNER JOIN artist_track_index i ON i.track_id = t.id
      WHERE i.revision = :revision
        AND i.grouping_mode = :groupingMode
        AND i.artist_key = :artistKey
      ORDER BY t.album_sort_key, t.disc_sort, t.track_sort, t.title_sort_key, t.path
    """,
  )
  suspend fun getAllArtistTracks(
    revision: Long,
    groupingMode: String,
    artistKey: String,
  ): List<ActiveTrackView>

  @Query(
    """
      SELECT * FROM artist_summaries
      WHERE revision = :revision
        AND grouping_mode = :groupingMode
      ORDER BY name_sort_key, artist_key
    """,
  )
  suspend fun getAllArtistSummaries(
    revision: Long,
    groupingMode: String,
  ): List<ArtistSummaryEntity>

  @Query(
    """
      SELECT DISTINCT a.*
      FROM album_summaries a
      INNER JOIN active_tracks t ON t.album_identity_key = a.identity_key
      INNER JOIN artist_track_index i ON i.track_id = t.id
      WHERE a.revision = :revision
        AND i.revision = :revision
        AND i.grouping_mode = :groupingMode
        AND i.artist_key = :artistKey
      ORDER BY a.latest_added_at DESC, a.name_sort_key, a.identity_key
      LIMIT :limit OFFSET :offset
    """,
  )
  suspend fun getArtistAlbumPage(
    revision: Long,
    groupingMode: String,
    artistKey: String,
    offset: Int,
    limit: Int,
  ): List<AlbumSummaryEntity>

  @Query(
    """
      SELECT COUNT(DISTINCT t.album_identity_key)
      FROM active_tracks t
      INNER JOIN artist_track_index i ON i.track_id = t.id
      WHERE i.revision = :revision
        AND i.grouping_mode = :groupingMode
        AND i.artist_key = :artistKey
    """,
  )
  suspend fun countArtistAlbums(
    revision: Long,
    groupingMode: String,
    artistKey: String,
  ): Long

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun putDirectorySummaries(rows: List<DirectorySummaryEntity>)

  @Query("DELETE FROM directory_summaries WHERE revision <> :revision")
  suspend fun deleteOldDirectorySummaries(revision: Long)

  @Query(
    """
      SELECT * FROM directory_summaries
      WHERE revision = :revision
        AND ((:parentNodeId IS NULL AND parent_node_id IS NULL) OR parent_node_id = :parentNodeId)
      ORDER BY name_sort_key, node_id
    """,
  )
  suspend fun getDirectoryChildren(
    revision: Long,
    parentNodeId: String?,
  ): List<DirectorySummaryEntity>

  @Query(
    """
      SELECT * FROM directory_summaries
      WHERE revision = :revision AND node_id = :nodeId
      LIMIT 1
    """,
  )
  suspend fun getDirectoryNode(revision: Long, nodeId: String): DirectorySummaryEntity?

  @Query(
    """
      SELECT * FROM active_tracks
      WHERE parent_uri = :documentUri
      ORDER BY file_name_sort_key, path
      LIMIT :limit OFFSET :offset
    """,
  )
  suspend fun getDirectoryTrackPage(
    documentUri: String,
    offset: Int,
    limit: Int,
  ): List<ActiveTrackView>

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun putFtsRows(rows: List<TrackFtsEntity>)

  @Query("DELETE FROM track_fts")
  suspend fun clearFts()

  @Query(
    """
      SELECT t.* FROM active_tracks t
      INNER JOIN track_fts f ON f.rowid = t.id
      WHERE track_fts MATCH :query
      ORDER BY t.title_sort_key, t.path
      LIMIT :limit
    """,
  )
  suspend fun searchTracks(query: String, limit: Int): List<ActiveTrackView>

  @Query(
    """
      SELECT * FROM active_tracks
      WHERE title LIKE :pattern ESCAPE '\'
         OR artist LIKE :pattern ESCAPE '\'
         OR album LIKE :pattern ESCAPE '\'
         OR file_name LIKE :pattern ESCAPE '\'
      ORDER BY title_sort_key, path
      LIMIT :limit
    """,
  )
  suspend fun searchTracksLiteral(pattern: String, limit: Int): List<ActiveTrackView>

  @Query(
    """
      SELECT DISTINCT a.*
      FROM album_summaries a
      INNER JOIN active_tracks t ON t.album_identity_key = a.identity_key
      INNER JOIN track_fts f ON f.rowid = t.id
      WHERE a.revision = :revision
        AND (:includeSingles OR a.is_single = 0)
        AND track_fts MATCH :query
      ORDER BY a.name_sort_key, a.identity_key
      LIMIT :limit
    """,
  )
  suspend fun searchAlbums(
    revision: Long,
    includeSingles: Boolean,
    query: String,
    limit: Int,
  ): List<AlbumSummaryEntity>

  @Query(
    """
      SELECT DISTINCT a.*
      FROM album_summaries a
      INNER JOIN active_tracks t ON t.album_identity_key = a.identity_key
      WHERE a.revision = :revision
        AND (:includeSingles OR a.is_single = 0)
        AND (
          a.album LIKE :pattern ESCAPE '\'
          OR a.artist LIKE :pattern ESCAPE '\'
          OR t.title LIKE :pattern ESCAPE '\'
          OR t.file_name LIKE :pattern ESCAPE '\'
        )
      ORDER BY a.name_sort_key, a.identity_key
      LIMIT :limit
    """,
  )
  suspend fun searchAlbumsLiteral(
    revision: Long,
    includeSingles: Boolean,
    pattern: String,
    limit: Int,
  ): List<AlbumSummaryEntity>

  @Query(
    """
      SELECT DISTINCT a.*
      FROM artist_summaries a
      INNER JOIN artist_track_index i
        ON i.revision = a.revision
       AND i.grouping_mode = a.grouping_mode
       AND i.artist_key = a.artist_key
      INNER JOIN track_fts f ON f.rowid = i.track_id
      WHERE a.revision = :revision
        AND a.grouping_mode = :groupingMode
        AND (:includeCollaborations OR a.is_collaboration = 0)
        AND track_fts MATCH :query
      ORDER BY a.name_sort_key, a.artist_key
      LIMIT :limit
    """,
  )
  suspend fun searchArtists(
    revision: Long,
    groupingMode: String,
    includeCollaborations: Boolean,
    query: String,
    limit: Int,
  ): List<ArtistSummaryEntity>

  @Query(
    """
      SELECT DISTINCT a.*
      FROM artist_summaries a
      INNER JOIN artist_track_index i
        ON i.revision = a.revision
       AND i.grouping_mode = a.grouping_mode
       AND i.artist_key = a.artist_key
      INNER JOIN active_tracks t ON t.id = i.track_id
      WHERE a.revision = :revision
        AND a.grouping_mode = :groupingMode
        AND (:includeCollaborations OR a.is_collaboration = 0)
        AND (
          a.artist LIKE :pattern ESCAPE '\'
          OR t.title LIKE :pattern ESCAPE '\'
          OR t.album LIKE :pattern ESCAPE '\'
          OR t.file_name LIKE :pattern ESCAPE '\'
        )
      ORDER BY a.name_sort_key, a.artist_key
      LIMIT :limit
    """,
  )
  suspend fun searchArtistsLiteral(
    revision: Long,
    groupingMode: String,
    includeCollaborations: Boolean,
    pattern: String,
    limit: Int,
  ): List<ArtistSummaryEntity>

  @Query(
    """
      SELECT t.path FROM active_tracks t
      INNER JOIN track_fts f ON f.rowid = t.id
      WHERE track_fts MATCH :query
      ORDER BY t.title_sort_key, t.path
    """,
  )
  suspend fun searchTrackPaths(query: String): List<String>

  @Query(
    """
      SELECT path FROM active_tracks
      WHERE title LIKE :pattern ESCAPE '\'
         OR artist LIKE :pattern ESCAPE '\'
         OR album LIKE :pattern ESCAPE '\'
         OR file_name LIKE :pattern ESCAPE '\'
      ORDER BY title_sort_key, path
    """,
  )
  suspend fun searchTrackPathsLiteral(pattern: String): List<String>

  @RawQuery
  suspend fun runDynamicTrackQuery(query: SupportSQLiteQuery): List<ActiveTrackView>

  @RawQuery
  suspend fun runDynamicCountQuery(query: SupportSQLiteQuery): Long

  @Upsert
  suspend fun putTrackUserFacts(rows: List<TrackUserFactEntity>)

  @Query("DELETE FROM track_user_facts")
  suspend fun clearTrackUserFacts()

  @Query("SELECT * FROM waveform_peaks WHERE track_path = :path")
  suspend fun getWaveform(path: String): WaveformPeaksEntity?

  @Upsert
  suspend fun putWaveform(row: WaveformPeaksEntity)

  @Query("SELECT COUNT(*) FROM waveform_peaks")
  suspend fun countWaveforms(): Long

  @Query("DELETE FROM waveform_peaks")
  suspend fun clearWaveforms()

  @Query("SELECT * FROM lyrics_cache WHERE track_path = :path")
  suspend fun getLyrics(path: String): LyricsCacheEntity?

  @Upsert
  suspend fun putLyrics(row: LyricsCacheEntity)

  @Query("DELETE FROM lyrics_cache WHERE track_path = :path")
  suspend fun deleteLyrics(path: String)

  @Query("SELECT COUNT(*) FROM lyrics_cache")
  suspend fun countLyrics(): Long

  @Query("DELETE FROM lyrics_cache")
  suspend fun clearLyrics()

  @Transaction
  suspend fun discardAbandonedGenerations() {
    deleteAbandonedGenerationTracks()
    deleteAbandonedGenerationRecords()
  }

  @Transaction
  suspend fun migrateSectionLabels(version: Int, updatedAt: Long) {
    var afterId = 0L
    do {
      val rows = getTrackSectionLabelCandidates(afterId, 1_000)
      for (row in rows) {
        val corrected = SortKeys.sectionLabel(row.title)
        if (corrected != row.sectionLabel) {
          updateTrackSectionLabel(row.id, corrected)
        }
      }
      afterId = rows.lastOrNull()?.id ?: afterId
    } while (rows.size == 1_000)
    setCollationVersion(version, updatedAt)
  }

  @Transaction
  suspend fun publishGeneration(
    sourceKey: String,
    generationId: String,
    previousGenerationId: String?,
    now: Long,
    albumIdentityUpdates: List<AlbumIdentityUpdate>,
    albums: List<AlbumSummaryEntity>,
    artists: List<ArtistSummaryEntity>,
    artistTrackIndex: List<ArtistTrackIndexEntity>,
    directories: List<DirectorySummaryEntity>,
    ftsRows: List<TrackFtsEntity>,
  ): Long {
    for (update in albumIdentityUpdates) {
      updateAlbumIdentity(update.trackId, update.identityKey, update.displayArtist)
    }
    setActiveGeneration(sourceKey, generationId, now)
    setGenerationState(generationId, "active", now, null)
    incrementRevision(now)
    val revision = getRevision()
    if (albums.isNotEmpty()) putAlbumSummaries(albums)
    if (artists.isNotEmpty()) putArtistSummaries(artists)
    if (artistTrackIndex.isNotEmpty()) putArtistTrackIndex(artistTrackIndex)
    if (directories.isNotEmpty()) putDirectorySummaries(directories)
    clearFts()
    if (ftsRows.isNotEmpty()) putFtsRows(ftsRows)
    deleteOldAlbumSummaries(revision)
    deleteOldArtistSummaries(revision)
    deleteOldArtistTrackIndex(revision)
    deleteOldDirectorySummaries(revision)
    if (previousGenerationId != null && previousGenerationId != generationId) {
      deleteGenerationTracks(previousGenerationId)
      deleteGeneration(previousGenerationId)
    }
    return revision
  }

  @Transaction
  suspend fun removeSourceAndPublish(
    sourceKey: String,
    generationId: String?,
    now: Long,
    albumIdentityUpdates: List<AlbumIdentityUpdate>,
    albums: List<AlbumSummaryEntity>,
    artists: List<ArtistSummaryEntity>,
    artistTrackIndex: List<ArtistTrackIndexEntity>,
    directories: List<DirectorySummaryEntity>,
    ftsRows: List<TrackFtsEntity>,
  ): Long {
    for (update in albumIdentityUpdates) {
      updateAlbumIdentity(update.trackId, update.identityKey, update.displayArtist)
    }
    deleteSource(sourceKey)
    if (generationId != null) {
      deleteGenerationTracks(generationId)
      deleteGeneration(generationId)
    }
    incrementRevision(now)
    val revision = getRevision()
    if (albums.isNotEmpty()) putAlbumSummaries(albums)
    if (artists.isNotEmpty()) putArtistSummaries(artists)
    if (artistTrackIndex.isNotEmpty()) putArtistTrackIndex(artistTrackIndex)
    if (directories.isNotEmpty()) putDirectorySummaries(directories)
    clearFts()
    if (ftsRows.isNotEmpty()) putFtsRows(ftsRows)
    deleteOldAlbumSummaries(revision)
    deleteOldArtistSummaries(revision)
    deleteOldArtistTrackIndex(revision)
    deleteOldDirectorySummaries(revision)
    return revision
  }
}

@Database(
  entities = [
    CatalogMetaEntity::class,
    CatalogSourceEntity::class,
    ScanGenerationEntity::class,
    TrackEntity::class,
    AlbumSummaryEntity::class,
    ArtistSummaryEntity::class,
    ArtistTrackIndexEntity::class,
    DirectorySummaryEntity::class,
    TrackUserFactEntity::class,
    WaveformPeaksEntity::class,
    LyricsCacheEntity::class,
    TrackFtsEntity::class,
  ],
  views = [ActiveTrackView::class],
  version = 1,
  exportSchema = true,
)
abstract class AstraCatalogDatabase : RoomDatabase() {
  abstract fun catalogDao(): CatalogDao
}
