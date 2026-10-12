package expo.modules.astralibraryscanner.data

import androidx.test.ext.junit.runners.AndroidJUnit4
import expo.modules.astralibraryscanner.TvMusicStorage
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class FolderPlaybackPathsTest {
  @Test
  fun tvVolumeAndNestedFoldersMatchEncodedRelativePaths() {
    val parent = TvMusicStorage.folderUri("external_primary", "Music/Astra Real Music/Derivakat - RETAKE")
    assertTrue(folderSubtreeContains("", parent))
    assertTrue(folderSubtreeContains("/Music", parent))
    assertTrue(folderSubtreeContains("/Music/Astra Real Music", parent))
    assertTrue(folderSubtreeContains("/Music/Astra Real Music/Derivakat - RETAKE", parent))
    assertFalse(folderSubtreeContains("/Music/Astra Real Music/Derivakat", parent))
    assertFalse(folderSubtreeContains("/Music/Other", parent))
    assertFalse(folderSubtreeContains("/Music/Astra Real Music/Derivakat - RETAKE/Disc 1", parent))
  }

  @Test
  fun tvSelectedSubfolderAndRemovableVolumeKeepDirectoryBoundaries() {
    val parent = TvMusicStorage.folderUri("abcd-1234", "音楽/100% Mix/Disc 1")
    assertTrue(folderSubtreeContains("音楽/100% Mix", parent))
    assertTrue(folderSubtreeContains("音楽/100% Mix/Disc 1", parent))
    assertFalse(folderSubtreeContains("音楽/100%", parent))
    assertFalse(folderSubtreeContains("音楽/100% Mix/Disc 10", parent))
    assertTrue(folderSubtreeContains("", TvMusicStorage.folderUri("abcd-1234", "")))
  }

  @Test
  fun safPhoneAndTabletMatchingRemainsUnchanged() {
    val parent = "content://com.android.externalstorage.documents/tree/primary%3AMusic/document/primary%3AMusic%2FArtist%2FAlbum"
    assertTrue(folderSubtreeContains("Music", parent))
    assertTrue(folderSubtreeContains("Music/Artist", parent))
    assertTrue(folderSubtreeContains("Music/Artist/Album", parent))
    assertFalse(folderSubtreeContains("Music/Art", parent))
    assertFalse(folderSubtreeContains("Music/Other", parent))
    assertFalse(folderSubtreeContains("Music/Artist/Album/Disc 1", parent))
  }
}
