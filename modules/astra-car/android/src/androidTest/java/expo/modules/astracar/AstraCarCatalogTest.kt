package expo.modules.astracar

import android.content.Context
import android.os.Bundle
import android.support.v4.media.MediaBrowserCompat
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import expo.modules.astralibraryscanner.data.*
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AstraCarCatalogTest {
  private lateinit var db: AstraCatalogDatabase
  private lateinit var users: AstraUserDatabase
  private lateinit var browser: AstraCarCatalog
  @Before fun setup() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    db = Room.inMemoryDatabaseBuilder(context, AstraCatalogDatabase::class.java).build()
    users = Room.inMemoryDatabaseBuilder(context, AstraUserDatabase::class.java).build()
    browser = AstraCarCatalog(context, db.catalogDao(), users.userDao())
  }
  @After fun close() { db.close(); users.close() }

  @Test fun lettersCoverEverySongIncludingAccentsNonLatinAndDensePrefixes() = runBlocking {
    val names = ('A'..'Z').flatMap { letter -> (1..12).map { "$letter song %03d".format(it) } } +
      (1..205).map { "Echo %03d".format(it) } + listOf("Été", "東京", "Привет", "123 song", "🚀")
    seed(names.mapIndexed { i, title -> track(i, title) })
    val root = browser.loadChildren(AstraCarMediaIds.section("tracks"))
    assertTrue(root.any { it.description.title.toString() == "A–D" })
    assertTrue(root.any { it.description.title.toString() == "E" })
    assertTrue(root.any { it.description.title.toString() == "0–9 & other" })
    val reached = mutableListOf<String>()
    suspend fun visit(id: String) {
      val children = browser.loadChildren(id)
      assertTrue(children.size <= 100)
      for (child in children) {
        assertFalse(child.description.title.toString().matches(Regex("\\d+–\\d+")))
        if (child.isBrowsable) visit(child.mediaId!!) else reached += AstraCarMediaIds.decode(child.mediaId)!!.path!!
      }
    }
    visit(AstraCarMediaIds.section("tracks"))
    assertEquals(names.size, reached.size)
    assertEquals(names.size, reached.toSet().size)
    val e = root.first { it.description.title.toString() == "E" }
    val ranges = browser.loadChildren(e.mediaId!!)
    assertTrue(ranges.all { it.isBrowsable && it.description.title.toString().contains(" … ") })
    val eTracks = ranges.flatMap { browser.loadChildren(it.mediaId!!) }
    assertTrue(eTracks.any { it.description.title.toString() == "Été" })
    assertTrue(eTracks.all { SortKeys.sectionLabel(it.description.title.toString()) == "E" })
    // IDs resolve independently of the parent menu; old numeric IDs remain readable aliases.
    assertEquals(ranges.first().description.title, browser.loadItem(ranges.first().mediaId!!)!!.description.title)
    val legacy = AstraCarMediaIds.encode(AstraCarMediaId("range", key = AstraCarMediaIds.section("tracks"), offset = 100, size = 100))
    assertEquals(100, browser.loadChildren(legacy).size)
  }

  @Test fun smallListsStayFlatAndArtistsOpenAlbumsInTrackOrder() = runBlocking {
    val tracks = listOf(track(0, "Zebra", "First album", 1), track(1, "Apple", "First album", 2),
      track(2, "Guest song", "Compilation", 1).copy(albumArtist = "Various Artists"))
    seed(tracks)
    val all = browser.loadChildren(AstraCarMediaIds.section("tracks"))
    assertTrue(all.all { it.isPlayable })
    assertEquals(listOf("Apple", "Guest song", "Zebra"), all.map { it.description.title.toString() })
    val artist = browser.loadChildren(AstraCarMediaIds.section("artists")).first { it.description.title.toString() == "Artist" }
    val albums = browser.loadChildren(artist.mediaId!!)
    assertEquals(setOf("First album", "Compilation"), albums.map { it.description.title.toString() }.toSet())
    assertTrue(albums.all { it.isBrowsable && AstraCarMediaIds.decode(it.mediaId)?.kind == "album" })
    val album = albums.first { it.description.title.toString() == "First album" }
    assertEquals(listOf("Zebra", "Apple"), browser.loadChildren(album.mediaId!!).map { it.description.title.toString() })
  }

  @Test fun favoritesBrowseAlphabeticallyWhileRecentFavoritesKeepTheirDates() = runBlocking {
    seed(listOf(track(0, "Zulu"), track(1, "Alpha"), track(2, "Beta")))
    val user = users.userDao()
    user.putFavorites(listOf(FavoriteEntity("content://track/0", 30), FavoriteEntity("content://track/1", 20), FavoriteEntity("content://track/2", 10)))
    db.catalogDao().putTrackUserFacts((0..2).map { TrackUserFactEntity("content://track/$it", true) })
    val favorites = browser.loadChildren(AstraCarMediaIds.section("favorites"))
    assertEquals("Recently Favorited", favorites.first().description.title.toString())
    assertEquals(listOf("Alpha", "Beta", "Zulu"), favorites.drop(1).map { it.description.title.toString() })
    assertEquals(listOf("Zulu", "Alpha", "Beta"), browser.loadChildren(favorites.first().mediaId!!).map { it.description.title.toString() })
    assertEquals(listOf("content://track/1", "content://track/2", "content://track/0"), db.catalogDao().getFavoritePathsByTitle())
    user.deleteFavorite("content://track/1")
    db.catalogDao().putTrackUserFacts(listOf(TrackUserFactEntity("content://track/1", false)))
    assertEquals(listOf("Beta", "Zulu"), browser.loadChildren(AstraCarMediaIds.section("favorites")).drop(1).map { it.description.title.toString() })
  }

  @Test fun longPlaylistsUseSongNamesWithoutChangingOrderOrBrowseActions() = runBlocking {
    val tracks = (0..204).map { track(it, "Song %03d".format(204 - it)) }
    seed(tracks)
    val id = users.userDao().insertPlaylist(PlaylistEntity(name = "Road trip", createdAt = 0, updatedAt = 0))
    users.userDao().insertPlaylistTracks(tracks.mapIndexed { index, row -> PlaylistTrackEntity(playlistId = id, trackPath = row.path, position = index, addedAt = 0) })
    val ranges = browser.loadChildren(AstraCarMediaIds.playlist(id))
    assertEquals("Song 204 … Song 105", ranges.first().description.title.toString())
    val children = ranges.flatMap { browser.loadChildren(it.mediaId!!, actionLimit = 1) }
    assertEquals(tracks.map { it.title }, children.map { it.description.title.toString() })
    assertEquals(listOf("playNext"), children.first().description.extras!!.getStringArrayList(AstraCarBrowseActions.ITEM_ACTIONS))
    assertTrue(children.all { AstraCarMediaIds.decode(it.mediaId)?.contextId == id })
    val options = Bundle().apply { putInt(MediaBrowserCompat.EXTRA_PAGE, 1); putInt(MediaBrowserCompat.EXTRA_PAGE_SIZE, 100) }
    assertEquals(tracks.drop(100).take(100).map { it.title }, browser.loadChildren(AstraCarMediaIds.playlist(id), options).map { it.description.title.toString() })
  }

  private suspend fun seed(tracks: List<TrackEntity>) {
    val dao = db.catalogDao()
    dao.insertMeta(CatalogMetaEntity(collationVersion = COLLATION_VERSION, updatedAt = 0))
    dao.putSource(CatalogSourceEntity("local:1", "local", 1, null, 0))
    dao.insertGeneration(ScanGenerationEntity("test", "local:1", "staging", 1))
    dao.putTracks(tracks)
    val model = CatalogReadModelBuilder.build(dao.getProspectiveTracks("local:1", "test"), 1)
    dao.publishGeneration("local:1", "test", null, 1, model.identityUpdates, model.albums,
      model.artists, model.artistTrackIndex, model.directories, model.ftsRows)
  }

  private fun track(index: Int, title: String, album: String = "Album", number: Int = index) = TrackEntity(
    generationId = "test", sourceKey = "local:1", path = "content://track/$index", folderId = 1,
    title = title, artist = "Artist", album = album, albumIdentityKey = "pending", duration = 180.0,
    format = "FLAC", fileName = "$index.flac", addedAt = 0, modifiedAt = 0,
    titleSortKey = SortKeys.forText(title), artistSortKey = SortKeys.forText("Artist"), albumSortKey = SortKeys.forText(album),
    fileNameSortKey = SortKeys.forText("$index.flac"), discSort = 1, trackSort = number, sectionLabel = SortKeys.sectionLabel(title))
}
