package expo.modules.astralibraryscanner

/** A later extractor can identify JOC even after TagLib supplied generic E-AC-3. */
internal fun MutableMap<String, Any?>.mergeAudioCodecMetadata(
  mime: String?,
  isAtmosJoc: Boolean = false,
) {
  if (this["codecMime"] == null && mime != null) this["codecMime"] = mime
  if (isAtmosJoc || mime.equals("audio/eac3-joc", ignoreCase = true)) {
    this["codecMime"] = "audio/eac3-joc"
    this["codecProfile"] = "JOC"
    this["isAtmosJoc"] = true
  }
}
