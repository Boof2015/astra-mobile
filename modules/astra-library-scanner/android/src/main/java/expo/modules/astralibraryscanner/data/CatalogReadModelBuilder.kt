package expo.modules.astralibraryscanner.data

import android.net.Uri
import java.util.Locale
import org.json.JSONArray

data class AlbumIdentityUpdate(
  val trackId: Long,
  val identityKey: String,
  val displayArtist: String,
)

data class CatalogReadModels(
  val identityUpdates: List<AlbumIdentityUpdate>,
  val albums: List<AlbumSummaryEntity>,
  val artists: List<ArtistSummaryEntity>,
  val artistTrackIndex: List<ArtistTrackIndexEntity>,
  val directories: List<DirectorySummaryEntity>,
  val ftsRows: List<TrackFtsEntity>,
)

data class LocalAudioFile(
  val uri: String,
  val name: String,
  val size: Long?,
  val lastModified: Long,
  val mimeType: String?,
  val parentUri: String,
  val coverUri: String?,
)

data class LocalAudioMetadata(
  val ok: Boolean,
  val title: String? = null,
  val artist: String? = null,
  val album: String? = null,
  val albumArtist: String? = null,
  val genre: String? = null,
  val mimeType: String? = null,
  val durationMs: Long? = null,
  val bitrate: Int? = null,
  val trackNumber: Int? = null,
  val discNumber: Int? = null,
  val year: Int? = null,
  val sampleRate: Int? = null,
  val channels: Int? = null,
  val bitsPerSample: Int? = null,
  val codecMime: String? = null,
  val artworkHash: String? = null,
  val error: String? = null,
)

data class NativeScanResult(
  val added: Int,
  val updated: Int,
  val removed: Int,
  val errors: Int,
  val total: Int,
  val revision: Long,
) {
  fun toMap(): Map<String, Any> = mapOf(
    "added" to added,
    "updated" to updated,
    "removed" to removed,
    "errors" to errors,
    "total" to total,
    "catalogRevision" to revision.toString(),
  )
}

private data class PreparedAlbumTrack(
  val track: TrackEntity,
  val albumKey: String,
  val primaryArtist: String,
  val primaryArtistKey: String,
  val normalizedAlbumArtist: String,
  val artworkIdentityHash: String?,
)

private data class SettledTrack(
  val track: TrackEntity,
  val identityKey: String,
  val displayArtist: String,
)

object CatalogReadModelBuilder {
  private const val UNKNOWN_ARTIST = "Unknown Artist"
  private const val UNKNOWN_ALBUM = "Unknown Album"
  private const val VARIOUS_ARTISTS = "Various Artists"

  fun build(
    tracks: List<TrackEntity>,
    revision: Long,
    folders: Map<Long, FolderEntity> = emptyMap(),
  ): CatalogReadModels {
    val settled = settleAlbums(tracks)
    val artistModels = buildArtists(settled, revision)
    return CatalogReadModels(
      identityUpdates = settled.mapNotNull { row ->
        if (
          row.track.albumIdentityKey == row.identityKey &&
          row.track.albumDisplayArtist == row.displayArtist
        ) {
          null
        } else {
          AlbumIdentityUpdate(row.track.id, row.identityKey, row.displayArtist)
        }
      },
      albums = buildAlbums(settled, revision),
      artists = artistModels.first,
      artistTrackIndex = artistModels.second,
      directories = buildDirectories(settled, revision, folders),
      ftsRows = settled.map { row ->
        TrackFtsEntity(
          rowId = row.track.id,
          title = row.track.title,
          artist = row.track.artist,
          album = row.track.album,
          fileName = row.track.fileName,
        )
      },
    )
  }

  fun provisionalIdentity(
    album: String,
    artist: String,
    albumArtist: String?,
  ): Pair<String, String> {
    val albumKey = normalizeKey(normalizeAlbum(album))
    val explicit = normalizeDisplay(albumArtist.orEmpty())
    if (explicit.isNotEmpty()) {
      return identity(albumKey, "aa:${normalizeKey(explicit).ifEmpty { normalizeKey(UNKNOWN_ARTIST) }}") to explicit
    }
    val primary = primaryArtist(artist)
    return identity(albumKey, "ta:${normalizeKey(primary)}") to primary
  }

  private fun settleAlbums(tracks: List<TrackEntity>): List<SettledTrack> {
    val settled = ArrayList<SettledTrack>(tracks.size)
    val missingAlbumArtist = LinkedHashMap<String, MutableList<PreparedAlbumTrack>>()

    for (track in tracks) {
      val albumKey = normalizeKey(normalizeAlbum(track.album))
      val explicit = normalizeDisplay(track.albumArtist.orEmpty())
      val primary = primaryArtist(track.artist)
      val prepared = PreparedAlbumTrack(
        track = track,
        albumKey = albumKey,
        primaryArtist = primary,
        primaryArtistKey = normalizeKey(primary),
        normalizedAlbumArtist = explicit,
        artworkIdentityHash = normalizeKey(
          track.artworkHash ?: if (track.sourceType != "local") track.artworkSourceId.orEmpty() else "",
        ).ifEmpty { null },
      )
      if (explicit.isNotEmpty()) {
        settled += SettledTrack(
          track,
          identity(albumKey, "aa:${normalizeKey(explicit).ifEmpty { normalizeKey(UNKNOWN_ARTIST) }}"),
          explicit,
        )
      } else {
        missingAlbumArtist.getOrPut(albumKey) { mutableListOf() } += prepared
      }
    }

    for ((albumKey, bucket) in missingAlbumArtist) {
      val artistKeys = bucket.mapTo(linkedSetOf()) { it.primaryArtistKey }
      val firstArtwork = bucket.firstOrNull()?.artworkIdentityHash
      val sharedArtwork = if (
        artistKeys.size > 1 &&
        firstArtwork != null &&
        bucket.all { it.artworkIdentityHash == firstArtwork }
      ) {
        firstArtwork
      } else {
        null
      }
      if (sharedArtwork != null) {
        val key = identity(albumKey, "ah:$sharedArtwork")
        bucket.forEach { settled += SettledTrack(it.track, key, VARIOUS_ARTISTS) }
      } else {
        bucket.forEach {
          settled += SettledTrack(
            it.track,
            identity(albumKey, "ta:${it.primaryArtistKey}"),
            it.primaryArtist,
          )
        }
      }
    }
    return settled
  }

  private fun buildAlbums(
    tracks: List<SettledTrack>,
    revision: Long,
  ): List<AlbumSummaryEntity> {
    return tracks.groupBy(SettledTrack::identityKey).map { (identityKey, rows) ->
      val album = mostFrequent(rows.map { normalizeAlbum(it.track.album) }, UNKNOWN_ALBUM)
      val artist = rows.firstNotNullOfOrNull { it.displayArtist.takeIf(String::isNotBlank) }
        ?: rows.first().track.albumArtist
        ?: rows.first().track.artist
      val artwork = mostFrequentNullable(rows.map { it.track.artworkHash })
      val remote = rows.firstOrNull { it.track.sourceType != "local" }?.track
      AlbumSummaryEntity(
        revision = revision,
        identityKey = identityKey,
        album = album,
        artist = artist,
        year = rows.mapNotNull { it.track.year }.maxOrNull(),
        artworkHash = artwork,
        sourceType = remote?.sourceType ?: "local",
        sourceId = remote?.sourceId,
        artworkSourceId = remote?.artworkSourceId,
        trackCount = rows.size.toLong(),
        totalDuration = rows.sumOf { it.track.duration },
        latestAddedAt = rows.maxOf { it.track.addedAt },
        nameSortKey = SortKeys.forText(album),
        artistSortKey = SortKeys.forText(artist),
        sectionLabel = SortKeys.sectionLabel(album),
        isSingle = rows.size < 2,
      )
    }
  }

  private fun buildArtists(
    tracks: List<SettledTrack>,
    revision: Long,
  ): Pair<List<ArtistSummaryEntity>, List<ArtistTrackIndexEntity>> {
    val result = mutableListOf<ArtistSummaryEntity>()
    val index = mutableListOf<ArtistTrackIndexEntity>()
    for (mode in listOf("astra", "fileTags")) {
      data class Aggregate(
        val name: String,
        var trackCount: Long = 0,
        var primaryCount: Long = 0,
        val albumKeys: MutableSet<String> = linkedSetOf(),
        var artworkTrack: TrackEntity? = null,
        val artworkHashes: MutableSet<String> = linkedSetOf(),
      )
      val aggregates = LinkedHashMap<String, Aggregate>()
      for (row in tracks) {
        val track = row.track
        val primary = if (mode == "fileTags") {
          normalizeDisplay(track.albumArtist.orEmpty()).ifEmpty {
            normalizeDisplay(track.artist).ifEmpty { UNKNOWN_ARTIST }
          }
        } else {
          canonicalPrimary(track)
        }
        val names = if (mode == "fileTags") {
          listOf(primary)
        } else {
          canonicalArtistNames(track)
        }
        for (name in names) {
          val key = normalizeKey(name)
          if (key.isEmpty()) continue
          val aggregate = aggregates.getOrPut(key) { Aggregate(name) }
          aggregate.trackCount += 1
          if (key == normalizeKey(primary)) aggregate.primaryCount += 1
          aggregate.albumKeys += row.identityKey
          val current = aggregate.artworkTrack
          if (track.artworkHash != null && (current == null || newerArtwork(track, current))) {
            aggregate.artworkTrack = track
          }
          track.artworkHash?.let(aggregate.artworkHashes::add)
          index += ArtistTrackIndexEntity(
            revision = revision,
            groupingMode = mode,
            artistKey = key,
            trackId = track.id,
            relationship = if (key == normalizeKey(primary)) "song" else "appearance",
          )
        }
      }
      result += aggregates.map { (key, aggregate) ->
        val art = aggregate.artworkTrack
        val artworkHashes = buildList {
          art?.artworkHash?.let(::add)
          for (hash in aggregate.artworkHashes) {
            if (hash !in this) add(hash)
            if (size == 4) break
          }
        }
        ArtistSummaryEntity(
          revision = revision,
          artistKey = key,
          artist = aggregate.name,
          groupingMode = mode,
          trackCount = aggregate.trackCount,
          primaryTrackCount = aggregate.primaryCount,
          albumCount = aggregate.albumKeys.size.toLong(),
          artworkHash = art?.artworkHash,
          sourceType = art?.sourceType,
          sourceId = art?.sourceId,
          artworkSourceId = art?.artworkSourceId,
          nameSortKey = SortKeys.forText(aggregate.name),
          sectionLabel = SortKeys.sectionLabel(aggregate.name),
          isCollaboration = aggregate.primaryCount == 0L,
          artworkHashesJson = JSONArray(artworkHashes).toString(),
        )
      }
    }
    return result to index
  }

  private fun buildDirectories(
    tracks: List<SettledTrack>,
    revision: Long,
    folders: Map<Long, FolderEntity>,
  ): List<DirectorySummaryEntity> {
    data class MutableDirectory(
      val nodeId: String,
      val folderId: Long,
      val parentNodeId: String?,
      val name: String,
      val depth: Int,
      val directoryPath: String,
      var documentUri: String? = null,
      var directTrackCount: Long = 0,
      var totalTrackCount: Long = 0,
    )

    fun decodedPath(uri: String, marker: String): String? = runCatching {
      val encoded = uri.substringAfter(marker)
      Uri.decode(encoded).substringAfter(':')
    }.getOrNull()

    val nodes = linkedMapOf<String, MutableDirectory>()
    for ((folderId, folder) in folders) {
      val rootPath = decodedPath(folder.treeUri, "/tree/") ?: folder.displayName
      val rootId = "folder:$folderId"
      nodes[rootId] = MutableDirectory(
        nodeId = rootId,
        folderId = folderId,
        parentNodeId = null,
        name = folder.displayName,
        depth = 0,
        directoryPath = rootPath,
      )
    }

    for (row in tracks.map(SettledTrack::track)) {
      val folderId = row.folderId ?: continue
      val parentUri = row.parentUri ?: continue
      val root = nodes["folder:$folderId"] ?: continue
      val parentPath = decodedPath(parentUri, "/document/") ?: continue
      val relative = when {
        parentPath == root.directoryPath -> ""
        parentPath.startsWith("${root.directoryPath}/") ->
          parentPath.removePrefix("${root.directoryPath}/")
        else -> ""
      }
      root.totalTrackCount += 1
      if (relative.isEmpty()) {
        root.directTrackCount += 1
        root.documentUri = parentUri
        continue
      }
      var parentId = root.nodeId
      var path = root.directoryPath
      for ((index, segment) in relative.split('/').filter(String::isNotBlank).withIndex()) {
        path = "$path/$segment"
        val nodeId = "folder:$folderId:${path.removePrefix("${root.directoryPath}/")}"
        val node = nodes.getOrPut(nodeId) {
          MutableDirectory(
            nodeId = nodeId,
            folderId = folderId,
            parentNodeId = parentId,
            name = segment,
            depth = index + 1,
            directoryPath = path,
          )
        }
        node.totalTrackCount += 1
        parentId = nodeId
        if (index == relative.split('/').filter(String::isNotBlank).lastIndex) {
          node.directTrackCount += 1
          node.documentUri = parentUri
        }
      }
    }

    return nodes.values
      .filter { it.totalTrackCount > 0 }
      .map {
        DirectorySummaryEntity(
          revision = revision,
          nodeId = it.nodeId,
          folderId = it.folderId,
          parentNodeId = it.parentNodeId,
          name = it.name,
          depth = it.depth,
          directoryPath = it.directoryPath,
          documentUri = it.documentUri,
          directTrackCount = it.directTrackCount,
          totalTrackCount = it.totalTrackCount,
          nameSortKey = SortKeys.forText(it.name),
        )
      }
  }

  private fun canonicalPrimary(track: TrackEntity): String {
    val albumArtist = normalizeDisplay(track.albumArtist.orEmpty())
    if (albumArtist.isNotEmpty()) {
      return splitAlbumArtists(albumArtist).firstOrNull() ?: albumArtist
    }
    return splitTrackArtists(track.artist).firstOrNull() ?: UNKNOWN_ARTIST
  }

  private fun canonicalArtistNames(track: TrackEntity): List<String> {
    val result = LinkedHashMap<String, String>()
    fun add(value: String) {
      val display = normalizeDisplay(value)
      val key = normalizeKey(display)
      if (key.isNotEmpty()) result.putIfAbsent(key, display)
    }
    add(canonicalPrimary(track))
    val trackArtists = splitTrackArtists(track.artist)
    trackArtists.forEach(::add)
    if (trackArtists.isEmpty()) splitAlbumArtists(track.albumArtist.orEmpty()).forEach(::add)
    return result.values.toList()
  }

  private fun splitTrackArtists(raw: String): List<String> =
    splitArtists(raw, splitAmpersand = true)

  private fun splitAlbumArtists(raw: String): List<String> =
    splitArtists(raw, splitAmpersand = false)

  private fun splitArtists(raw: String, splitAmpersand: Boolean): List<String> {
    var unified = normalizeDisplay(raw)
      .replace(Regex("\\s*;\\s*"), ",")
      .replace(Regex("\\s+[x×]\\s+", RegexOption.IGNORE_CASE), ",")
      .replace(Regex("\\s+(?:feat\\.?|ft\\.?|featuring|with)\\s+", RegexOption.IGNORE_CASE), ",")
    if (splitAmpersand) unified = unified.replace(Regex("\\s+&\\s+"), ",")
    val result = LinkedHashMap<String, String>()
    unified.split(',').forEach {
      val display = normalizeDisplay(it)
      val key = normalizeKey(display)
      if (key.isNotEmpty()) result.putIfAbsent(key, display)
    }
    return result.values.toList()
  }

  private fun newerArtwork(candidate: TrackEntity, current: TrackEntity): Boolean {
    val candidateYear = candidate.year ?: -1
    val currentYear = current.year ?: -1
    return candidateYear > currentYear ||
      (candidateYear == currentYear && (
        candidate.addedAt > current.addedAt ||
          (candidate.addedAt == current.addedAt && candidate.modifiedAt > current.modifiedAt)
        ))
  }

  private fun mostFrequent(values: List<String>, fallback: String): String =
    values.groupingBy(::normalizeKey).eachCount().entries
      .sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key })
      .firstOrNull()
      ?.key
      ?.let { key -> values.filter { normalizeKey(it) == key }.minByOrNull(SortKeys::forText) }
      ?: fallback

  private fun mostFrequentNullable(values: List<String?>): String? =
    values.filterNotNull().filter(String::isNotBlank).groupingBy { it }.eachCount().entries
      .sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key })
      .firstOrNull()?.key

  private fun normalizeDisplay(value: String): String =
    value.replace(Regex("\\s+"), " ").trim()

  private fun normalizeKey(value: String): String =
    normalizeDisplay(value).lowercase(Locale.ROOT)

  private fun normalizeAlbum(value: String): String =
    normalizeDisplay(value).ifEmpty { UNKNOWN_ALBUM }

  private fun primaryArtist(value: String): String =
    splitTrackArtists(value).firstOrNull() ?: UNKNOWN_ARTIST

  private fun identity(albumKey: String, discriminator: String): String =
    "album:$albumKey::$discriminator"
}
