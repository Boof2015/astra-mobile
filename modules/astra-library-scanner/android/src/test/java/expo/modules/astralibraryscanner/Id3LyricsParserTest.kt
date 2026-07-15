package expo.modules.astralibraryscanner

import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class Id3LyricsParserTest {
  @Test
  fun `USLT decodes every ID3 text encoding`() {
    val samples = listOf(
      0 to "Café line",
      1 to "日本語の歌詞",
      2 to "Ελληνικοί στίχοι",
      3 to "한글 가사",
    )

    for ((encoding, expected) in samples) {
      val candidate = Id3LyricsParser.parse("USLT", uslt(encoding, expected))
      assertEquals(expected, (candidate as Id3LyricsCandidate.Plain).text)
    }
  }

  @Test
  fun `ULT alias decodes multiline plain lyrics`() {
    val candidate = Id3LyricsParser.parse("ULT", uslt(3, "First\r\nSecond"))

    assertEquals("First\nSecond", (candidate as Id3LyricsCandidate.Plain).text)
  }

  @Test
  fun `SYLT and SLT decode millisecond synchronized entries`() {
    for (frameId in listOf("SYLT", "SLT")) {
      val candidate = Id3LyricsParser.parse(
        frameId,
        sylt(
          encoding = 3,
          timestampFormat = 2,
          contentType = 1,
          entries = listOf(1_000L to "First", 2_500L to " Second"),
        )
      ) as Id3LyricsCandidate.Synced

      assertEquals(
        listOf(
          SyncedLyricText(1_000, "First"),
          SyncedLyricText(2_500, " Second"),
        ),
        candidate.entries,
      )
    }
  }

  @Test
  fun `SYLT accepts text transcription but rejects unrelated content`() {
    assertTrue(
      Id3LyricsParser.parse(
        "SYLT",
        sylt(0, 2, 2, listOf(500L to "Transcript")),
      ) is Id3LyricsCandidate.Synced
    )
    assertNull(
      Id3LyricsParser.parse(
        "SYLT",
        sylt(0, 2, 3, listOf(500L to "Movement")),
      )
    )
  }

  @Test
  fun `SYLT rejects MPEG-frame timestamps`() {
    assertNull(
      Id3LyricsParser.parse(
        "SYLT",
        sylt(3, 1, 1, listOf(42L to "Unsupported units")),
      )
    )
  }

  @Test
  fun `malformed and unsupported payloads fail closed`() {
    assertNull(Id3LyricsParser.parse("USLT", byteArrayOf(3, 'e'.code.toByte())))
    assertNull(Id3LyricsParser.parse("USLT", byteArrayOf(9, 'e'.code.toByte(), 'n'.code.toByte(), 'g'.code.toByte(), 0)))
    assertNull(Id3LyricsParser.parse("USLT", byteArrayOf(3, 'e'.code.toByte(), 'n'.code.toByte(), 'g'.code.toByte(), 0, 0xc3.toByte(), 0x28)))
    assertNull(Id3LyricsParser.parse("USLT", byteArrayOf(2, 'e'.code.toByte(), 'n'.code.toByte(), 'g'.code.toByte(), 0, 0, 0x41)))
    assertNull(Id3LyricsParser.parse("SYLT", sylt(3, 2, 1, listOf(1_000L to "Line")).dropLast(2).toByteArray()))
    assertNull(Id3LyricsParser.parse("COMM", uslt(3, "Not lyrics")))
  }

  @Test
  fun `collector prefers the most complete synchronized candidate`() {
    val collector = EmbeddedLyricsCollector()
    collector.considerPlain("A much longer plain lyric body that should not win")
    collector.consider(
      Id3LyricsCandidate.Synced(listOf(SyncedLyricText(1_000, "One")))
    )
    collector.consider(
      Id3LyricsCandidate.Synced(
        listOf(
          SyncedLyricText(1_000, "First "),
          SyncedLyricText(2_000, "second"),
        )
      )
    )

    val result = collector.valueOrNull()!!
    assertEquals("First second", result.text)
    assertEquals(2, result.syncText.size)
  }

  @Test
  fun `collector chooses the longest plain candidate when no sync exists`() {
    val collector = EmbeddedLyricsCollector()
    collector.considerPlain("Short")
    collector.considerPlain("The complete lyric body")

    val result = collector.valueOrNull()!!
    assertEquals("The complete lyric body", result.text)
    assertTrue(result.syncText.isEmpty())
  }

  private fun uslt(encoding: Int, text: String): ByteArray = ByteArrayOutputStream().use { output ->
    output.write(encoding)
    output.write("eng".toByteArray(StandardCharsets.ISO_8859_1))
    output.write(terminated(encoding, "description"))
    output.write(encoded(encoding, text))
    output.toByteArray()
  }

  private fun sylt(
    encoding: Int,
    timestampFormat: Int,
    contentType: Int,
    entries: List<Pair<Long, String>>,
  ): ByteArray = ByteArrayOutputStream().use { output ->
    output.write(encoding)
    output.write("eng".toByteArray(StandardCharsets.ISO_8859_1))
    output.write(timestampFormat)
    output.write(contentType)
    output.write(terminated(encoding, ""))
    for ((timestamp, text) in entries) {
      output.write(terminated(encoding, text))
      output.write(((timestamp ushr 24) and 0xff).toInt())
      output.write(((timestamp ushr 16) and 0xff).toInt())
      output.write(((timestamp ushr 8) and 0xff).toInt())
      output.write((timestamp and 0xff).toInt())
    }
    output.toByteArray()
  }

  private fun terminated(encoding: Int, text: String): ByteArray =
    encoded(encoding, text) + if (encoding == 1 || encoding == 2) byteArrayOf(0, 0) else byteArrayOf(0)

  private fun encoded(encoding: Int, text: String): ByteArray = when (encoding) {
    0 -> text.toByteArray(StandardCharsets.ISO_8859_1)
    1 -> byteArrayOf(0xff.toByte(), 0xfe.toByte()) + text.toByteArray(StandardCharsets.UTF_16LE)
    2 -> text.toByteArray(StandardCharsets.UTF_16BE)
    3 -> text.toByteArray(StandardCharsets.UTF_8)
    else -> text.toByteArray(StandardCharsets.UTF_8)
  }
}
