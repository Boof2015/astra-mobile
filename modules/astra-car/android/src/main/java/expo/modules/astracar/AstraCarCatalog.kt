package expo.modules.astracar

import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaBrowserCompat.MediaItem
import android.support.v4.media.MediaDescriptionCompat
import android.support.v4.media.MediaMetadataCompat
import android.util.Log
import expo.modules.astralibraryscanner.data.ActiveTrackView
import expo.modules.astralibraryscanner.data.AlbumSummaryEntity
import expo.modules.astralibraryscanner.data.ArtistSummaryEntity
import expo.modules.astralibraryscanner.data.AstraLibraryRepository
import expo.modules.astralibraryscanner.data.DynamicPlaylistCompiler
import java.io.File
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking

private const val TAG = "AstraCarCatalog"
private const val MAX_UNPAGED_CHILDREN = 500
private const val ROOM_PAGE_SIZE = 200

/**
 * Android Auto reads through the same Room repository as React Native and the
 * scanner. It never opens a SQLite file independently and never observes a
 * staging catalog generation.
 */
class AstraCarCatalog(private val context: Context) {
  private val repository by lazy { AstraLibraryRepository.get(context) }

  fun loadChildren(parentId: String, options: Bundle? = null): List<MediaItem> {
    val media = AstraCarMediaIds.decode(parentId) ?: AstraCarMediaId(kind = "root")
    val items = runCatching {
      room { childrenFor(media) }
    }.onFailure {
      Log.w(TAG, "Room browse failed for $parentId", it)
    }.getOrElse {
      if (media.kind == "root") rootItems() else emptyList()
    }
    return paginate(items, options)
  }

  fun loadItem(mediaId: String): MediaItem? {
    val media = AstraCarMediaIds.decode(mediaId) ?: return null
    return runCatching {
      room {
        val catalog = repository.catalogDb().catalogDao()
        when (media.kind) {
          "section" -> sectionItem(media.section ?: return@room null)
          "album" -> media.key
            ?.let { catalog.getAlbumSummary(catalog.getRevision(), it) }
            ?.let(::albumItem)
          "artist" -> media.key
            ?.let {
              catalog.getArtistSummary(
                catalog.getRevision(),
                artistGroupingMode(),
                it,
              )
            }
            ?.let(::artistItem)
          "playlist" -> media.id
            ?.let { id -> playlists().firstOrNull { it.id == id } }
            ?.let(::playlistItem)
          "track" -> {
            val path = media.path ?: return@room null
            val track = catalog.getActiveTrack(path) ?: return@room null
            trackItem(track, contextFromTrackMedia(media))
          }
          "root" -> rootItem()
          else -> null
        }
      }
    }.getOrNull()
  }

  private suspend fun childrenFor(media: AstraCarMediaId): List<MediaItem> {
    val catalog = repository.catalogDb().catalogDao()
    return when (media.kind) {
      "root" -> rootItems()
      "section" -> when (media.section) {
        "recent" -> tracksForPaths(
          repository.userDb().userDao().getPlaybackHistory().take(24).map { it.trackPath },
        ).map { trackItem(it, AstraCarMediaId(kind = "section", section = "recent")) }
        "favorites" -> tracksForPaths(
          repository.userDb().userDao().getFavorites().map { it.trackPath },
        ).map { trackItem(it, AstraCarMediaId(kind = "section", section = "favorites")) }
        "playlists" -> playlists().map(::playlistItem)
        "albums" -> catalog.getAllAlbumSummaries(catalog.getRevision()).map(::albumItem)
        "artists" -> catalog
          .getAllArtistSummaries(catalog.getRevision(), artistGroupingMode())
          .map(::artistItem)
        else -> emptyList()
      }
      "playlist" -> {
        val id = media.id
        if (id == null) emptyList()
        else playlistTracks(id).map {
          trackItem(it, AstraCarMediaId(kind = "playlist", id = id))
        }
      }
      "album" -> {
        val key = media.key
        if (key == null) emptyList()
        else catalog.getAlbumTracks(key).map {
          trackItem(it, AstraCarMediaId(kind = "album", key = key))
        }
      }
      "artist" -> media.key
        ?.let {
          catalog.getAllArtistTracks(
            catalog.getRevision(),
            artistGroupingMode(),
            it,
          )
        }
        ?.map { trackItem(it, AstraCarMediaId(kind = "artist", key = media.key)) }
        .orEmpty()
      else -> emptyList()
    }
  }

  private suspend fun playlistTracks(playlistId: Long): List<ActiveTrackView> {
    val userDao = repository.userDb().userDao()
    val catalogDao = repository.catalogDb().catalogDao()
    val playlist = userDao.getPlaylist(playlistId) ?: return emptyList()
    if (playlist.kind != "dynamic") {
      return tracksForPaths(userDao.getPlaylistTracks(playlistId).map { it.trackPath })
    }
    val total = DynamicPlaylistCompiler
      .compile(playlist.dynamicRulesJson, 0, 1)
      .let { catalogDao.runDynamicCountQuery(it.count).toInt() }
    val tracks = ArrayList<ActiveTrackView>(total)
    for (offset in 0 until total step ROOM_PAGE_SIZE) {
      val query = DynamicPlaylistCompiler.compile(
        playlist.dynamicRulesJson,
        offset,
        minOf(ROOM_PAGE_SIZE, total - offset),
      )
      tracks += catalogDao.runDynamicTrackQuery(query.tracks)
    }
    return tracks
  }

  private suspend fun playlists(): List<PlaylistRow> {
    val userDao = repository.userDb().userDao()
    val catalogDao = repository.catalogDb().catalogDao()
    return userDao.getPlaylists().map { playlist ->
      val tracks = if (playlist.kind == "dynamic") {
        val query = DynamicPlaylistCompiler.compile(playlist.dynamicRulesJson, 0, 1)
        catalogDao.runDynamicTrackQuery(query.tracks)
      } else {
        val firstPath = userDao.getPlaylistTrackPage(playlist.id, 1, 0).firstOrNull()?.trackPath
        val first = if (firstPath == null) null else catalogDao.getActiveTrack(firstPath)
        if (first == null) emptyList() else listOf(first)
      }
      val count = if (playlist.kind == "dynamic") {
        val query = DynamicPlaylistCompiler.compile(playlist.dynamicRulesJson, 0, 1)
        catalogDao.runDynamicCountQuery(query.count)
      } else {
        userDao.countPlaylistTracks(playlist.id)
      }
      val cover = tracks.firstOrNull {
        it.artworkHash != null || (it.sourceId != null && !it.artworkSourceId.isNullOrBlank())
      }
      PlaylistRow(
        id = playlist.id,
        name = playlist.name,
        artworkHash = cover?.artworkHash,
        sourceId = cover?.sourceId,
        artworkSourceId = cover?.artworkSourceId,
        trackCount = count,
      )
    }
  }

  private suspend fun tracksForPaths(paths: List<String>): List<ActiveTrackView> {
    if (paths.isEmpty()) return emptyList()
    val catalog = repository.catalogDb().catalogDao()
    val rows = LinkedHashMap<String, ActiveTrackView>()
    for (chunk in paths.distinct().chunked(ROOM_PAGE_SIZE)) {
      catalog.getActiveTracks(chunk).forEach { rows[it.path] = it }
    }
    return paths.mapNotNull(rows::get)
  }

  private suspend fun artistGroupingMode(): String =
    if (repository.userDb().userDao().getSetting("artist_grouping_mode") == "fileTags") {
      "fileTags"
    } else {
      "astra"
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
    listOf("recent", "favorites", "playlists", "albums", "artists").map(::sectionItem)

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

  private fun albumItem(album: AlbumSummaryEntity): MediaItem =
    browsable(
      AstraCarMediaIds.album(album.identityKey),
      album.album,
      album.artist,
      artworkIconUri(album.artworkHash, album.sourceId, album.artworkSourceId),
      "${album.trackCount} ${if (album.trackCount == 1L) "track" else "tracks"}",
    )

  private fun artistItem(artist: ArtistSummaryEntity): MediaItem =
    browsable(
      AstraCarMediaIds.artist(artist.artistKey),
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

  private fun trackItem(track: ActiveTrackView, contextMedia: AstraCarMediaId): MediaItem {
    val extras = Bundle().apply {
      putLong(MediaMetadataCompat.METADATA_KEY_DURATION, (track.duration * 1000).toLong())
    }
    return MediaItem(
      MediaDescriptionCompat.Builder()
        .setMediaId(AstraCarMediaIds.track(track.path, contextMedia))
        .setTitle(track.title)
        .setSubtitle(track.artist)
        .setDescription(track.album)
        .setIconUri(artworkIconUri(track.artworkHash, track.sourceId, track.artworkSourceId))
        .setExtras(extras)
        .build(),
      MediaItem.FLAG_PLAYABLE,
    )
  }

  private fun browsable(
    mediaId: String,
    title: String,
    subtitle: String?,
    iconUri: Uri? = null,
    description: String? = null,
  ): MediaItem =
    MediaItem(
      MediaDescriptionCompat.Builder()
        .setMediaId(mediaId)
        .setTitle(title)
        .setSubtitle(subtitle)
        .setDescription(description)
        .setIconUri(iconUri)
        .build(),
      MediaItem.FLAG_BROWSABLE,
    )

  private fun artworkIconUri(hash: String?, sourceId: Long?, artworkSourceId: String?): Uri? {
    return localArtworkUri(hash)
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
        Log.w(TAG, "capping ${items.size} children to $MAX_UNPAGED_CHILDREN")
        return items.take(MAX_UNPAGED_CHILDREN)
      }
      return items
    }
    val from = page * pageSize
    if (from >= items.size) return emptyList()
    return items.subList(from, minOf(from + pageSize, items.size))
  }

  private fun contextFromTrackMedia(media: AstraCarMediaId): AstraCarMediaId =
    AstraCarMediaId(
      kind = media.contextKind ?: "track",
      section = media.contextSection,
      key = media.contextKey,
      id = media.contextId,
    )

  private fun <T> room(block: suspend () -> T): T =
    runBlocking(Dispatchers.IO) {
      repository.initialize()
      block()
    }
}

private data class PlaylistRow(
  val id: Long,
  val name: String,
  val artworkHash: String?,
  val sourceId: Long?,
  val artworkSourceId: String?,
  val trackCount: Long,
)
