package expo.modules.astraaudioroute

import java.security.MessageDigest

/** Prefer Android's media-attribute prediction, then retain the legacy fallback. */
internal fun <T> selectPredictedOutputDevice(
  predicted: List<T>,
  connected: List<T>,
  kindFor: (T) -> String,
): T? {
  predicted.firstOrNull()?.let { return it }
  if (connected.isEmpty()) return null
  return connected.firstOrNull { kindFor(it) == "bluetooth" }
    ?: connected.firstOrNull { kindFor(it) == "wired" }
    ?: connected.firstOrNull { kindFor(it) == "usb" }
    ?: connected.firstOrNull { kindFor(it) == "hdmi" }
    ?: connected.firstOrNull { kindFor(it) == "speaker" }
    ?: connected.first()
}

private fun slug(value: String): String =
  value
    .trim()
    .lowercase()
    .replace(Regex("[^a-z0-9]+"), "-")
    .trim('-')

private fun isGenericExternalLabel(kind: String, label: String): Boolean {
  val normalized = slug(label)
  if (normalized.isEmpty()) return true
  return when (kind) {
    "bluetooth" -> normalized in setOf("bluetooth", "bluetooth-audio", "headphones", "headset")
    "usb" -> normalized in setOf("usb", "usb-audio")
    "hdmi" -> normalized in setOf("hdmi", "hdmi-audio")
    else -> true
  }
}

private fun addressToken(address: String?): String? {
  val normalized = address?.trim()?.lowercase()?.ifEmpty { null } ?: return null
  return MessageDigest
    .getInstance("SHA-256")
    .digest(normalized.toByteArray(Charsets.UTF_8))
    .take(8)
    .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
}

/** Builds a stable local identity without exposing a raw hardware address to JS/storage. */
internal fun buildOutputRouteKey(kind: String, label: String, address: String?): String {
  if (kind == "speaker") return "speaker"
  if (kind == "wired") return "wired"
  if (kind !in setOf("bluetooth", "usb", "hdmi")) return "unknown"

  addressToken(address)?.let { return "$kind:id:$it" }
  if (!isGenericExternalLabel(kind, label)) return "$kind:name:${slug(label)}"
  return kind
}
