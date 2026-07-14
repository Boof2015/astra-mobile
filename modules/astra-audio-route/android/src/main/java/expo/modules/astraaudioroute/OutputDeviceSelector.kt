package expo.modules.astraaudioroute

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
