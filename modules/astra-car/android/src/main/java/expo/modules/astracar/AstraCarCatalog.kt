package expo.modules.astracar

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.net.Uri
import android.os.Bundle
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaBrowserCompat.MediaItem
import android.support.v4.media.MediaDescriptionCompat
import android.support.v4.media.MediaMetadataCompat
import android.util.Log
import java.io.File
import java.util.Locale

private const val TAG = "AstraCarCatalog"

// Cap a node's children when the client doesn't paginate, so a large list (e.g. all albums)
// can't exceed the ~1MB Binder transaction limit — which silently drops the result and hangs
// the browser on a spinner. Auto pages large lists itself; this only guards the unpaged path.
private const val MAX_UNPAGED_CHILDREN = 500

private const val TRACK_ORDER =
  "COALESCE(disc_number, 9999), COALESCE(track_number, 9999), title COLLATE NOCASE"

// Fully alias-qualified (every column `t.`): these columns are SELECTed from joins where
// the other table (favorites / playlist_tracks) also has an `added_at`, so an unqualified
// `added_at` is ambiguous and SQLite throws. Single-table queries alias `tracks t` too.
private const val TRACK_COLUMNS =
  "t.id, t.path, t.title, t.artist, t.album, t.album_artist, t.album_identity_key, t.duration, " +
    "t.track_number, t.disc_number, t.year, t.artwork_hash, t.source_type, t.source_id, " +
    "t.source_track_id, t.artwork_source_id, t.added_at, t.modified_at"

class AstraCarCatalog(private val context: Context) {
  fun loadChildren(parentId: String, options: Bundle? = null): List<MediaItem> {
    val media = AstraCarMediaIds.decode(parentId) ?: AstraCarMediaId(kind = "root")
    val items = openReadableDb()?.use { db -> childrenFor(db, media) }
      ?: if (media.kind == "root") rootItems() else emptyList()
    return paginate(items, options)
  }

  fun loadItem(mediaId: String): MediaItem? {
    val media = AstraCarMediaIds.decode(mediaId) ?: return null
    return openReadableDb()?.use { db ->
      when (media.kind) {
        "section" -> sectionItem(media.section ?: return@use null)
        "album" -> getAlbums(db).firstOrNull { it.identityKey == media.key }?.let(::albumItem)
        "artist" -> getArtists(db).firstOrNull { it.artist == media.key }?.let(::artistItem)
        "playlist" -> media.id?.let { id -> getPlaylists(db).firstOrNull { it.id == id } }?.let(::playlistItem)
        "track" -> media.path?.let { path -> getTrackByPath(db, path) }?.let {
          trackItem(it, contextFromTrackMedia(media))
        }
        "root" -> rootItem()
        else -> null
      }
    }
  }

  private fun openReadableDb(): SQLiteDatabase? = AstraCarDb.openReadable(context)

  private fun childrenFor(db: SQLiteDatabase, media: AstraCarMediaId): List<MediaItem> =
    when (media.kind) {
      "root" -> rootItems()
      "section" -> when (media.section) {
        "recent" -> getRecentlyPlayed(db).map { trackItem(it, AstraCarMediaId(kind = "section", section = "recent")) }
        "favorites" -> getFavorites(db).map { trackItem(it, AstraCarMediaId(kind = "section", section = "favorites")) }
        "playlists" -> getPlaylists(db).map(::playlistItem)
        "albums" -> getAlbums(db).map(::albumItem)
        "artists" -> getArtists(db).map(::artistItem)
        else -> emptyList()
      }
      "playlist" -> media.id?.let { id ->
        getPlaylistTracks(db, id).map { trackItem(it, AstraCarMediaId(kind = "playlist", id = id)) }
      } ?: emptyList()
      "album" -> media.key?.let { key ->
        getAlbumTracks(db, key).map { trackItem(it, AstraCarMediaId(kind = "album", key = key)) }
      } ?: emptyList()
      "artist" -> media.key?.let { name ->
        getArtistTracks(db, name).map { trackItem(it, AstraCarMediaId(kind = "artist", key = name)) }
      } ?: emptyList()
      else -> emptyList()
    }

  private fun rootItem(): MediaItem =
    MediaItem(
      MediaDescriptionCompat.Builder()
        .setMediaId(AstraCarMediaIds.root)
        .setTitle("Astra")
        .build(),
      MediaItem.FLAG_BROWSABLE,
    )

  private fun rootItems(): List<MediaItem> =
    listOf(
      sectionItem("recent"),
      sectionItem("favorites"),
      sectionItem("playlists"),
      sectionItem("albums"),
      sectionItem("artists"),
    )

  private fun sectionItem(section: String): MediaItem {
    val title = when (section) {
      "recent" -> "Recently Played"
      "favorites" -> "Favorites"
      "playlists" -> "Playlists"
      "albums" -> "Albums"
      "artists" -> "Artists"
      else -> section.replaceFirstChar { it.titlecase(Locale.ROOT) }
    }
    return browsable(AstraCarMediaIds.section(section), title, null)
  }

  private fun albumItem(album: AlbumRow): MediaItem =
    browsable(
      AstraCarMediaIds.album(album.identityKey),
      album.album,
      album.artist,
      artworkIconUri(album.artworkHash, album.sourceId, album.artworkSourceId),
      "${album.trackCount} ${if (album.trackCount == 1L) "track" else "tracks"}",
    )

  private fun artistItem(artist: ArtistRow): MediaItem =
    browsable(
      AstraCarMediaIds.artist(artist.artist),
      artist.artist,
      "${artist.trackCount} ${if (artist.trackCount == 1L) "track" else "tracks"}",
      artworkIconUri(artist.artworkHash, artist.sourceId, artist.artworkSourceId),
    )

  private fun playlistItem(playlist: PlaylistRow): MediaItem =
    browsable(
      AstraCarMediaIds.playlist(playlist.id),
      playlist.name,
      "${playlist.trackCount} ${if (playlist.trackCount == 1L) "track" else "tracks"}",
      artworkIconUri(playlist.artworkHash, playlist.sourceId, playlist.artworkSourceId),
    )

  private fun trackItem(track: TrackRow, contextMedia: AstraCarMediaId): MediaItem {
    val extras = Bundle().apply {
      putLong(MediaMetadataCompat.METADATA_KEY_DURATION, (track.duration * 1000).toLong())
    }
    val description = MediaDescriptionCompat.Builder()
      .setMediaId(AstraCarMediaIds.track(track.path, contextMedia))
      .setTitle(track.title)
      .setSubtitle(track.artist)
      .setDescription(track.album)
      .setIconUri(artworkIconUri(track.artworkHash, track.sourceId, track.artworkSourceId))
      .setExtras(extras)
      .build()
    return MediaItem(description, MediaItem.FLAG_PLAYABLE)
  }

  private fun browsable(
    mediaId: String,
    title: String,
    subtitle: String?,
    iconUri: Uri? = null,
    description: String? = null,
  ): MediaItem {
    val mediaDescription = MediaDescriptionCompat.Builder()
      .setMediaId(mediaId)
      .setTitle(title)
      .setSubtitle(subtitle)
      .setDescription(description)
      .setIconUri(iconUri)
      .build()
    return MediaItem(mediaDescription, MediaItem.FLAG_BROWSABLE)
  }

  /**
   * Browse-list icon URI: a local content:// URI when the scanner has cached art for
   * `hash`, else a remote content:// URI for a remote track with server art, else null.
   * Android Auto loads art only from content:// (never file:// / http), so everything
   * routes through [AstraCarArtworkProvider].
   */
  private fun artworkIconUri(hash: String?, sourceId: Long?, artworkSourceId: String?): Uri? {
    localArtworkUri(hash)?.let { return it }
    if (sourceId != null && !artworkSourceId.isNullOrBlank()) {
      return AstraCarArtwork.remoteUri(context, sourceId, artworkSourceId)
    }
    return null
  }

  private fun localArtworkUri(hash: String?): Uri? {
    val clean = hash?.trim().orEmpty()
    if (clean.isEmpty()) return null
    val dot = clean.lastIndexOf('.')
    val stem = if (dot > 0) clean.substring(0, dot) else clean
    val thumb = File(File(context.filesDir, "artwork-thumbs"), "$stem.jpg")
    val full = File(File(context.filesDir, "artwork"), clean)
    return if (thumb.exists() || full.exists()) AstraCarArtwork.localUri(context, clean) else null
  }

  private fun paginate(items: List<MediaItem>, options: Bundle?): List<MediaItem> {
    val page = options?.getInt(MediaBrowserCompat.EXTRA_PAGE, -1) ?: -1
    val pageSize = options?.getInt(MediaBrowserCompat.EXTRA_PAGE_SIZE, -1) ?: -1
    if (page < 0 || pageSize <= 0) {
      if (items.size > MAX_UNPAGED_CHILDREN) {
        Log.w(TAG, "capping ${items.size} children to $MAX_UNPAGED_CHILDREN (client did not paginate)")
        return items.take(MAX_UNPAGED_CHILDREN)
      }
      return items
    }
    val from = page * pageSize
    if (from >= items.size) return emptyList()
    val to = minOf(from + pageSize, items.size)
    return items.subList(from, to)
  }

  private fun contextFromTrackMedia(media: AstraCarMediaId): AstraCarMediaId =
    AstraCarMediaId(
      kind = media.contextKind ?: "track",
      section = media.contextSection,
      key = media.contextKey,
      id = media.contextId,
    )

  private fun queryTracks(
    db: SQLiteDatabase,
    sql: String,
    args: Array<String> = emptyArray(),
  ): List<TrackRow> =
    db.rawQuery(sql, args).use { cursor ->
      buildList {
        while (cursor.moveToNext()) add(cursor.toTrackRow())
      }
    }

  private fun getRecentlyPlayed(db: SQLiteDatabase): List<TrackRow> =
    queryTracks(
      db,
      "SELECT $TRACK_COLUMNS FROM playback_history h JOIN tracks t ON t.path = h.track_path " +
        "ORDER BY h.last_played_at DESC LIMIT 24",
    )

  private fun getFavorites(db: SQLiteDatabase): List<TrackRow> =
    queryTracks(
      db,
      "SELECT $TRACK_COLUMNS FROM favorites f JOIN tracks t ON t.path = f.track_path " +
        "ORDER BY f.added_at DESC",
    )

  private fun getPlaylistTracks(db: SQLiteDatabase, playlistId: Long): List<TrackRow> =
    queryTracks(
      db,
      "SELECT $TRACK_COLUMNS FROM playlist_tracks pt JOIN tracks t ON t.path = pt.track_path " +
        "WHERE pt.playlist_id = ? ORDER BY pt.position, pt.id",
      arrayOf(playlistId.toString()),
    )

  private fun getAlbumTracks(db: SQLiteDatabase, identityKey: String): List<TrackRow> =
    queryTracks(
      db,
      "SELECT $TRACK_COLUMNS FROM tracks t WHERE t.album_identity_key = ? ORDER BY $TRACK_ORDER",
      arrayOf(identityKey),
    )

  private fun getTrackByPath(db: SQLiteDatabase, path: String): TrackRow? =
    queryTracks(db, "SELECT $TRACK_COLUMNS FROM tracks t WHERE t.path = ? LIMIT 1", arrayOf(path)).firstOrNull()

  private fun getAllTracks(db: SQLiteDatabase): List<TrackRow> =
    queryTracks(
      db,
      "SELECT $TRACK_COLUMNS FROM tracks t ORDER BY t.artist COLLATE NOCASE, t.album COLLATE NOCASE, $TRACK_ORDER",
    )

  private fun getArtistTracks(db: SQLiteDatabase, artist: String): List<TrackRow> {
    val mode = getArtistGroupingMode(db)
    return getAllTracks(db).filter { trackMatchesBrowseArtist(it, normalizeKey(artist), mode) }
  }

  private fun getAlbums(db: SQLiteDatabase): List<AlbumRow> =
    db.rawQuery(
      """
      SELECT album_identity_key AS identity_key,
             MAX(album) AS album,
             MAX(COALESCE(album_artist, artist)) AS artist,
             MAX(year) AS year,
             MAX(artwork_hash) AS artwork_hash,
             MAX(source_id) AS source_id,
             MAX(artwork_source_id) AS artwork_source_id,
             COUNT(*) AS track_count
      FROM tracks
      GROUP BY album_identity_key
      ORDER BY 3 COLLATE NOCASE, 2 COLLATE NOCASE
      """.trimIndent(),
      emptyArray(),
    ).use { cursor ->
      buildList {
        while (cursor.moveToNext()) {
          add(
            AlbumRow(
              identityKey = cursor.string("identity_key"),
              album = cursor.string("album"),
              artist = cursor.string("artist"),
              artworkHash = cursor.nullableString("artwork_hash"),
              sourceId = cursor.nullableLong("source_id"),
              artworkSourceId = cursor.nullableString("artwork_source_id"),
              trackCount = cursor.long("track_count"),
            ),
          )
        }
      }
    }

  private fun getPlaylists(db: SQLiteDatabase): List<PlaylistRow> =
    db.rawQuery(
      """
      SELECT p.id, p.name,
             (SELECT t.artwork_hash
                FROM playlist_tracks pt JOIN tracks t ON t.path = pt.track_path
               WHERE pt.playlist_id = p.id AND t.artwork_hash IS NOT NULL
               ORDER BY pt.position, pt.id LIMIT 1) AS artwork_hash,
             (SELECT t.source_id
                FROM playlist_tracks pt JOIN tracks t ON t.path = pt.track_path
               WHERE pt.playlist_id = p.id AND t.artwork_source_id IS NOT NULL
               ORDER BY pt.position, pt.id LIMIT 1) AS source_id,
             (SELECT t.artwork_source_id
                FROM playlist_tracks pt JOIN tracks t ON t.path = pt.track_path
               WHERE pt.playlist_id = p.id AND t.artwork_source_id IS NOT NULL
               ORDER BY pt.position, pt.id LIMIT 1) AS artwork_source_id,
             (SELECT COUNT(*)
                FROM playlist_tracks pt JOIN tracks t ON t.path = pt.track_path
               WHERE pt.playlist_id = p.id) AS track_count
      FROM playlists p
      ORDER BY (p.last_played_at IS NULL), p.last_played_at DESC, p.updated_at DESC
      """.trimIndent(),
      emptyArray(),
    ).use { cursor ->
      buildList {
        while (cursor.moveToNext()) {
          add(
            PlaylistRow(
              id = cursor.long("id"),
              name = cursor.string("name"),
              artworkHash = cursor.nullableString("artwork_hash"),
              sourceId = cursor.nullableLong("source_id"),
              artworkSourceId = cursor.nullableString("artwork_source_id"),
              trackCount = cursor.long("track_count"),
            ),
          )
        }
      }
    }

  private fun getArtistGroupingMode(db: SQLiteDatabase): String =
    db.rawQuery(
      "SELECT value FROM settings WHERE key = ? LIMIT 1",
      arrayOf("artist_grouping_mode"),
    ).use { cursor ->
      if (cursor.moveToFirst() && cursor.string(0) == "fileTags") "fileTags" else "astra"
    }

  private fun getArtists(db: SQLiteDatabase): List<ArtistRow> =
    buildArtistList(getAllTracks(db), getArtistGroupingMode(db))

  private fun buildArtistList(tracks: List<TrackRow>, mode: String): List<ArtistRow> {
    val byKey = linkedMapOf<String, ArtistAggregate>()

    for (track in tracks) {
      val names =
        if (mode == "fileTags") listOf(resolveStrictBrowseArtist(track))
        else getCanonicalArtistIndexNames(track)
      val seen = mutableSetOf<String>()

      for (name in names) {
        val key = normalizeKey(name)
        if (key.isEmpty() || !seen.add(key)) continue
        val aggregate = byKey.getOrPut(key) {
          ArtistAggregate(
            artist = name,
            trackCount = 0,
            artworkHash = null,
            artworkYear = -1,
            artworkAddedAt = -1,
            artworkModifiedAt = -1,
          )
        }
        aggregate.trackCount += 1

        // Remote tracks carry no local artwork_hash; keep the first server cover ref as a
        // fallback so remote-only artists still get a tile (local hash wins when present).
        if (aggregate.remoteArtworkSourceId == null &&
          track.sourceId != null && !track.artworkSourceId.isNullOrBlank()
        ) {
          aggregate.remoteSourceId = track.sourceId
          aggregate.remoteArtworkSourceId = track.artworkSourceId
        }

        val artworkHash = track.artworkHash ?: continue
        val candidateYear = track.year ?: -1
        val better =
          aggregate.artworkHash == null ||
            candidateYear > aggregate.artworkYear ||
            (candidateYear == aggregate.artworkYear &&
              (track.addedAt > aggregate.artworkAddedAt ||
                (track.addedAt == aggregate.artworkAddedAt && track.modifiedAt > aggregate.artworkModifiedAt)))
        if (!better) continue
        aggregate.artworkHash = artworkHash
        aggregate.artworkYear = candidateYear
        aggregate.artworkAddedAt = track.addedAt
        aggregate.artworkModifiedAt = track.modifiedAt
      }
    }

    return byKey.values
      .map {
        ArtistRow(
          it.artist,
          it.trackCount.toLong(),
          it.artworkHash,
          it.remoteSourceId,
          it.remoteArtworkSourceId,
        )
      }
      .sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it.artist })
  }

  private fun normalizeDisplay(value: String?): String =
    value.orEmpty().replace(Regex("\\s+"), " ").trim()

  private fun normalizeKey(value: String?): String =
    normalizeDisplay(value).lowercase(Locale.ROOT)

  private fun splitCollaborators(rawArtist: String?): List<String> {
    val normalized = normalizeDisplay(rawArtist)
    if (normalized.isEmpty()) return emptyList()
    val unified = normalized
      .replace(Regex("\\s*;\\s*"), ",")
      .replace(Regex("\\s+&\\s+"), ",")
      .replace(Regex("\\s+[x×]\\s+", RegexOption.IGNORE_CASE), ",")
      .replace(Regex("\\s+(feat\\.?|ft\\.?|featuring|with)\\s+", RegexOption.IGNORE_CASE), ",")
    return dedupeByKey(unified.split(","))
  }

  private fun splitAlbumArtistCollaborators(rawAlbumArtist: String?): List<String> {
    val normalized = normalizeDisplay(rawAlbumArtist)
    if (normalized.isEmpty()) return emptyList()
    val unified = normalized
      .replace(Regex("\\s*;\\s*"), ",")
      .replace(Regex("\\s+[x×]\\s+", RegexOption.IGNORE_CASE), ",")
      .replace(Regex("\\s+(feat\\.?|ft\\.?|featuring|with)\\s+", RegexOption.IGNORE_CASE), ",")
    return dedupeByKey(unified.split(","))
  }

  private fun dedupeByKey(parts: List<String>): List<String> {
    val unique = linkedMapOf<String, String>()
    for (part in parts) {
      val display = normalizeDisplay(part)
      val key = normalizeKey(display)
      if (key.isEmpty() || unique.containsKey(key)) continue
      unique[key] = display
    }
    return unique.values.toList()
  }

  private fun resolveStrictBrowseArtist(track: TrackRow): String {
    val albumArtist = normalizeDisplay(track.albumArtist)
    return albumArtist.ifEmpty { normalizeDisplay(track.artist).ifEmpty { "Unknown Artist" } }
  }

  private fun resolveCanonicalBrowseArtist(track: TrackRow): String {
    val albumArtist = normalizeDisplay(track.albumArtist)
    if (albumArtist.isNotEmpty()) {
      return splitAlbumArtistCollaborators(albumArtist).firstOrNull() ?: albumArtist
    }
    return splitCollaborators(track.artist).firstOrNull() ?: "Unknown Artist"
  }

  private fun getCanonicalArtistIndexNames(track: TrackRow): List<String> {
    val unique = linkedMapOf<String, String>()
    fun add(name: String?) {
      val display = normalizeDisplay(name)
      val key = normalizeKey(display)
      if (key.isEmpty() || unique.containsKey(key)) return
      unique[key] = display
    }

    add(resolveCanonicalBrowseArtist(track))
    val trackArtists = splitCollaborators(track.artist)
    for (name in trackArtists) add(name)
    if (trackArtists.isEmpty()) {
      for (name in splitAlbumArtistCollaborators(track.albumArtist)) add(name)
    }
    return unique.values.toList()
  }

  private fun trackMatchesBrowseArtist(track: TrackRow, targetArtistKey: String, mode: String): Boolean {
    val browseKey = normalizeKey(
      if (mode == "fileTags") resolveStrictBrowseArtist(track) else resolveCanonicalBrowseArtist(track),
    )
    if (browseKey == targetArtistKey) return true
    if (mode == "fileTags") return false

    val albumArtistKey = normalizeKey(track.albumArtist)
    if (albumArtistKey.isNotEmpty() && albumArtistKey == targetArtistKey) return true

    val trackArtistKey = normalizeKey(track.artist)
    if (trackArtistKey.isNotEmpty() && trackArtistKey == targetArtistKey) return true

    if (splitAlbumArtistCollaborators(track.albumArtist).any { normalizeKey(it) == targetArtistKey }) return true
    return splitCollaborators(track.artist).any { normalizeKey(it) == targetArtistKey }
  }
}

private data class TrackRow(
  val id: Long,
  val path: String,
  val title: String,
  val artist: String,
  val album: String,
  val albumArtist: String?,
  val albumIdentityKey: String,
  val duration: Double,
  val trackNumber: Long?,
  val discNumber: Long?,
  val year: Long?,
  val artworkHash: String?,
  val sourceType: String,
  val sourceId: Long?,
  val sourceTrackId: String?,
  val artworkSourceId: String?,
  val addedAt: Long,
  val modifiedAt: Long,
)

private data class AlbumRow(
  val identityKey: String,
  val album: String,
  val artist: String,
  val artworkHash: String?,
  val sourceId: Long?,
  val artworkSourceId: String?,
  val trackCount: Long,
)

private data class PlaylistRow(
  val id: Long,
  val name: String,
  val artworkHash: String?,
  val sourceId: Long?,
  val artworkSourceId: String?,
  val trackCount: Long,
)

private data class ArtistRow(
  val artist: String,
  val trackCount: Long,
  val artworkHash: String?,
  val sourceId: Long?,
  val artworkSourceId: String?,
)

private data class ArtistAggregate(
  val artist: String,
  var trackCount: Int,
  var artworkHash: String?,
  var artworkYear: Long,
  var artworkAddedAt: Long,
  var artworkModifiedAt: Long,
  var remoteSourceId: Long? = null,
  var remoteArtworkSourceId: String? = null,
)

private fun Cursor.toTrackRow(): TrackRow =
  TrackRow(
    id = long("id"),
    path = string("path"),
    title = string("title"),
    artist = string("artist"),
    album = string("album"),
    albumArtist = nullableString("album_artist"),
    albumIdentityKey = string("album_identity_key"),
    duration = double("duration"),
    trackNumber = nullableLong("track_number"),
    discNumber = nullableLong("disc_number"),
    year = nullableLong("year"),
    artworkHash = nullableString("artwork_hash"),
    sourceType = string("source_type"),
    sourceId = nullableLong("source_id"),
    sourceTrackId = nullableString("source_track_id"),
    artworkSourceId = nullableString("artwork_source_id"),
    addedAt = long("added_at"),
    modifiedAt = long("modified_at"),
  )

private fun Cursor.string(name: String): String = string(getColumnIndexOrThrow(name))

private fun Cursor.string(index: Int): String = getString(index) ?: ""

private fun Cursor.nullableString(name: String): String? {
  val index = getColumnIndexOrThrow(name)
  return if (isNull(index)) null else getString(index)
}

private fun Cursor.long(name: String): Long = getLong(getColumnIndexOrThrow(name))

private fun Cursor.nullableLong(name: String): Long? {
  val index = getColumnIndexOrThrow(name)
  return if (isNull(index)) null else getLong(index)
}

private fun Cursor.double(name: String): Double = getDouble(getColumnIndexOrThrow(name))
