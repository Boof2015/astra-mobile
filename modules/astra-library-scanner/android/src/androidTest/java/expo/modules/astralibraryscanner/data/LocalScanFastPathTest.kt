package expo.modules.astralibraryscanner.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.LargeTest
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith

@LargeTest
@RunWith(AndroidJUnit4::class)
class LocalScanFastPathTest {
  @Test
  fun unchangedIncrementalScanKeepsRevisionWhileChangesAndFullScansPublish() = runBlocking {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val repository = AstraLibraryRepository.get(context)
    val suffix = System.nanoTime().toString()
    val treeUri =
      "content://com.android.externalstorage.documents/tree/primary%3AMusic%2Fscan-$suffix"
    val parentUri =
      "$treeUri/document/primary%3AMusic%2Fscan-$suffix"
    val trackUri = "$parentUri%2Fsong.flac"
    val otherTrackUri = "$parentUri%2Fother.flac"
    val folder = repository.registerFolder(treeUri, "Fast scan test")
    val folderId = (folder.getValue("id") as Number).toLong()
    val extractionCount = AtomicInteger()
    val catalogEventCount = AtomicInteger()
    val catalogListener: (Long) -> Unit = { catalogEventCount.incrementAndGet() }
    var files = listOf(
      file(trackUri, parentUri, size = 1_024, mtime = 10),
      file(otherTrackUri, parentUri, size = 2_048, mtime = 20),
    )

    repository.addCatalogListener(catalogListener)
    try {
      val initial = repository.scanLocalFolder(
        folderId = folderId,
        full = false,
        discover = { files },
        extract = {
          extractionCount.incrementAndGet()
          metadata("Initial title")
        },
        onProgress = { _, _, _, _ -> },
      )
      assertEquals(2, initial.added)
      assertEquals(2, extractionCount.get())
      assertEquals(1, catalogEventCount.get())

      catalogEventCount.set(0)
      val unchanged = repository.scanLocalFolder(
        folderId = folderId,
        full = false,
        discover = { files.reversed() },
        extract = {
          extractionCount.incrementAndGet()
          metadata("Should not be extracted")
        },
        onProgress = { _, _, _, _ -> },
      )
      assertEquals(initial.revision, unchanged.revision)
      assertEquals(0, unchanged.added)
      assertEquals(0, unchanged.updated)
      assertEquals(0, unchanged.removed)
      assertEquals(2, unchanged.total)
      assertEquals(2, extractionCount.get())
      assertEquals(0, catalogEventCount.get())
      assertNotNull(repository.getTrack(trackUri))
      val readyFolder = repository.listFolders()
        .single { (it.getValue("id") as Number).toLong() == folderId }
      assertEquals("ready", readyFolder["scan_status"])
      assertNotNull(readyFolder["last_scanned_at"])

      files = files.map { discovered ->
        if (discovered.uri == trackUri) discovered.copy(lastModified = 11) else discovered
      }
      catalogEventCount.set(0)
      val changed = repository.scanLocalFolder(
        folderId = folderId,
        full = false,
        discover = { files },
        extract = {
          extractionCount.incrementAndGet()
          metadata("Changed title")
        },
        onProgress = { _, _, _, _ -> },
      )
      assertNotEquals(unchanged.revision, changed.revision)
      assertEquals(0, changed.added)
      assertEquals(1, changed.updated)
      assertEquals(3, extractionCount.get())
      assertEquals(1, catalogEventCount.get())

      catalogEventCount.set(0)
      val rebuilt = repository.scanLocalFolder(
        folderId = folderId,
        full = true,
        discover = { files },
        extract = {
          extractionCount.incrementAndGet()
          metadata("Rebuilt title")
        },
        onProgress = { _, _, _, _ -> },
      )
      assertNotEquals(changed.revision, rebuilt.revision)
      assertEquals(2, rebuilt.updated)
      assertEquals(5, extractionCount.get())
      assertEquals(1, catalogEventCount.get())
      assertEquals("Rebuilt title", repository.getTrack(trackUri)?.get("title"))
    } finally {
      repository.removeCatalogListener(catalogListener)
      repository.removeFolder(folderId)
    }
  }

  private fun file(
    uri: String,
    parentUri: String,
    size: Long?,
    mtime: Long,
  ): LocalAudioFile = LocalAudioFile(
    uri = uri,
    name = "song.flac",
    size = size,
    lastModified = mtime,
    mimeType = "audio/flac",
    parentUri = parentUri,
    coverUri = null,
  )

  private fun metadata(title: String): LocalAudioMetadata = LocalAudioMetadata(
    ok = true,
    title = title,
    artist = "Artist",
    album = "Album",
    mimeType = "audio/flac",
    durationMs = 180_000,
    sampleRate = 44_100,
    channels = 2,
    bitsPerSample = 16,
    codecMime = "audio/flac",
  )
}
