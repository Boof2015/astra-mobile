package expo.modules.astracar

import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.support.v4.media.MediaBrowserCompat
import android.support.v4.media.MediaBrowserCompat.MediaItem
import android.support.v4.media.MediaDescriptionCompat
import android.support.v4.media.MediaMetadataCompat
import expo.modules.astralibraryscanner.data.*

/** Bounded Room queries shared with the phone's catalog, never a separate database. */
class AstraCarCatalog(
  private val context: Context,
  private val providedCatalog: CatalogDao? = null,
  private val providedUser: UserDao? = null,
) {
  private val repository get() = AstraLibraryRepository.get(context)
  private lateinit var catalog: CatalogDao
  private lateinit var user: UserDao
  private suspend fun initialize() {
    if (providedCatalog != null && providedUser != null) {
      catalog = providedCatalog; user = providedUser; return
    }
    repository.initialize()
    catalog = repository.catalogDb().catalogDao()
    user = repository.userDb().userDao()
  }
  val queue = AstraCarQueue(context)

  suspend fun loadChildren(parentId: String, options: Bundle? = null, actionLimit: Int = 0): List<MediaItem> {
    initialize()
    val requested = AstraCarMediaIds.decode(parentId) ?: return emptyList()
    val media = collection(requested) ?: return emptyList()
    if (media.section == "queue" && media.session != null && media.session != queue.sessionId()) return emptyList()
    val total = count(media)
    val start = requested.offset?.coerceAtLeast(0) ?: 0L
    val available = minOf(requested.size ?: total, (total - start).coerceAtLeast(0)).coerceAtLeast(0)
    val page = options?.getInt(MediaBrowserCompat.EXTRA_PAGE, -1) ?: -1
    val size = options?.getInt(MediaBrowserCompat.EXTRA_PAGE_SIZE, -1) ?: -1
    if (page >= 0 && size in 1..100) {
      val offset = page.toLong() * size
      if (offset >= available) return emptyList()
      return rows(media, start + offset, minOf(size.toLong(), available - offset).toInt(), actionLimit)
    }
    if (requested.kind == "section" && media.section == "queue") return upcomingQueue(total)
    val favoritesRoot = requested.kind == "section" && media.section == "favorites"
    val prefix = if (favoritesRoot && total > 0) listOf(section("recentFavorites")) else emptyList()
    if (available > AstraCarPagination.PAGE_SIZE - prefix.size) {
      val query = alphabetQuery(media)
      if (requested.kind != "range" && media.firstLetter == null && query != null) {
        val letters = AstraCarPagination.letters(catalog.getCarBrowseGroups(query.groups()).map { it.label to it.itemCount }, 100 - prefix.size)
        if (letters.size > 1) return prefix + letters.map { group ->
          browse(AstraCarMediaIds.encode(AstraCarMediaId("letters", key = AstraCarMediaIds.encode(media),
            firstLetter = group.first, lastLetter = group.last)), group.title, "${group.count} ${unit(media)}")
        }
      }
      return prefix + AstraCarPagination.ranges(start, available, 100 - prefix.size).map { range -> rangeItem(media, range) }
    }
    return prefix + rows(media, start, available.toInt(), actionLimit)
  }

  private fun collection(requested: AstraCarMediaId): AstraCarMediaId? {
    val parent = if (requested.kind == "range") AstraCarMediaIds.decode(requested.key) ?: return null else requested
    return if (parent.kind == "letters") AstraCarMediaIds.decode(parent.key)?.copy(
      firstLetter = parent.firstLetter, lastLetter = parent.lastLetter) else parent
  }

  private suspend fun alphabetQuery(media: AstraCarMediaId): CarBrowseQuery? {
    val kind = when {
      media.kind == "artist" -> CarBrowseQuery.Kind.ARTIST_ALBUMS
      media.kind != "section" -> return null
      media.section == "tracks" -> CarBrowseQuery.Kind.TRACKS
      media.section == "favorites" -> CarBrowseQuery.Kind.FAVORITES
      media.section == "albums" -> CarBrowseQuery.Kind.ALBUMS
      media.section == "artists" -> CarBrowseQuery.Kind.ARTISTS
      else -> return null
    }
    return CarBrowseQuery(kind, catalog.getRevision(), grouping(), media.key, media.firstLetter, media.lastLetter)
  }

  private suspend fun count(media: AstraCarMediaId): Long {
    alphabetQuery(media)?.let { return catalog.runDynamicCountQuery(it.count()) }
    return when (media.kind) {
    "root" -> 4
    "section" -> when (media.section) {
      "home", "library" -> 3
      "recent" -> minOf(24, user.countPlaybackHistory())
      "recentFavorites" -> minOf(24, user.countFavorites())
      "playlists" -> user.countPlaylists()
      "queue" -> queue.count()
      else -> 0
    }
    "album" -> media.key?.let { catalog.countAlbumTracks(it) } ?: 0
    "playlist" -> media.id?.let { playlistId ->
      val playlist = user.getPlaylist(playlistId) ?: return 0
      if (playlist.kind == "dynamic") catalog.runDynamicCountQuery(DynamicPlaylistCompiler.compile(playlist.dynamicRulesJson, 0, 1).count)
      else user.countPlaylistTracks(playlistId)
    } ?: 0
    else -> 0
    }
  }

  private suspend fun rows(media: AstraCarMediaId, offset: Long, limit: Int, actionLimit: Int): List<MediaItem> {
    if (limit <= 0) return emptyList()
    alphabetQuery(media)?.let { query ->
      return when (query.kind) {
        CarBrowseQuery.Kind.TRACKS, CarBrowseQuery.Kind.FAVORITES -> catalog.runDynamicTrackQuery(query.page(offset, limit)).map { track(it, media, actionLimit) }
        CarBrowseQuery.Kind.ALBUMS, CarBrowseQuery.Kind.ARTIST_ALBUMS -> catalog.getCarAlbumPage(query.page(offset, limit)).map { album(it, actionLimit) }
        CarBrowseQuery.Kind.ARTISTS -> catalog.getCarArtistPage(query.page(offset, limit)).map { artist(it, actionLimit) }
      }
    }
    fun sectionRows(sections: List<String>) = sections.drop(offset.toInt()).take(limit).map(::section)
    val tracks: List<ActiveTrackView> = when (media.kind) {
      "root" -> return sectionRows(listOf("home", "library", "playlists", "queue"))
      "section" -> when (media.section) {
        "home" -> return sectionRows(listOf("recent", "favorites", "shuffleAll"))
        "library" -> return sectionRows(listOf("tracks", "albums", "artists"))
        "recent" -> tracksForPaths(user.getPlaybackHistoryPage(offset, limit).map { it.trackPath })
        "recentFavorites" -> tracksForPaths(user.getFavoritePage(offset, limit).map { it.trackPath })
        "playlists" -> return user.getPlaylistPage(offset, limit).map { playlist(it, actionLimit) }
        "queue" -> return queue.page(offset, limit).map { queueItem(it) }
        else -> emptyList()
      }
      "album" -> media.key?.let { catalog.getAlbumTrackOffsetPage(it, offset, limit) }.orEmpty()
      "playlist" -> media.id?.let { playlistTracks(it, offset, limit) }.orEmpty()
      else -> emptyList()
    }
    return tracks.map { track(it, media, actionLimit) }
  }

  suspend fun loadItem(id: String, actionLimit: Int = 0): MediaItem? {
    initialize()
    val media = AstraCarMediaIds.decode(id) ?: return null
    return when (media.kind) {
      "root" -> browse(id, "Astra", null)
      "section" -> media.section?.let(::section)
      "letters" -> browse(id, AstraCarPagination.Letters(media.firstLetter ?: "#", media.lastLetter ?: "#", 0).title, null)
      "range" -> collection(media)?.let { parent ->
        rangeItem(parent, AstraCarPagination.Range(media.offset ?: 0, media.size ?: 0), id, media.section)
      }
      "album" -> media.key?.let { catalog.getAlbumSummary(catalog.getRevision(), it) }?.let { album(it, actionLimit) }
      "artist" -> media.key?.let { catalog.getArtistSummary(catalog.getRevision(), grouping(), it) }?.let { artist(it, actionLimit) }
      "playlist" -> media.id?.let { user.getPlaylist(it) }?.let { playlist(it, actionLimit) }
      "track" -> media.path?.let { catalog.getActiveTrack(it) }?.let {
        track(it, AstraCarMediaId(media.contextKind ?: "track", media.contextSection, media.contextKey, media.contextId), actionLimit)
      }
      "queueEntry" -> if (media.session != null && media.key != null) {
        queue.resolve(media.session, media.key)?.let { queue.page(it, 1).firstOrNull() }?.let { queueItem(it) }
      } else null
      else -> null
    }
  }

  suspend fun search(query: String, actionLimit: Int): List<MediaItem> {
    initialize()
    if (query.isBlank()) return emptyList()
    val result = repository.searchLibrary(query.take(512), 25, true, grouping(), true)
    @Suppress("UNCHECKED_CAST")
    fun resultRows(key: String) = result[key] as? List<Map<String, Any?>> ?: emptyList()
    val items = mutableListOf<MediaItem>()
    for (row in resultRows("tracks")) {
      val path = row["path"] as? String ?: continue
      catalog.getActiveTrack(path)?.let { items += track(it, AstraCarMediaId("track"), actionLimit) }
    }
    for (row in resultRows("albums")) {
      val key = row["identity_key"] as? String ?: continue
      catalog.getAlbumSummary(catalog.getRevision(), key)?.let { items += album(it, actionLimit) }
    }
    for (row in resultRows("artists")) {
      val key = row["artist"] as? String ?: continue
      catalog.getArtistSummary(catalog.getRevision(), grouping(), key)?.let { items += artist(it, actionLimit) }
    }
    // Playlist names live in the user database; the query itself remains bounded.
    for (row in user.searchPlaylistPage("%${query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")}%", 25)) items += playlist(row, actionLimit)
    return items
  }

  private suspend fun playlistTracks(id: Long, offset: Long, limit: Int): List<ActiveTrackView> {
    val playlist = user.getPlaylist(id) ?: return emptyList()
    return if (playlist.kind == "dynamic") {
      catalog.runDynamicTrackQuery(DynamicPlaylistCompiler.compile(playlist.dynamicRulesJson, offset.toInt(), limit).tracks)
    } else tracksForPaths(user.getPlaylistTrackPage(id, limit, offset.toInt()).map { it.trackPath })
  }

  private suspend fun tracksForPaths(paths: List<String>): List<ActiveTrackView> {
    if (paths.isEmpty()) return emptyList()
    val byPath = catalog.getActiveTracks(paths.distinct()).associateBy { it.path }
    return paths.mapNotNull(byPath::get)
  }

  private suspend fun grouping(): String = if (user.getSetting("artist_grouping_mode") == "fileTags") "fileTags" else "astra"

  private fun unit(media: AstraCarMediaId) = when {
    media.kind == "artist" || media.section == "albums" -> "albums"
    media.section == "artists" -> "artists"
    media.section == "playlists" -> "playlists"
    else -> "songs"
  }

  private suspend fun rangeItem(media: AstraCarMediaId, range: AstraCarPagination.Range, existingId: String? = null, section: String? = null): MediaItem {
    val first = rows(media, range.offset, 1, 0).firstOrNull()?.description
    val last = if (range.size > 1) rows(media, range.offset + range.size - 1, 1, 0).firstOrNull()?.description else first
    val id = existingId ?: AstraCarMediaIds.encode(AstraCarMediaId("range", key = AstraCarMediaIds.encode(media), offset = range.offset, size = range.size, section = section))
    val title = when (section) {
      "earlierQueue" -> "Earlier in queue"
      "laterQueue" -> "Later in queue"
      else -> AstraCarPagination.contentTitle(first?.title?.toString(), last?.title?.toString())
    }
    val detail = AstraCarPagination.contentTitle(first?.subtitle?.toString(), last?.subtitle?.toString())
    return browse(id, title, "${range.size} ${unit(media)} · $detail", first?.iconUri)
  }

  private suspend fun upcomingQueue(total: Long): List<MediaItem> {
    if (total <= 0) return emptyList()
    val session = queue.sessionId()
    val current = queue.current().track
    val position = current?.let { queue.resolve(session, it.entryId) }?.coerceIn(0, total - 1) ?: 0L
    val window = AstraCarPagination.queueWindow(position, total)
    val entries = queue.page(window.offset, window.size.toInt())
    val result = entries.map { queueItem(it, it.entryId == current?.entryId) }.toMutableList()
    val media = AstraCarMediaId("section", section = "queue", session = session)
    val end = window.offset + window.size
    if (end < total) result += rangeItem(media, AstraCarPagination.Range(end, total - end), section = "laterQueue")
    if (position > 0) result += rangeItem(media, AstraCarPagination.Range(0, position), section = "earlierQueue")
    return result
  }

  private fun section(name: String): MediaItem {
    val title = mapOf("home" to "Home", "library" to "Library", "recent" to "Recently Played", "favorites" to "Favorites",
      "playlists" to "Playlists", "albums" to "Albums", "artists" to "Artists", "tracks" to "Tracks", "queue" to "Queue", "shuffleAll" to "Shuffle all", "recentFavorites" to "Recently Favorited")[name] ?: name
    return item(AstraCarMediaIds.section(name), title, null, null, null,
      if (name == "shuffleAll") MediaItem.FLAG_PLAYABLE else MediaItem.FLAG_BROWSABLE)
  }

  private fun album(row: AlbumSummaryEntity, actions: Int) = browse(AstraCarMediaIds.album(row.identityKey), row.album, row.artist,
    art(row.artworkHash, row.sourceId, row.artworkSourceId), actions)

  private fun artist(row: ArtistSummaryEntity, actions: Int) = browse(AstraCarMediaIds.artist(row.artistKey), row.artist,
    "${row.trackCount} tracks", art(row.artworkHash, row.sourceId, row.artworkSourceId), actions)

  private suspend fun playlist(row: PlaylistEntity, actions: Int): MediaItem {
    val cover = playlistTracks(row.id, 0, 1).firstOrNull()
    return browse(AstraCarMediaIds.playlist(row.id), row.name, null,
      cover?.let { art(it.artworkHash, it.sourceId, it.artworkSourceId) }, actions)
  }

  private fun track(row: ActiveTrackView, parent: AstraCarMediaId, actions: Int) = item(
    AstraCarMediaIds.track(row.path, parent), row.title, row.artist, row.album,
    art(row.artworkHash, row.sourceId, row.artworkSourceId), MediaItem.FLAG_PLAYABLE, actions, (row.duration * 1000).toLong())

  suspend fun queueItem(track: AstraCarTrack, current: Boolean = false): MediaItem = item(
    AstraCarMediaIds.encode(AstraCarMediaId("queueEntry", key = track.entryId, session = track.sessionId ?: queue.sessionId())),
    track.title, if (current) "Now playing · ${track.artist}" else track.artist, track.album, AstraCarArtwork.forTrack(context, track, false), MediaItem.FLAG_PLAYABLE, duration = track.durationMs)

  private fun art(hash: String?, source: Long?, artId: String?): Uri = when {
    hash != null && AstraCarArtwork.localFile(context, hash, false) != null -> AstraCarArtwork.localUri(context, hash)
    source != null && !artId.isNullOrBlank() -> AstraCarArtwork.readyRemoteUri(context, source, artId, false)
    else -> AstraCarArtwork.placeholder(context)
  }

  private fun browse(id: String, title: String, subtitle: String?, icon: Uri? = null, actions: Int = 0) =
    item(id, title, subtitle, null, icon, MediaItem.FLAG_BROWSABLE, actions)

  private fun item(id: String, title: String, subtitle: String?, description: String?, icon: Uri?, flags: Int, actions: Int = 0, duration: Long = 0): MediaItem =
    MediaItem(MediaDescriptionCompat.Builder().setMediaId(id).setTitle(title.take(512)).setSubtitle(subtitle?.take(512))
      .setDescription(description?.take(512)).setIconUri(icon).setExtras(Bundle().apply {
        if (duration > 0) putLong(MediaMetadataCompat.METADATA_KEY_DURATION, duration)
        if (actions > 0) putStringArrayList(AstraCarBrowseActions.ITEM_ACTIONS, ArrayList(listOf("playNext", "addToQueue").take(actions)))
      }).build(), flags)
}
