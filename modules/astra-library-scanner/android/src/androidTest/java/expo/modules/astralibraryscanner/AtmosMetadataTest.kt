package expo.modules.astralibraryscanner

import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AtmosMetadataTest {
  private fun int(value: Int) = ByteBuffer.allocate(4).putInt(value).array()
  private fun box(type: String, payload: ByteArray) = int(payload.size + 8) + type.toByteArray() + payload
  private fun config(substreams: List<ByteArray> = listOf(byteArrayOf(0, 0, 0)), extension: ByteArray = byteArrayOf(1, 16)): ByteArray =
    byteArrayOf(0x18, (substreams.size - 1).toByte()) + substreams.fold(byteArrayOf()) { a, b -> a + b } + extension

  /** Minimal metadata-only MP4: no copyrighted audio or decoder is needed. */
  private fun read(children: ByteArray, trailing: ByteArray = byteArrayOf(), codec: String = "ec-3"): NativeTagData {
    val audio = ByteBuffer.allocate(28).order(ByteOrder.BIG_ENDIAN).apply {
      putShort(6, 1) // data reference index
      putShort(16, 6) // channels
      putShort(18, 16) // sample size
      putInt(24, 48000 shl 16)
    }.array()
    val stsd = box("stsd", int(0) + int(1) + box(codec, audio + children) + trailing)
    val mdhd = box("mdhd", ByteBuffer.allocate(24).apply { putInt(12, 48000); putInt(16, 48000) }.array())
    val hdlr = box("hdlr", int(0) + int(0) + "soun".toByteArray() + ByteArray(12))
    val bytes = box("ftyp", "M4A ".toByteArray() + int(0) + "isom".toByteArray()) +
      box("moov", box("trak", box("mdia", hdlr + mdhd + box("minf", box("stbl", stsd)))))
    val context = InstrumentationRegistry.getInstrumentation().context
    val file = File.createTempFile("atmos-metadata-", ".m4a", context.cacheDir)
    return try {
      file.writeBytes(bytes)
      requireNotNull(NativeTagReader.read(context, Uri.fromFile(file), file.name))
    } finally { file.delete() }
  }

  @Test fun ec3ExtensionReachesJniWithoutDecodingAudio() {
    val data = read(box("dec3", config()))
    assertTrue(data.isAtmosJoc)
    assertEquals("audio/eac3-joc", data.codecMime)
    assertEquals(768000, data.bitrate)
    assertEquals(48000, data.sampleRate)
  }

  @Test fun skipsDependentSubstreamsAndUnrelatedBoxes() {
    val substreams = listOf(byteArrayOf(0, 0, 2, 0), byteArrayOf(0, 0, 0))
    assertTrue(read(box("free", byteArrayOf(0, 0)) + box("dec3", config(substreams))).isAtmosJoc)
    // Reserved extension bits are ignored; only bit zero signals Atmos.
    assertTrue(read(box("dec3", config(extension = byteArrayOf(0x81.toByte(), 16)))).isAtmosJoc)
  }

  @Test fun genericEc3AndMalformedExtensionsDoNotQualify() {
    val cases = listOf(
      byteArrayOf(),
      box("dec3", config(extension = byteArrayOf())),
      box("dec3", config(extension = byteArrayOf(0, 16))),
      box("dec3", config(extension = byteArrayOf(1))),
      box("dec3", byteArrayOf(0x18, 0, 0)),
      box("dec3", byteArrayOf(0x18, 7, 0, 0, 0, 1, 16)),
      box("free", box("dec3", config())), // Embedded fourcc is not a box.
      int(1000) + "dec3".toByteArray() + config(),
      int(4) + "dec3".toByteArray() + config(),
    )
    cases.forEachIndexed { index, bytes ->
      val data = read(bytes)
      assertFalse("case $index", data.isAtmosJoc)
      assertEquals("case $index", "audio/eac3", data.codecMime)
    }
    assertFalse(read(byteArrayOf(), trailing = box("dec3", config())).isAtmosJoc)
    assertFalse(read(box("dec3", config()), codec = "ac-3").isAtmosJoc)
  }

  @Test fun extendedBoxSizesAreBounded() {
    val payload = config()
    val extended = int(1) + "dec3".toByteArray() + int(0) + int(16 + payload.size) + payload
    assertTrue(read(extended).isAtmosJoc)
    assertFalse(read(int(1) + "dec3".toByteArray() + int(1) + int(16) + payload).isAtmosJoc)
  }
}
