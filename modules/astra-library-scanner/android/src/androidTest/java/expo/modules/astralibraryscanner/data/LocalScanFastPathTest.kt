package expo.modules.astralibraryscanner.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.LargeTest
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith

@LargeTest
@RunWith(AndroidJUnit4::class)
class LocalScanFastPathTest {
  @Test
  fun fullScanFlushesOrderedWindowsAndRetainsCatalogOnCancellationOrFailure() = runBlocking {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val repository = AstraLibraryRepository.get(context)
    val suffix = System.nanoTime().toString()
    val treeUri =
      "content://com.android.externalstorage.documents/tree/primary%3AMusic%2Fpipeline-$suffix"
    val parentUri =
      "$treeUri/document/primary%3AMusic%2Fpipeline-$suffix"
    val files = (0 until 101).map { index ->
      file(
        uri = "$parentUri%2Ftrack-${index.toString().padStart(3, '0')}.flac",
        parentUri = parentUri,
        size = 1_024L + index,
        mtime = 100L + index,
      )
    }
    val folder = repository.registerFolder(treeUri, "Pipeline scan test")
    val folderId = (folder.getValue("id") as Number).toLong()

    try {
      val firstProgress = mutableListOf<Int>()
      val first = repository.scanLocalFolder(
        folderId = folderId,
        full = true,
        discover = { files },
        extract = { discovered -> metadata(discovered.name) },
        onProgress = { phase, processed, _, _ ->
          if (phase == "extracting") firstProgress += processed
        },
      )
      assertEquals(101, first.added)
      assertEquals(0, first.updated)
      assertEquals(0, first.removed)
      assertEquals(101, first.total)
      assertEquals(listOf(96, 101), firstProgress)
      assertTrue(firstProgress.zipWithNext().all { (before, after) -> before < after })
      val firstTitles = files.map { discovered ->
        repository.getTrack(discovered.uri)?.get("title")
      }
      assertEquals(files.map(LocalAudioFile::name), firstTitles)

      val secondProgress = mutableListOf<Int>()
      val second = repository.scanLocalFolder(
        folderId = folderId,
        full = true,
        discover = { files },
        extract = { discovered -> metadata(discovered.name) },
        onProgress = { phase, processed, _, _ ->
          if (phase == "extracting") secondProgress += processed
        },
      )
      assertNotEquals(first.revision, second.revision)
      assertEquals(0, second.added)
      assertEquals(101, second.updated)
      assertEquals(0, second.removed)
      assertEquals(listOf(96, 101), secondProgress)
      assertEquals(
        firstTitles,
        files.map { discovered -> repository.getTrack(discovered.uri)?.get("title") },
      )

      val cancelFlag = AtomicBoolean(false)
      val extractionCount = AtomicInteger()
      val cancelled = repository.scanLocalFolder(
        folderId = folderId,
        full = true,
        discover = { files },
        extract = { discovered ->
          if (extractionCount.incrementAndGet() == 3) cancelFlag.set(true)
          metadata("Cancelled ${discovered.name}")
        },
        onProgress = { _, _, _, _ -> },
        isCancelled = cancelFlag::get,
      )
      assertTrue(cancelled.cancelled)
      assertEquals(second.revision, cancelled.revision)
      assertEquals(second.revision, repository.status().catalogRevision)
      assertEquals(firstTitles[0], repository.getTrack(files[0].uri)?.get("title"))

      try {
        repository.scanLocalFolder(
          folderId = folderId,
          full = true,
          discover = { files },
          extract = { discovered ->
            if (discovered == files[3]) error("parser failure")
            metadata("Failed ${discovered.name}")
          },
          onProgress = { _, _, _, _ -> },
        )
        fail("Expected parser failure")
      } catch (error: IllegalStateException) {
        assertEquals("parser failure", error.message)
      }
      assertEquals(second.revision, repository.status().catalogRevision)
      assertEquals(firstTitles[0], repository.getTrack(files[0].uri)?.get("title"))
      assertFalse(repository.getTrack(files.last().uri).isNullOrEmpty())
    } finally {
      repository.removeFolder(folderId)
    }
  }

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

  @Test
  fun staleMetadataRetriesWithoutDroppingUserFactsOrAnalysis() = runBlocking {
    val repository = AstraLibraryRepository.get(ApplicationProvider.getApplicationContext())
    val suffix = System.nanoTime().toString()
    val tree = "content://metadata-test/tree/$suffix"
    val folderId = (repository.registerFolder(tree, "Metadata upgrade").getValue("id") as Number).toLong()
    val path = "$tree/track.opus"
    val files = listOf(file(path, tree, 1024, 100))
    try {
      repository.scanLocalFolder(folderId, false, { files }, { metadata("Legacy").copy(metadataReaderVersion = 0) }, { _, _, _, _ -> })
      val addedAt = repository.getTrack(path)?.get("added_at")
      repository.setFavorite(path, true)
      repository.setTrackLoudness(path, -15.0, 0.8)
      val failed = repository.scanLocalFolder(folderId, false, { files }, { LocalAudioMetadata(ok = false) }, { _, _, _, _ -> })
      assertEquals(1, failed.errors)
      assertEquals("Legacy", repository.getTrack(path)?.get("title"))
      assertEquals(true, repository.listFolders().single { (it["id"] as Number).toLong() == folderId }["needs_metadata_reindex"])
      val repaired = repository.scanLocalFolder(folderId, false, { files }, { metadata("Repaired").copy(trackTotal = 12, discTotal = 2) }, { _, _, _, _ -> })
      assertEquals(1, repaired.updated)
      val track = repository.getTrack(path)!!
      assertEquals("Repaired", track["title"])
      assertEquals(12, track["track_total"])
      assertEquals(addedAt, track["added_at"])
      assertEquals(-15.0, track["loudness_lufs"])
      assertTrue(path in repository.getFavoritePaths())
      val unchanged = repository.scanLocalFolder(folderId, false, { files }, { error("Must reuse successfully upgraded metadata") }, { _, _, _, _ -> })
      assertEquals(repaired.revision, unchanged.revision)
    } finally {
      repository.setFavorite(path, false)
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
    name = uri.substringAfterLast("%2F").substringAfterLast('/'),
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
