package expo.modules.astralibraryscanner.data

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class RemoteAtmosMetadataTest {
  @Test fun syncPreservesAtmosMetadataAndClearsItWhenTheSourceChanges() = runBlocking {
    val repository = AstraLibraryRepository.get(ApplicationProvider.getApplicationContext())
    val source = repository.createRemoteSource("jellyfin", "Atmos metadata test", "https://example.invalid", "", false)
    val sourceId = (source.getValue("id") as Number).toLong()
    val path = "jellyfin://$sourceId/track/atmos-test"
    try {
      suspend fun sync(metadata: Map<String, Any?>) {
        val id = repository.beginRemoteSync(sourceId, "jellyfin")
        repository.appendRemoteTracks(id, listOf(mapOf(
          "path" to path, "title" to "Test song", "artist" to "Test artist", "album" to "Test album",
          "format" to "M4A", "duration" to 180.0, "codec" to "eac3", "source_track_id" to "atmos-test",
        ) + metadata))
        repository.commitRemoteSync(id)
      }
      sync(emptyMap()) // Legacy server metadata.
      val addedAt = repository.getTrack(path)!!["added_at"]
      assertNull(repository.getTrack(path)!!["is_atmos_joc"])
      sync(mapOf("codec_profile" to "Dolby Atmos", "is_atmos_joc" to 1))
      val atmos = repository.getTrack(path)!!
      assertEquals("Dolby Atmos", atmos["codec_profile"])
      assertEquals(1, atmos["is_atmos_joc"])
      assertEquals(addedAt, atmos["added_at"])
      sync(emptyMap())
      assertNull(repository.getTrack(path)!!["codec_profile"])
      assertNull(repository.getTrack(path)!!["is_atmos_joc"])
    } finally {
      repository.deleteRemoteSource(sourceId, purgeCatalog = true)
    }
  }
}
