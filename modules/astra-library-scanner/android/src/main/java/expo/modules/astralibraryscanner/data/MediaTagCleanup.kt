package expo.modules.astralibraryscanner.data

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.Charset

/**
 * Repairs the narrow legacy-ID3 failure where Android exposed Shift-JIS or
 * EUC-JP bytes as Latin-1 code points. This is deliberately separate from
 * Room binding: correctly decoded Unicode is returned untouched.
 */
internal object MediaTagCleanup {
  private val cjk = Regex("[\\u3040-\\u30ff\\u3400-\\u9fff\\uac00-\\ud7af\\uf900-\\ufaff\\uff00-\\uffef]")

  fun clean(value: String?): String? {
    val trimmed = value?.trim()?.takeIf(String::isNotEmpty) ?: return null
    return repairLegacyJapaneseMojibake(trimmed)
  }

  private fun repairLegacyJapaneseMojibake(value: String): String {
    if (value.none { it.code >= 0x80 }) return value
    if (value.any { it.code > 0xff }) return value
    val bytes = ByteArray(value.length) { value[it].code.toByte() }
    val candidates = listOf("Shift_JIS", "EUC-JP").mapNotNull { charsetName ->
      runCatching {
        val charset = Charset.forName(charsetName)
        val decoder = charset.newDecoder()
          .onMalformedInput(CodingErrorAction.REPORT)
          .onUnmappableCharacter(CodingErrorAction.REPORT)
        val decoded = decoder.decode(ByteBuffer.wrap(bytes)).toString()
        val roundTrip = decoded.toByteArray(charset)
        decoded.takeIf { roundTrip.contentEquals(bytes) && cjk.containsMatchIn(decoded) }
      }.getOrNull()
    }
    return candidates.maxByOrNull { candidate ->
      cjk.findAll(candidate).count()
    } ?: value
  }
}
