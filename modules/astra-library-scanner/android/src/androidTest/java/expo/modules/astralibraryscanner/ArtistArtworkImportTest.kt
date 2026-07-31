package expo.modules.astralibraryscanner

import android.content.Context
import android.graphics.Bitmap
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ArtistArtworkImportTest {
  private lateinit var root: File
  private lateinit var artwork: File
  private lateinit var thumbnails: File
  private lateinit var cache: ImportedArtworkCache

  @Before
  fun setUp() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    root = File(context.cacheDir, "artist-artwork-import-test").apply {
      deleteRecursively()
      mkdirs()
    }
    artwork = File(root, "artwork")
    thumbnails = File(root, "thumbnails")
    cache = ImportedArtworkCache(artwork, thumbnails)
  }

  @After
  fun cleanUp() {
    root.deleteRecursively()
  }

  @Test
  fun supportedImagesAreContentAddressedReusedAndThumbnailed() {
    val formats = listOf(
      Bitmap.CompressFormat.JPEG to ".jpg",
      Bitmap.CompressFormat.PNG to ".png",
      Bitmap.CompressFormat.WEBP_LOSSLESS to ".webp",
    )
    for ((format, extension) in formats) {
      val bytes = imageBytes(format)
      val first = cache.cache(bytes)
      val modifiedAt = File(artwork, first).lastModified()
      val second = cache.cache(bytes)

      assertEquals(first, second)
      assertTrue(first.endsWith(extension))
      assertTrue(File(artwork, first).isFile)
      assertEquals(modifiedAt, File(artwork, second).lastModified())
      assertTrue(File(thumbnails, "${first.substringBeforeLast('.')}.jpg").isFile)
    }
  }

  @Test
  fun emptyCorruptAndOversizedInputsAreRejectedWithoutPublishingFiles() {
    assertFails { cache.cache(byteArrayOf()) }
    assertFails { cache.cache("not an image".toByteArray()) }
    assertFails {
      readImportedArtworkBytes(
        ByteArrayInputStream(ByteArray(33)),
        maximumBytes = 32,
      )
    }
    assertTrue(artwork.listFiles().isNullOrEmpty())
    assertTrue(thumbnails.listFiles().isNullOrEmpty())
  }

  private fun imageBytes(format: Bitmap.CompressFormat): ByteArray {
    val bitmap = Bitmap.createBitmap(320, 200, Bitmap.Config.ARGB_8888)
    return try {
      ByteArrayOutputStream().use { output ->
        assertTrue(bitmap.compress(format, 90, output))
        output.toByteArray()
      }
    } finally {
      bitmap.recycle()
    }
  }

  private fun assertFails(block: () -> Unit) {
    try {
      block()
      fail("Expected image import to fail")
    } catch (_: IllegalArgumentException) {
      // Expected validation failure.
    } catch (_: IllegalStateException) {
      // Expected validation failure.
    }
  }
}
