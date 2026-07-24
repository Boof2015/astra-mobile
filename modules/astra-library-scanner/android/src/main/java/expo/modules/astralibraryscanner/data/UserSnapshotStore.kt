package expo.modules.astralibraryscanner.data

import android.content.Context
import androidx.room.withTransaction
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject

private const val SNAPSHOT_SCHEMA_VERSION = 1

/**
 * Rotating, checksummed snapshots are deliberately independent of SQLite. They
 * are small enough to restore user-created state even if the Room file and its
 * WAL are unreadable. Rebuildable catalog data and secrets are never included.
 */
class UserSnapshotStore(
  context: Context,
) {
  private val directory = File(context.filesDir, "astra-user-snapshots")
  private val files = listOf(
    File(directory, "user-a.json"),
    File(directory, "user-b.json"),
  )

  suspend fun write(database: AstraUserDatabase) {
    val payload = database.withTransaction {
      val dao = database.userDao()
      val json = JSONObject()
      json.put("settings", dao.snapshotSettings().toJsonArray { it.toJson() })
      json.put("folders", dao.getFolders().toJsonArray { it.toJson() })
      json.put("playlists", dao.getPlaylists().toJsonArray { it.toJson() })
      json.put("playlistTracks", dao.snapshotPlaylistTracks().toJsonArray { it.toJson() })
      json.put("favorites", dao.getFavorites().toJsonArray { it.toJson() })
      json.put("playbackHistory", dao.getPlaybackHistory().toJsonArray { it.toJson() })
      json.put("remoteSources", dao.getRemoteSources().toJsonArray { it.toJson() })
      json.put("favoriteTombstones", dao.getFavoriteTombstones().toJsonArray { it.toJson() })
      json.put("pendingFavorites", dao.getPendingFavorites().toJsonArray { it.toJson() })
      json.put("playlistTombstones", dao.getPlaylistTombstones().toJsonArray { it.toJson() })
      json.put("playlistSyncStates", dao.getPlaylistSyncStates().toJsonArray { it.toJson() })
      val sessions = dao.getPlaybackSessions()
      json.put("playbackSessions", sessions.toJsonArray { it.toJson() })
      json.put(
        "playbackQueues",
        sessions
          .flatMap { dao.getAllQueueEntries(it.id) }
          .toJsonArray { it.toJson() },
      )
      json.put(
        "playbackOriginalQueues",
        sessions
          .flatMap { dao.getOriginalQueueEntries(it.id) }
          .toJsonArray { it.toJson() },
      )
      json
    }

    val payloadString = payload.toString()
    val envelope = JSONObject()
      .put("schemaVersion", SNAPSHOT_SCHEMA_VERSION)
      .put("createdAt", System.currentTimeMillis())
      .put("checksum", sha256(payloadString))
      .put("payload", payloadString)

    directory.mkdirs()
    val target = files.minByOrNull { if (it.exists()) it.lastModified() else Long.MIN_VALUE } ?: files.first()
    val temporary = File(directory, "${target.name}.tmp")
    FileOutputStream(temporary).use { output ->
      output.write(envelope.toString().toByteArray(Charsets.UTF_8))
      output.fd.sync()
    }
    if (target.exists() && !target.delete()) {
      temporary.delete()
      error("Could not rotate Astra user snapshot")
    }
    if (!temporary.renameTo(target)) {
      temporary.delete()
      error("Could not publish Astra user snapshot")
    }
  }

  fun newestValid(): UserSnapshot? =
    files
      .filter(File::isFile)
      .sortedByDescending(File::lastModified)
      .firstNotNullOfOrNull { readValid(it) }

  suspend fun restore(database: AstraUserDatabase, snapshot: UserSnapshot) {
    val payload = snapshot.payload
    database.clearAllTables()
    database.withTransaction {
      val dao = database.userDao()
      dao.putSettings(payload.array("settings").mapObjects(::settingFromJson))
      dao.putFolders(payload.array("folders").mapObjects(::folderFromJson))
      dao.putPlaylists(payload.array("playlists").mapObjects(::playlistFromJson))
      dao.putPlaylistTracks(payload.array("playlistTracks").mapObjects(::playlistTrackFromJson))
      dao.putFavorites(payload.array("favorites").mapObjects(::favoriteFromJson))
      dao.putPlaybackHistories(payload.array("playbackHistory").mapObjects(::historyFromJson))
      dao.putRemoteSources(payload.array("remoteSources").mapObjects(::remoteSourceFromJson))
      dao.putFavoriteTombstones(payload.array("favoriteTombstones").mapObjects(::favoriteTombstoneFromJson))
      dao.putPendingFavorites(payload.array("pendingFavorites").mapObjects(::pendingFavoriteFromJson))
      dao.putPlaylistTombstones(payload.array("playlistTombstones").mapObjects(::playlistTombstoneFromJson))
      dao.putPlaylistSyncStates(payload.array("playlistSyncStates").mapObjects(::playlistSyncStateFromJson))
      val sessions = payload.array("playbackSessions").mapObjects(::playbackSessionFromJson)
      if (sessions.isNotEmpty()) {
        sessions.forEach { dao.putPlaybackSession(it) }
      } else {
        // Backwards-compatible with the first Room snapshot format.
        payload.optJSONObject("playbackSession")?.let {
          dao.putPlaybackSession(playbackSessionFromJson(it))
        }
      }
      dao.putQueueEntries(payload.array("playbackQueues").mapObjects(::playbackQueueFromJson))
      dao.putOriginalQueueEntries(
        payload.array("playbackOriginalQueues").mapObjects(::playbackOriginalQueueFromJson),
      )
      dao.putSnapshotMetadata(SnapshotMetadataEntity(lastSnapshotAt = snapshot.createdAt))
    }
  }

  private fun readValid(file: File): UserSnapshot? = runCatching {
    val envelope = JSONObject(file.readText())
    require(envelope.getInt("schemaVersion") == SNAPSHOT_SCHEMA_VERSION)
    val payloadString = envelope.getString("payload")
    val expected = envelope.getString("checksum")
    require(MessageDigest.isEqual(expected.toByteArray(), sha256(payloadString).toByteArray()))
    UserSnapshot(
      createdAt = envelope.getLong("createdAt"),
      payload = JSONObject(payloadString),
    )
  }.getOrNull()
}

data class UserSnapshot(
  val createdAt: Long,
  val payload: JSONObject,
)

private fun sha256(value: String): String =
  MessageDigest.getInstance("SHA-256")
    .digest(value.toByteArray(Charsets.UTF_8))
    .joinToString("") { "%02x".format(it) }

private fun <T> List<T>.toJsonArray(transform: (T) -> JSONObject): JSONArray =
  JSONArray().also { array -> forEach { array.put(transform(it)) } }

private fun JSONObject.array(key: String): JSONArray = optJSONArray(key) ?: JSONArray()

private fun <T> JSONArray.mapObjects(transform: (JSONObject) -> T): List<T> =
  buildList(length()) {
    for (index in 0 until length()) add(transform(getJSONObject(index)))
  }

private fun JSONObject.putNullable(key: String, value: Any?): JSONObject =
  put(key, value ?: JSONObject.NULL)

private fun JSONObject.nullableString(key: String): String? =
  if (!has(key) || isNull(key)) null else getString(key)

private fun JSONObject.nullableLong(key: String): Long? =
  if (!has(key) || isNull(key)) null else getLong(key)

private fun SettingEntity.toJson() = JSONObject()
  .put("key", key)
  .put("value", value)

private fun settingFromJson(json: JSONObject) = SettingEntity(
  key = json.getString("key"),
  value = json.getString("value"),
)

private fun FolderEntity.toJson() = JSONObject()
  .put("id", id)
  .put("treeUri", treeUri)
  .put("displayName", displayName)
  .put("addedAt", addedAt)
  .putNullable("lastScannedAt", lastScannedAt)
  .put("lastScanStatus", lastScanStatus)
  .putNullable("lastScanError", lastScanError)

private fun folderFromJson(json: JSONObject) = FolderEntity(
  id = json.getLong("id"),
  treeUri = json.getString("treeUri"),
  displayName = json.getString("displayName"),
  addedAt = json.getLong("addedAt"),
  lastScannedAt = json.nullableLong("lastScannedAt"),
  lastScanStatus = json.getString("lastScanStatus"),
  lastScanError = json.nullableString("lastScanError"),
)

private fun PlaylistEntity.toJson() = JSONObject()
  .put("id", id)
  .put("name", name)
  .put("createdAt", createdAt)
  .put("updatedAt", updatedAt)
  .putNullable("lastPlayedAt", lastPlayedAt)
  .put("kind", kind)
  .putNullable("dynamicRulesJson", dynamicRulesJson)
  .putNullable("remoteSourceId", remoteSourceId)
  .putNullable("remotePlaylistId", remotePlaylistId)
  .putNullable("syncUid", syncUid)

private fun playlistFromJson(json: JSONObject) = PlaylistEntity(
  id = json.getLong("id"),
  name = json.getString("name"),
  createdAt = json.getLong("createdAt"),
  updatedAt = json.getLong("updatedAt"),
  lastPlayedAt = json.nullableLong("lastPlayedAt"),
  kind = json.getString("kind"),
  dynamicRulesJson = json.nullableString("dynamicRulesJson"),
  remoteSourceId = json.nullableLong("remoteSourceId"),
  remotePlaylistId = json.nullableString("remotePlaylistId"),
  syncUid = json.nullableString("syncUid"),
)

private fun PlaylistTrackEntity.toJson() = JSONObject()
  .put("id", id)
  .put("playlistId", playlistId)
  .put("trackPath", trackPath)
  .put("position", position)
  .put("addedAt", addedAt)
  .putNullable("fallbackTitle", fallbackTitle)
  .putNullable("fallbackArtist", fallbackArtist)
  .putNullable("fallbackAlbum", fallbackAlbum)

private fun playlistTrackFromJson(json: JSONObject) = PlaylistTrackEntity(
  id = json.getLong("id"),
  playlistId = json.getLong("playlistId"),
  trackPath = json.getString("trackPath"),
  position = json.getInt("position"),
  addedAt = json.getLong("addedAt"),
  fallbackTitle = json.nullableString("fallbackTitle"),
  fallbackArtist = json.nullableString("fallbackArtist"),
  fallbackAlbum = json.nullableString("fallbackAlbum"),
)

private fun FavoriteEntity.toJson() = JSONObject()
  .put("trackPath", trackPath)
  .put("addedAt", addedAt)

private fun favoriteFromJson(json: JSONObject) = FavoriteEntity(
  trackPath = json.getString("trackPath"),
  addedAt = json.getLong("addedAt"),
)

private fun PlaybackHistoryEntity.toJson() = JSONObject()
  .put("trackPath", trackPath)
  .put("lastPlayedAt", lastPlayedAt)
  .put("playCount", playCount)

private fun historyFromJson(json: JSONObject) = PlaybackHistoryEntity(
  trackPath = json.getString("trackPath"),
  lastPlayedAt = json.getLong("lastPlayedAt"),
  playCount = json.getLong("playCount"),
)

private fun RemoteSourceEntity.toJson() = JSONObject()
  .put("id", id)
  .put("type", type)
  .put("name", name)
  .put("baseUrl", baseUrl)
  .put("username", username)
  .put("enabled", enabled)
  .put("lastStatus", lastStatus)
  .putNullable("lastError", lastError)
  .putNullable("lastSyncAt", lastSyncAt)
  .putNullable("lastCheckedAt", lastCheckedAt)
  .put("createdAt", createdAt)
  .put("updatedAt", updatedAt)

private fun remoteSourceFromJson(json: JSONObject) = RemoteSourceEntity(
  id = json.getLong("id"),
  type = json.getString("type"),
  name = json.getString("name"),
  baseUrl = json.getString("baseUrl"),
  username = json.getString("username"),
  enabled = json.getBoolean("enabled"),
  lastStatus = json.getString("lastStatus"),
  lastError = json.nullableString("lastError"),
  lastSyncAt = json.nullableLong("lastSyncAt"),
  lastCheckedAt = json.nullableLong("lastCheckedAt"),
  createdAt = json.getLong("createdAt"),
  updatedAt = json.getLong("updatedAt"),
)

private fun FavoriteTombstoneEntity.toJson() = JSONObject()
  .put("syncKey", syncKey)
  .put("deletedAt", deletedAt)

private fun favoriteTombstoneFromJson(json: JSONObject) = FavoriteTombstoneEntity(
  syncKey = json.getString("syncKey"),
  deletedAt = json.getLong("deletedAt"),
)

private fun PendingFavoriteEntity.toJson() = JSONObject()
  .put("syncKey", syncKey)
  .put("title", title)
  .put("artist", artist)
  .put("album", album)
  .put("addedAt", addedAt)

private fun pendingFavoriteFromJson(json: JSONObject) = PendingFavoriteEntity(
  syncKey = json.getString("syncKey"),
  title = json.getString("title"),
  artist = json.getString("artist"),
  album = json.getString("album"),
  addedAt = json.getLong("addedAt"),
)

private fun PlaylistTombstoneEntity.toJson() = JSONObject()
  .put("syncUid", syncUid)
  .put("deletedAt", deletedAt)

private fun playlistTombstoneFromJson(json: JSONObject) = PlaylistTombstoneEntity(
  syncUid = json.getString("syncUid"),
  deletedAt = json.getLong("deletedAt"),
)

private fun PlaylistSyncStateEntity.toJson() = JSONObject()
  .put("syncUid", syncUid)
  .put("localUpdatedAt", localUpdatedAt)
  .put("remoteUpdatedAt", remoteUpdatedAt)

private fun playlistSyncStateFromJson(json: JSONObject) = PlaylistSyncStateEntity(
  syncUid = json.getString("syncUid"),
  localUpdatedAt = json.getLong("localUpdatedAt"),
  remoteUpdatedAt = json.getLong("remoteUpdatedAt"),
)

private fun PlaybackSessionEntity.toJson() = JSONObject()
  .put("id", id)
  .put("contextJson", contextJson)
  .putNullable("anchorPath", anchorPath)
  .putNullable("shuffleSeed", shuffleSeed)
  .put("activePosition", activePosition)
  .put("createdAt", createdAt)
  .put("updatedAt", updatedAt)

private fun playbackSessionFromJson(json: JSONObject) = PlaybackSessionEntity(
  id = json.getString("id"),
  contextJson = json.getString("contextJson"),
  anchorPath = json.nullableString("anchorPath"),
  shuffleSeed = json.nullableLong("shuffleSeed"),
  activePosition = json.getLong("activePosition"),
  createdAt = json.getLong("createdAt"),
  updatedAt = json.getLong("updatedAt"),
)

private fun PlaybackQueueEntryEntity.toJson() = JSONObject()
  .put("sessionId", sessionId)
  .put("position", position)
  .put("trackPath", trackPath)

private fun playbackQueueFromJson(json: JSONObject) = PlaybackQueueEntryEntity(
  sessionId = json.getString("sessionId"),
  position = json.getLong("position"),
  trackPath = json.getString("trackPath"),
)

private fun PlaybackOriginalQueueEntryEntity.toJson() = JSONObject()
  .put("sessionId", sessionId)
  .put("position", position)
  .put("trackPath", trackPath)

private fun playbackOriginalQueueFromJson(json: JSONObject) = PlaybackOriginalQueueEntryEntity(
  sessionId = json.getString("sessionId"),
  position = json.getLong("position"),
  trackPath = json.getString("trackPath"),
)
