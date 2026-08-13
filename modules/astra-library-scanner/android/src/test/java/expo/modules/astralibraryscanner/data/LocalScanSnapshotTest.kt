package expo.modules.astralibraryscanner.data

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalScanSnapshotTest {
  @Test
  fun identicalSnapshotCanReuseActiveGenerationRegardlessOfDiscoveryOrder() {
    val existing = listOf(
      track("content://music/a.flac", size = 100, mtime = 10),
      track("content://music/b.flac", size = 200, mtime = 20),
    ).associateBy(TrackEntity::path)
    val files = listOf(
      file("content://music/b.flac", size = 200, mtime = 20),
      file("content://music/a.flac", size = 100, mtime = 10),
    )

    assertTrue(canReuseActiveLocalGeneration(false, activeSource(), files, existing))
  }

  @Test
  fun additionsAndRemovalsRequirePublishing() {
    val existing = listOf(
      track("content://music/a.flac", size = 100, mtime = 10),
      track("content://music/b.flac", size = 200, mtime = 20),
    ).associateBy(TrackEntity::path)

    assertFalse(
      canReuseActiveLocalGeneration(
        false,
        activeSource(),
        listOf(file("content://music/a.flac", size = 100, mtime = 10)),
        existing,
      ),
    )
    assertFalse(
      canReuseActiveLocalGeneration(
        false,
        activeSource(),
        listOf(
          file("content://music/a.flac", size = 100, mtime = 10),
          file("content://music/b.flac", size = 200, mtime = 20),
          file("content://music/c.flac", size = 300, mtime = 30),
        ),
        existing,
      ),
    )
  }

  @Test
  fun sizeOrModificationChangesRequirePublishing() {
    val path = "content://music/a.flac"
    val existing = mapOf(path to track(path, size = 100, mtime = 10))

    assertFalse(
      canReuseActiveLocalGeneration(
        false,
        activeSource(),
        listOf(file(path, size = 101, mtime = 10)),
        existing,
      ),
    )
    assertFalse(
      canReuseActiveLocalGeneration(
        false,
        activeSource(),
        listOf(file(path, size = 100, mtime = 11)),
        existing,
      ),
    )
  }

  @Test
  fun matchingNullableSizesCanReuseActiveGeneration() {
    val path = "content://music/unknown-size.flac"
    val existing = mapOf(path to track(path, size = null, mtime = 0))

    assertTrue(
      canReuseActiveLocalGeneration(
        false,
        activeSource(),
        listOf(file(path, size = null, mtime = 0)),
        existing,
      ),
    )
  }

  @Test
  fun duplicateDiscoveredUrisRequirePublishing() {
    val first = "content://music/a.flac"
    val second = "content://music/b.flac"
    val existing = listOf(
      track(first, size = 100, mtime = 10),
      track(second, size = 100, mtime = 10),
    ).associateBy(TrackEntity::path)

    assertFalse(
      canReuseActiveLocalGeneration(
        false,
        activeSource(),
        listOf(file(first, size = 100, mtime = 10), file(first, size = 100, mtime = 10)),
        existing,
      ),
    )
  }

  @Test
  fun fullMissingAndStaleGenerationsCannotBeReused() {
    val path = "content://music/a.flac"
    val files = listOf(file(path, size = 100, mtime = 10))
    val existing = mapOf(path to track(path, size = 100, mtime = 10))

    assertFalse(canReuseActiveLocalGeneration(true, activeSource(), files, existing))
    assertFalse(
      canReuseActiveLocalGeneration(
        false,
        activeSource().copy(activeGenerationId = null),
        files,
        existing,
      ),
    )
    assertFalse(
      canReuseActiveLocalGeneration(
        false,
        activeSource().copy(artistCreditVersion = LEGACY_ARTIST_CREDIT_VERSION),
        files,
        existing,
      ),
    )
  }

  private fun activeSource(): CatalogSourceEntity = CatalogSourceEntity(
    sourceKey = "local:1",
    sourceType = "local",
    sourceId = 1,
    activeGenerationId = "active",
    updatedAt = 1,
    artistCreditVersion = CURRENT_ARTIST_CREDIT_VERSION,
  )

  private fun file(path: String, size: Long?, mtime: Long): LocalAudioFile = LocalAudioFile(
    uri = path,
    name = path.substringAfterLast('/'),
    size = size,
    lastModified = mtime,
    mimeType = "audio/flac",
    parentUri = "content://music",
    coverUri = null,
  )

  private fun track(path: String, size: Long?, mtime: Long): TrackEntity = TrackEntity(
    generationId = "active",
    sourceKey = "local:1",
    path = path,
    folderId = 1,
    title = path.substringAfterLast('/'),
    artist = "Artist",
    album = "Album",
    albumIdentityKey = "album",
    format = "FLAC",
    fileName = path.substringAfterLast('/'),
    size = size,
    mtime = mtime,
    addedAt = 1,
    modifiedAt = mtime,
    titleSortKey = "title",
    artistSortKey = "artist",
    albumSortKey = "album",
    fileNameSortKey = "file",
    discSort = 0,
    trackSort = 0,
    sectionLabel = "A",
  )
}
