package expo.modules.astralibraryscanner.data

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import androidx.room.withTransaction
import expo.modules.astralibraryscanner.TvMusicStorage
import java.io.FileNotFoundException
import kotlin.math.roundToLong

internal fun ActiveTrackView.asFavorite(addedAt: Long) = FavoriteEntity(
  trackPath = path, addedAt = addedAt, title = title, artist = artist, album = album,
  durationMs = (duration * 1000).roundToLong(), fileSize = size, folderId = folderId.takeIf { sourceType == "local" },
)

private data class FileIdentity(
  val title: String, val artist: String, val album: String, val durationMs: Long, val size: Long,
)

private fun FavoriteEntity.identity() = fileIdentity(title, artist, album, durationMs, fileSize)

private fun fileIdentity(
  title: String?, artist: String?, album: String?, durationMs: Long?, fileSize: Long?,
): FileIdentity? {
  if (title.isNullOrBlank() || artist.isNullOrBlank() || album.isNullOrBlank() ||
    artist.equals("Unknown Artist", true) || album.equals("Unknown Album", true) ||
    durationMs == null || durationMs <= 0 || fileSize == null || fileSize <= 0) return null
  return FileIdentity(normalizeSyncPart(title), normalizeSyncPart(artist), normalizeSyncPart(album), durationMs, fileSize)
}

internal suspend fun CatalogDao.favoriteAt(path: String, addedAt: Long): FavoriteEntity {
  val row = getActiveTrack(path)?.asFavorite(addedAt) ?: return FavoriteEntity(path, addedAt)
  val key = row.identity() ?: return row
  if (row.folderId == null) return row
  val duplicate = getFavoriteCandidates(listOf(key.size), key.durationMs).any { it.trackPath != path && it.identity() == key }
  return row.copy(ambiguousMove = duplicate)
}

private suspend fun CatalogDao.favoriteTracks(rows: List<FavoriteEntity>) =
  rows.chunked(400).flatMap { getActiveTracks(it.map(FavoriteEntity::trackPath)) }.associateBy { it.path }

/** Old databases and snapshots have only paths. Enrich rows while their originals are still indexed. */
internal suspend fun backfillFavoriteMetadata(user: AstraUserDatabase, catalog: CatalogDao) = user.withTransaction {
  val dao = user.userDao()
  val rows = dao.getFavorites().filter { it.title == null }
  val tracks = catalog.favoriteTracks(rows)
  val updates = rows.mapNotNull { tracks[it.trackPath]?.asFavorite(it.addedAt) }
  val sizes = updates.filter { it.folderId != null }.mapNotNull { it.fileSize }.distinct()
  val copies = sizes.chunked(400).flatMap { catalog.getFavoriteCandidates(it) }
    .distinctBy { it.trackPath }.groupingBy { it.identity() }.eachCount()
  if (updates.isNotEmpty()) dao.putFavorites(updates.map { row ->
    val key = row.identity()
    row.copy(ambiguousMove = row.folderId != null && key != null && (copies[key] ?: 0) > 1)
  })
}

internal fun favoriteFolderAvailable(context: Context, tree: String): Boolean {
  if (TvMusicStorage.scope(tree) != null) return TvMusicStorage.available(context, tree)
  return runCatching {
    val uri = Uri.parse(tree)
    val root = DocumentsContract.buildDocumentUriUsingTree(uri, DocumentsContract.getTreeDocumentId(uri))
    context.contentResolver.query(root, arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID), null, null, null)
      ?.use { it.moveToFirst() } == true
  }.getOrDefault(false)
}

// Catalogs for two different folders may describe different instants during a move.
internal fun favoriteFileMayExist(context: Context, path: String): Boolean = try {
  context.contentResolver.query(Uri.parse(path), arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
    ?.use { it.moveToFirst() || it.extras.getBoolean(DocumentsContract.EXTRA_LOADING) } ?: true
} catch (_: FileNotFoundException) {
  false
} catch (_: RuntimeException) {
  true
}

/** Run only against a published catalog. No sync events or deletion markers are produced by a file move. */
internal suspend fun repairScannedFavorites(
  user: AstraUserDatabase, catalog: CatalogDao, scannedFolder: FolderEntity,
  discovered: Set<String>, previous: List<TrackEntity>, catalogChanged: Boolean,
  fileMayExist: (String) -> Boolean, folderAvailable: (String) -> Boolean,
): Boolean = user.withTransaction {
  val dao = user.userDao()
  val favorites = dao.getFavorites()
  val active = catalog.favoriteTracks(favorites)
  val savedByPath = favorites.associateBy { it.trackPath }
  val currentRows = favorites.map { row ->
    active[row.trackPath]?.asFavorite(row.addedAt)?.copy(
      ambiguousMove = row.ambiguousMove, syncAddedAt = row.syncAddedAt,
    ) ?: row
  }
  if (!catalogChanged && active.size == favorites.size && currentRows == favorites) return@withTransaction false
  val sizes = currentRows.mapNotNullTo(hashSetOf()) { if (it.folderId != null) it.fileSize else null }
  val candidates = sizes.chunked(400).flatMap { catalog.getFavoriteCandidates(it) }
    .distinctBy { it.trackPath }.groupBy { it.identity() }
  val existence = mutableMapOf<String, Boolean>()
  fun present(row: FavoriteEntity): Boolean {
    if (row.folderId == scannedFolder.id) return row.trackPath in discovered
    return existence.getOrPut(row.trackPath) { fileMayExist(row.trackPath) }
  }
  val missing = mutableMapOf<FileIdentity, MutableList<FavoriteEntity>>()
  for ((index, current) in currentRows.withIndex()) {
    val key = current.identity()
    if (current.trackPath in active) {
      val matches = if (key == null || current.folderId == null) emptyList() else candidates[key].orEmpty()
      val captured = current.copy(ambiguousMove = matches.size > 1 && matches.count(::present) > 1)
      if (captured != favorites[index]) dao.putFavorite(captured)
    } else if (current.folderId != null && key != null) {
      missing.getOrPut(key) { mutableListOf() }.add(current)
    }
  }
  if (missing.isEmpty()) return@withTransaction false

  // A copy that coexisted with the old file in this folder is evidence against a move.
  val missingSizes = missing.keys.mapTo(hashSetOf()) { it.size }
  val priorCopies = previous.filter { it.size in missingSizes }.groupBy {
    fileIdentity(it.title, it.artist, it.album, (it.duration * 1000).roundToLong(), it.size)
  }
  val folders = dao.getFolders().associate { it.id to it.treeUri }
  val availability = mutableMapOf<String, Boolean>()
  fun available(id: Long?, path: String): Boolean {
    if (id == scannedFolder.id && discovered.isNotEmpty()) return true
    val tree = folders[id] ?: path.substringBefore("/document/").takeIf { it != path } ?: return false
    return availability.getOrPut(tree) { folderAvailable(tree) }
  }

  val deletions = dao.getFavoriteTombstones().associate { it.syncKey to it.deletedAt }
  var moved = false
  for ((key, oldRows) in missing) {
    val matches = candidates[key].orEmpty()
    val old = oldRows.singleOrNull()
    val prior = priorCopies[key].orEmpty()
    if (old == null || matches.size > 1 || (prior.size > 1 && prior.any { it.path == old.trackPath })) {
      for (row in oldRows) if (!row.ambiguousMove) dao.putFavorite(row.copy(ambiguousMove = true))
      continue
    }
    val match = matches.singleOrNull() ?: continue
    if (old.ambiguousMove || old.trackPath in discovered ||
      !available(old.folderId, old.trackPath) || !available(match.folderId, match.trackPath)) continue
    if (old.folderId != scannedFolder.id && fileMayExist(old.trackPath)) continue
    if (!present(match)) continue
    dao.deleteFavorite(old.trackPath)
    val saved = savedByPath[match.trackPath]
    val syncDate = maxOf(old.syncAddedAt ?: old.addedAt, saved?.syncAddedAt ?: saved?.addedAt ?: old.addedAt)
    val deletedAt = deletions[syncKey(key.title, key.artist, key.album)]
    if (deletedAt == null || syncDate >= deletedAt) {
      dao.putFavorite(match.copy(addedAt = old.addedAt, syncAddedAt = syncDate.takeIf { it > old.addedAt }))
    }
    moved = true
  }
  moved
}
