package expo.modules.astralibraryscanner.data

import android.content.Context
import android.net.Uri
import android.util.Base64
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ArtistCreditMetadataReaderTest {
  private lateinit var fixture: File
  private lateinit var invalidFixture: File

  @Before
  fun writeFixtures() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    fixture = File(context.cacheDir, "repeated-artists.opus").apply {
      writeBytes(Base64.decode(OPUS_FIXTURE_BASE64, Base64.DEFAULT))
    }
    invalidFixture = File(context.cacheDir, "invalid-artists.opus").apply {
      writeBytes(byteArrayOf(0x00, 0x01, 0x02))
    }
  }

  @After
  fun removeFixtures() {
    fixture.delete()
    invalidFixture.delete()
  }

  @Test
  fun exoMetadataStackReturnsEveryRepeatedOpusCredit() {
    val context = ApplicationProvider.getApplicationContext<Context>()

    val credits = ArtistCreditMetadataReader.read(context, Uri.fromFile(fixture), 12_000)

    assertEquals(listOf("Earth, Wind & Fire", "The Emotions"), credits.artists)
    assertEquals(listOf("Curator One", "Curator Two"), credits.albumArtists)
  }

  @Test
  fun unreadableContainerFallsBackToEmptyCredits() {
    val context = ApplicationProvider.getApplicationContext<Context>()

    assertEquals(
      ArtistCreditNames(),
      ArtistCreditMetadataReader.read(context, Uri.fromFile(invalidFixture), 1_000),
    )
  }

  private companion object {
    // 80 ms of silent Opus audio with two ARTIST and two ALBUMARTIST comments.
    const val OPUS_FIXTURE_BASE64 =
      "T2dnUwACAAAAAAAAAACRB/HqAAAAANqihuMBE09wdXNIZWFkAQE4AYC7AAAAAABPZ2dTAAAAAAAAAAAAAJEH8eoBAAAArQRGQgGoT3B1c1RhZ3MNAAAAQXN0cmEgZml4dHVyZQUAAAAZAAAAQVJUSVNUPUVhcnRoLCBXaW5kICYgRmlyZRMAAABBUlRJU1Q9VGhlIEVtb3Rpb25zFwAAAEFMQlVNQVJUSVNUPUN1cmF0b3IgT25lFwAAAEFMQlVNQVJUSVNUPUN1cmF0b3IgVHdvHQAAAFRJVExFPVJlcGVhdGVkIEFydGlzdCBGaXh0dXJlT2dnUwAEOBAAAAAAAACRB/HqAgAAAGOKDDAFBwYGBgYIC+S5oLyECAfGsw7GCAfGsw7GCAfGsw7GCAfGsw7G"
  }
}
