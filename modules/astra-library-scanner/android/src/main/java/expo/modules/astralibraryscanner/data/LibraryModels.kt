package expo.modules.astralibraryscanner.data

import android.icu.text.Collator
import android.util.Base64
import java.text.Normalizer
import java.util.Locale
import org.json.JSONObject
import org.json.JSONArray

const val COLLATION_VERSION = 2
const val DEFAULT_PAGE_SIZE = 100
const val MAX_PAGE_SIZE = 200

enum class LibraryStatus(val wireValue: String) {
  INITIALIZING("initializing"),
  EMPTY("empty"),
  READY("ready"),
  SCANNING("scanning"),
  REBUILDING("rebuilding"),
  DEGRADED("degraded"),
  FATAL_USER_DATA("fatalUserData"),
}

data class LibraryStatusSnapshot(
  val status: LibraryStatus,
  val catalogRevision: Long,
  val trackCount: Long,
  val message: String? = null,
  val recoveryNotice: String? = null,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "status" to status.wireValue,
    "catalogRevision" to catalogRevision.toString(),
    "trackCount" to trackCount.toDouble(),
    "message" to message,
    "recoveryNotice" to recoveryNotice,
  )
}

object SortKeys {
  private val collator = ThreadLocal.withInitial {
    Collator.getInstance(Locale.ROOT).apply {
      strength = Collator.SECONDARY
      decomposition = Collator.CANONICAL_DECOMPOSITION
    }
  }

  fun forText(value: String): String {
    val bytes = collator.get()!!.getCollationKey(value.trim()).toByteArray()
    val chars = CharArray(bytes.size * 2)
    val hex = "0123456789ABCDEF"
    for (index in bytes.indices) {
      val unsigned = bytes[index].toInt() and 0xff
      chars[index * 2] = hex[unsigned ushr 4]
      chars[index * 2 + 1] = hex[unsigned and 0x0f]
    }
    return String(chars)
  }

  fun sectionLabel(value: String): String {
    val normalized = Normalizer.normalize(value.trim(), Normalizer.Form.NFD)
    val first = normalized.firstOrNull() ?: return "#"
    val upper = first.uppercaseChar()
    return if (upper in 'A'..'Z') upper.toString() else "#"
  }
}

data class TrackPageCursor(
  val revision: Long,
  val kind: String,
  val text1: String? = null,
  val text2: String? = null,
  val text3: String? = null,
  val number1: Long? = null,
  val number2: Long? = null,
  val decimal1: Double? = null,
) {
  fun encode(): String {
    val json = JSONObject()
      .put("v", 1)
      .put("revision", revision)
      .put("kind", kind)
      .put("text1", text1)
      .put("text2", text2)
      .put("text3", text3)
      .put("number1", number1)
      .put("number2", number2)
      .put("decimal1", decimal1)
    return Base64.encodeToString(
      json.toString().toByteArray(Charsets.UTF_8),
      Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING,
    )
  }

  companion object {
    fun decode(raw: String?): TrackPageCursor? {
      if (raw.isNullOrBlank()) return null
      return runCatching {
        val json = JSONObject(
          String(
            Base64.decode(raw, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING),
            Charsets.UTF_8,
          ),
        )
        require(json.optInt("v") == 1)
        TrackPageCursor(
          revision = json.getLong("revision"),
          kind = json.getString("kind"),
          text1 = json.optNullableString("text1"),
          text2 = json.optNullableString("text2"),
          text3 = json.optNullableString("text3"),
          number1 = json.optNullableLong("number1"),
          number2 = json.optNullableLong("number2"),
          decimal1 = json.optNullableDouble("decimal1"),
        )
      }.getOrNull()
    }
  }
}

private fun JSONObject.optNullableString(key: String): String? =
  if (isNull(key) || !has(key)) null else getString(key)

private fun JSONObject.optNullableLong(key: String): Long? =
  if (isNull(key) || !has(key)) null else getLong(key)

private fun JSONObject.optNullableDouble(key: String): Double? =
  if (isNull(key) || !has(key)) null else getDouble(key)

fun ActiveTrackView.toBridgeMap(): Map<String, Any?> = mapOf(
  "id" to id.toDouble(),
  "path" to path,
  "folder_id" to folderId?.toDouble(),
  "title" to title,
  "artist" to artist,
  "album" to album,
  "album_artist" to albumArtist,
  "album_identity_key" to albumIdentityKey,
  "album_display_artist" to albumDisplayArtist,
  "duration" to duration,
  "track_number" to trackNumber,
  "disc_number" to discNumber,
  "year" to year,
  "genre" to genre,
  "artwork_hash" to artworkHash,
  "format" to format,
  "sample_rate" to sampleRate,
  "bit_depth" to bitDepth,
  "bitrate" to bitrate,
  "channels" to channels,
  "codec" to codec,
  "source_type" to sourceType,
  "source_id" to sourceId?.toDouble(),
  "source_track_id" to sourceTrackId,
  "source_path" to sourcePath,
  "artwork_source_id" to artworkSourceId,
  "file_name" to fileName,
  "size" to size?.toDouble(),
  "mtime" to mtime.toDouble(),
  "added_at" to addedAt.toDouble(),
  "modified_at" to modifiedAt.toDouble(),
  "loudness_lufs" to loudnessLufs,
  "sample_peak" to samplePeak,
  "replay_gain_track_db" to replayGainTrackDb,
  "replay_gain_album_db" to replayGainAlbumDb,
  "replay_gain_track_peak" to replayGainTrackPeak,
  "replay_gain_album_peak" to replayGainAlbumPeak,
  "rg_scanned" to if (replayGainScanned) 1 else 0,
  "play_count" to 0,
  "last_played_at" to null,
  "bpm" to bpm,
  "musical_key" to musicalKey,
)

fun AlbumSummaryEntity.toBridgeMap(): Map<String, Any?> = mapOf(
  "identity_key" to identityKey,
  "album" to album,
  "artist" to artist,
  "year" to year,
  "artwork_hash" to artworkHash,
  "source_type" to sourceType,
  "source_id" to sourceId?.toDouble(),
  "artwork_source_id" to artworkSourceId,
  "track_count" to trackCount.toDouble(),
  "total_duration" to totalDuration,
  "latest_added_at" to latestAddedAt.toDouble(),
)

fun ArtistSummaryEntity.toBridgeMap(): Map<String, Any?> = mapOf(
  "artist" to artist,
  "track_count" to trackCount.toDouble(),
  "primary_track_count" to primaryTrackCount.toDouble(),
  "album_count" to albumCount.toDouble(),
  "artwork_hash" to artworkHash,
  "source_type" to sourceType,
  "source_id" to sourceId?.toDouble(),
  "artwork_source_id" to artworkSourceId,
  "is_collaboration" to isCollaboration,
  "artwork_hashes" to runCatching {
    val array = JSONArray(artworkHashesJson)
    List(array.length()) { index -> array.getString(index) }
  }.getOrDefault(emptyList<String>()),
)

fun RemoteSourceEntity.toBridgeMap(): Map<String, Any?> = mapOf(
  "id" to id.toDouble(),
  "type" to type,
  "name" to name,
  "base_url" to baseUrl,
  "username" to username,
  "enabled" to if (enabled) 1 else 0,
  "last_status" to lastStatus,
  "last_error" to lastError,
  "last_sync_at" to lastSyncAt?.toDouble(),
  "last_checked_at" to lastCheckedAt?.toDouble(),
  "access_token" to null,
  "user_id" to null,
  "device_id" to null,
  "art_auth" to null,
  "created_at" to createdAt.toDouble(),
  "updated_at" to updatedAt.toDouble(),
)

fun PlaylistEntity.toBridgeMap(
  trackCount: Long,
  missingCount: Long,
  artworkHash: String?,
): Map<String, Any?> = mapOf(
  "id" to id.toDouble(),
  "name" to name,
  "kind" to kind,
  "created_at" to createdAt.toDouble(),
  "updated_at" to updatedAt.toDouble(),
  "last_played_at" to lastPlayedAt?.toDouble(),
  "auto_cover_hash" to artworkHash,
  "track_count" to trackCount.toDouble(),
  "missing_track_count" to missingCount.toDouble(),
  "remote_source_id" to remoteSourceId?.toDouble(),
)
