package expo.modules.astraaudioroute

/** One Android 14+ preferred-mixer option for a USB output, as plain values. */
internal data class MixerProfile(
  val sampleRate: Int,
  val encoding: String?,
  val channels: Int,
  val bitPerfect: Boolean,
)

/** Drops unspecified rates and repeats; ordered by rate so the readouts list ascending. */
internal fun mixerProfileMaps(profiles: List<MixerProfile>): List<Map<String, Any?>> =
  profiles
    .filter { it.sampleRate > 0 }
    .distinct()
    .sortedWith(compareBy<MixerProfile>({ it.sampleRate }, { it.channels }, { it.encoding ?: "" }, { it.bitPerfect }))
    .map {
      mapOf(
        "sampleRate" to it.sampleRate, "encoding" to it.encoding,
        "channels" to it.channels.takeIf { channels -> channels > 0 }, "bitPerfect" to it.bitPerfect,
      )
    }
