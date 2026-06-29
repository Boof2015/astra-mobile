package expo.modules.astracar

import android.os.Bundle
import android.util.Base64
import org.json.JSONObject

data class AstraCarMediaId(
  val kind: String,
  val section: String? = null,
  val key: String? = null,
  val id: Long? = null,
  val path: String? = null,
  val contextKind: String? = null,
  val contextSection: String? = null,
  val contextKey: String? = null,
  val contextId: Long? = null,
)

object AstraCarMediaIds {
  private const val PREFIX = "astra:"

  val root: String = encode(AstraCarMediaId(kind = "root"))

  fun section(section: String): String =
    encode(AstraCarMediaId(kind = "section", section = section))

  fun album(identityKey: String): String =
    encode(AstraCarMediaId(kind = "album", key = identityKey))

  fun artist(name: String): String =
    encode(AstraCarMediaId(kind = "artist", key = name))

  fun playlist(id: Long): String =
    encode(AstraCarMediaId(kind = "playlist", id = id))

  fun track(path: String, context: AstraCarMediaId): String =
    encode(
      AstraCarMediaId(
        kind = "track",
        path = path,
        contextKind = context.kind,
        contextSection = context.section,
        contextKey = context.key,
        contextId = context.id,
      ),
    )

  fun encode(media: AstraCarMediaId): String {
    val json = JSONObject()
      .put("kind", media.kind)
      .putIfPresent("section", media.section)
      .putIfPresent("key", media.key)
      .putIfPresent("id", media.id)
      .putIfPresent("path", media.path)
      .putIfPresent("contextKind", media.contextKind)
      .putIfPresent("contextSection", media.contextSection)
      .putIfPresent("contextKey", media.contextKey)
      .putIfPresent("contextId", media.contextId)
      .toString()
    val encoded = Base64.encodeToString(
      json.toByteArray(Charsets.UTF_8),
      Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING,
    )
    return "$PREFIX$encoded"
  }

  fun decode(mediaId: String?): AstraCarMediaId? {
    if (mediaId.isNullOrBlank() || !mediaId.startsWith(PREFIX)) return null
    return runCatching {
      val jsonText = String(
        Base64.decode(mediaId.removePrefix(PREFIX), Base64.URL_SAFE),
        Charsets.UTF_8,
      )
      val json = JSONObject(jsonText)
      AstraCarMediaId(
        kind = json.optString("kind"),
        section = json.optStringOrNull("section"),
        key = json.optStringOrNull("key"),
        id = json.optLongOrNull("id"),
        path = json.optStringOrNull("path"),
        contextKind = json.optStringOrNull("contextKind"),
        contextSection = json.optStringOrNull("contextSection"),
        contextKey = json.optStringOrNull("contextKey"),
        contextId = json.optLongOrNull("contextId"),
      )
    }.getOrNull()
  }

  fun toBundle(media: AstraCarMediaId): Bundle =
    Bundle().apply {
      putString("kind", media.kind)
      putNullableString("section", media.section)
      putNullableString("key", media.key)
      media.id?.let { putDouble("id", it.toDouble()) }
      putNullableString("path", media.path)
      putNullableString("contextKind", media.contextKind)
      putNullableString("contextSection", media.contextSection)
      putNullableString("contextKey", media.contextKey)
      media.contextId?.let { putDouble("contextId", it.toDouble()) }
    }

  private fun JSONObject.putIfPresent(key: String, value: String?): JSONObject {
    if (!value.isNullOrBlank()) put(key, value)
    return this
  }

  private fun JSONObject.putIfPresent(key: String, value: Long?): JSONObject {
    if (value != null) put(key, value)
    return this
  }

  private fun JSONObject.optStringOrNull(key: String): String? {
    if (!has(key) || isNull(key)) return null
    return optString(key).trim().takeIf { it.isNotEmpty() }
  }

  private fun JSONObject.optLongOrNull(key: String): Long? {
    if (!has(key) || isNull(key)) return null
    return optLong(key)
  }

  private fun Bundle.putNullableString(key: String, value: String?) {
    if (value != null) putString(key, value)
  }
}
