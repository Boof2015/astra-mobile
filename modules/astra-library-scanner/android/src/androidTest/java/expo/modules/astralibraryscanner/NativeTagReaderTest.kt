package expo.modules.astralibraryscanner

import android.content.ContentProvider
import android.content.ContentValues
import android.content.res.AssetFileDescriptor
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.media.MediaMetadataRetriever
import android.os.Debug
import android.os.SystemClock
import android.util.Log
import expo.modules.astralibraryscanner.data.ArtistCreditMetadataReader
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import expo.modules.astralibraryscanner.data.ContainerTags
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

class MetadataFixtureProvider : ContentProvider() {
  override fun onCreate() = true
  override fun getType(uri: Uri) = "application/octet-stream"
  override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor =
    MatrixCursor(arrayOf(OpenableColumns.DISPLAY_NAME)).apply { addRow(arrayOf(uri.lastPathSegment)) }
  override fun insert(uri: Uri, values: ContentValues?): Uri? = null
  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0
  override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
    require(mode == "r")
    val context = requireNotNull(context)
    val name = requireNotNull(uri.lastPathSegment)
    if (uri.pathSegments.first() in listOf("pipe", "stall")) {
      val pipe = ParcelFileDescriptor.createPipe()
      thread(name = "metadata-fixture-provider") {
        runCatching {
          ParcelFileDescriptor.AutoCloseOutputStream(pipe[1]).use { output ->
            if (uri.pathSegments.first() == "stall") Thread.sleep(700)
            else context.assets.open("metadata/$name").use { it.copyTo(output) }
          }
        }
      }
      return pipe[0]
    }
    val file = File(context.cacheDir, "provider-$name")
    context.assets.open("metadata/$name").use { input -> file.outputStream().use { input.copyTo(it) } }
    return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
  }
  override fun openAssetFile(uri: Uri, mode: String): AssetFileDescriptor =
    AssetFileDescriptor(openFile(uri, mode), 0, AssetFileDescriptor.UNKNOWN_LENGTH)
}

@RunWith(AndroidJUnit4::class)
class NativeTagReaderTest {
  private val context get() = InstrumentationRegistry.getInstrumentation().context
  private fun fixture(name: String): File = File(context.cacheDir, "reader-$name").apply {
    context.assets.open("metadata/$name").use { input -> outputStream().use { input.copyTo(it) } }
  }
  private fun md5(bytes: ByteArray) = MessageDigest.getInstance("MD5").digest(bytes).joinToString("") { "%02x".format(it) }

  @Test fun readsCoreMetadataAcrossAllSupportedContainers() {
    val cases = JSONArray(context.assets.open("metadata/desktop.json").bufferedReader().use { it.readText() })
    val failures = mutableListOf<String>()
    val frontHash = context.assets.open("metadata/front.png").use { md5(it.readBytes()) }
    val backHash = context.assets.open("metadata/back.png").use { md5(it.readBytes()) }
    for (i in 0 until cases.length()) {
      val expected = cases.getJSONObject(i)
      val name = expected.getString("file")
      val file = fixture(name)
      try {
        val before = md5(file.readBytes())
        val data = NativeTagReader.read(context, Uri.fromFile(file), name)
        assertNotNull("TagLib opens $name", data)
        val tags = ContainerTags(data!!.properties).toMetadata()
        for (key in listOf("title", "artist", "album", "albumArtist", "genre", "year", "trackNumber", "trackTotal", "discNumber", "discTotal")) {
          if (expected.has(key) && !expected.isNull(key)) assertEquals("$name $key", expected.get(key), tags[key])
        }
        // ASF's desktop mapper reverses repeated custom ARTISTS values. Assert
        // complete membership there; retain the container reader's source order.
        val artists = expected.getJSONArray("artists").let { array -> (0 until array.length()).map(array::getString) }
        val parsed = tags["artistNames"] as List<*>
        if (artists.isNotEmpty()) {
          if (name.endsWith(".wma")) assertEquals(artists.toSet(), parsed.toSet())
          else assertEquals("$name artists", artists, parsed)
        }
        if (!expected.isNull("pictureMd5")) {
          assertNotNull("$name artwork", data.picture())
          // MP4 does not encode picture roles; preserve its first-image fallback.
          // For typed pictures verify the front bytes, even when desktop's
          // selectCover currently returns the first (back) image.
          assertEquals("$name artwork", if (name.endsWith(".m4a")) backHash else frontHash, md5(data.picture()!!))
        }
        assertEquals("$name remains read-only", before, md5(file.readBytes()))
      } catch (error: Throwable) { failures += "$name: ${error.message}" }
      finally { file.delete() }
    }
    assertTrue(failures.joinToString("\n"), failures.isEmpty())
  }

  @Test fun opusPicturesSpanPagesAndCreditsRetainBoundaries() {
    val file = fixture("tags.opus")
    try {
      val data = NativeTagReader.read(context, Uri.fromFile(file))!!
      assertTrue(data.picture()!!.size > 65536)
      assertEquals(listOf("Earth, Wind & Fire", "The Emotions"), ContainerTags(data.properties).toMetadata()["artistNames"])
      assertEquals(listOf("Curator One", "Curator Two"), ContainerTags(data.properties).toMetadata()["albumArtistNames"])
    } finally { file.delete() }
  }

  @Test fun alternateOpusAliasesAndRepeatedCreditsSurvive() {
    val file = fixture("aliases.opus")
    try {
      val tags = ContainerTags(NativeTagReader.read(context, Uri.fromFile(file))!!.properties).toMetadata()
      assertEquals(listOf("Earth, Wind & Fire", "The Emotions"), tags["artistNames"])
      assertEquals("Curator One & Curator Two", tags["albumArtist"])
      assertEquals(2, tags["trackNumber"])
      assertEquals(12, tags["trackTotal"])
      assertEquals(1, tags["discNumber"])
      assertEquals(2, tags["discTotal"])
    } finally { file.delete() }
  }

  @Test fun malformedFrontCoverFallsBackWithoutLosingText() {
    val file = fixture("malformed.opus")
    try {
      val data = NativeTagReader.read(context, Uri.fromFile(file))!!
      assertEquals("Fixture 日本語 🛰️", ContainerTags(data.properties).toMetadata()["title"])
      assertEquals(context.assets.open("metadata/back.png").use { md5(it.readBytes()) }, md5(data.picture()!!))
    } finally { file.delete() }
  }

  @Test fun missingTagsRetainAudioPropertiesAndUnreadableSourcesFailCleanly() {
    val file = fixture("untagged.opus")
    try {
      val data = NativeTagReader.read(context, Uri.fromFile(file))!!
      assertNull(ContainerTags(data.properties).toMetadata()["title"])
      assertNull(data.picture())
      assertEquals("audio/opus", data.codecMime)
      assertTrue(data.durationMs > 0)
    } finally { file.delete() }
    try {
      NativeTagReader.read(context, Uri.fromFile(File(context.cacheDir, "absent.opus")))
      fail("Unreadable sources must report a recoverable failure")
    } catch (_: IOException) { }
  }

  @Test fun safAndPipeProvidersReadTheSameMetadataAndCleanUp() {
    val before = context.cacheDir.listFiles().orEmpty().filter { it.name.startsWith("astra-tags-") }.toSet()
    val direct = NativeTagReader.read(context, Uri.parse("content://expo.modules.astralibraryscanner.test.metadata/file/tags.opus"))!!
    val pipe = NativeTagReader.read(context, Uri.parse("content://expo.modules.astralibraryscanner.test.metadata/pipe/tags.opus"))!!
    assertEquals(ContainerTags(direct.properties).toMetadata(), ContainerTags(pipe.properties).toMetadata())
    assertEquals(md5(direct.picture()!!), md5(pipe.picture()!!))
    assertEquals(before, context.cacheDir.listFiles().orEmpty().filter { it.name.startsWith("astra-tags-") }.toSet())
  }

  @Test fun stalledProviderHonorsCancellationAndDeadline() {
    val uri = Uri.parse("content://expo.modules.astralibraryscanner.test.metadata/stall/tags.opus")
    val cancelled = AtomicBoolean(false)
    val cancellation = thread { Thread.sleep(50); cancelled.set(true) }
    try {
      NativeTagReader.read(context, uri, cancelled = cancelled)
      fail("Cancellation must interrupt provider copying")
    } catch (expected: IOException) { assertTrue(expected.message.orEmpty().contains("cancelled")) }
    cancellation.join()
    try {
      NativeTagReader.read(context, uri, timeoutMs = 100)
      fail("Deadline must interrupt provider copying")
    } catch (expected: IOException) { assertTrue(expected.message.orEmpty().contains("timed out")) }
  }

  @Test fun metadataBatchPerformanceSmoke() {
    val names = context.assets.list("metadata").orEmpty().filter { it.startsWith("tags") }
    val files = names.map(::fixture)
    var nativeNanos = 0L
    var androidNanos = 0L
    var androidFailures = 0
    val pssBefore = Debug.getPss()
    try {
      for (file in files) {
        var started = SystemClock.elapsedRealtimeNanos()
        val parsed = NativeTagReader.read(context, Uri.fromFile(file))
        assertNotNull(file.name, parsed)
        ContainerTags(parsed!!.properties).toMetadata()
        parsed.picture()
        nativeNanos += SystemClock.elapsedRealtimeNanos() - started
        started = SystemClock.elapsedRealtimeNanos()
        val retriever = MediaMetadataRetriever()
        try {
          retriever.setDataSource(context, Uri.fromFile(file))
          for (key in listOf(MediaMetadataRetriever.METADATA_KEY_TITLE, MediaMetadataRetriever.METADATA_KEY_ARTIST,
            MediaMetadataRetriever.METADATA_KEY_ALBUM, MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST,
            MediaMetadataRetriever.METADATA_KEY_DURATION, MediaMetadataRetriever.METADATA_KEY_CD_TRACK_NUMBER)) {
            retriever.extractMetadata(key)
          }
          retriever.embeddedPicture
          ArtistCreditMetadataReader.read(context, Uri.fromFile(file), 1_000)
        } catch (_: Exception) { androidFailures += 1 }
        finally { retriever.release() }
        androidNanos += SystemClock.elapsedRealtimeNanos() - started
      }
      Log.i("AstraMetadataBenchmark", "files=${files.size} nativeMs=${nativeNanos / 1_000_000} androidAndExoMs=${androidNanos / 1_000_000} androidFailures=$androidFailures pssBeforeKb=$pssBefore pssAfterKb=${Debug.getPss()}")
    } finally { files.forEach(File::delete) }
  }

  @Test fun corruptFileDoesNotCrashTheReader() {
    val file = File(context.cacheDir, "corrupt.opus").apply { writeBytes(byteArrayOf(0, 1, 2)) }
    try { assertNull(NativeTagReader.read(context, Uri.fromFile(file))) }
    finally { file.delete() }
  }
}
