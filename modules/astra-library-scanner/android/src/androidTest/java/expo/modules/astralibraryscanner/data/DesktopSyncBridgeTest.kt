package expo.modules.astralibraryscanner.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DesktopSyncBridgeTest {
  private lateinit var catalog: AstraCatalogDatabase
  private lateinit var user: AstraUserDatabase

  @Before
  fun openDatabases() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    SoLoader.init(context, OpenSourceMergedSoMapping)
    catalog = Room.inMemoryDatabaseBuilder(context, AstraCatalogDatabase::class.java)
      .allowMainThreadQueries()
      .build()
    user = Room.inMemoryDatabaseBuilder(context, AstraUserDatabase::class.java)
      .allowMainThreadQueries()
      .build()
  }

  @After
  fun closeDatabases() {
    catalog.close()
    user.close()
  }

  @Test
  fun nativeMapPreservesNestedNullsAndAppliesNormalAndDynamicPlaylists() = runBlocking {
    val rules = """{"version":2,"filter":{"kind":"group","match":"all","children":[]}}"""
    val normal = playlist("normal")
    val dynamic = playlist("dynamic") + mapOf(
      "kind" to "dynamic",
      "dynamicRules" to rules,
      "entries" to null,
    )
    val plan = bridgeMap(mapOf(
      "settings" to mapOf("desktop_sync_last_test" to "3000"),
      "playlistUpserts" to listOf(normal, dynamic),
      "baselineUpserts" to listOf(mapOf(
        "syncUid" to "normal",
        "localUpdatedAt" to 2000.0,
        "remoteUpdatedAt" to 2000.0,
      )),
      "favoriteAdds" to emptyList<Any>(),
      "playlistDeletes" to emptyList<Any>(),
    ))

    val converted = plan.toHashMap()
    val playlists = converted["playlistUpserts"] as List<*>
    val convertedNormal = playlists[0] as Map<*, *>
    assertTrue(convertedNormal.containsKey("dynamicRules"))
    assertNull(convertedNormal["dynamicRules"])
    val entry = (convertedNormal["entries"] as List<*>).first() as Map<*, *>
    assertTrue(entry.containsKey("durationSeconds"))
    assertTrue(entry.containsKey("sourcePath"))
    assertNull(entry["durationSeconds"])
    assertNull(entry["sourcePath"])
    assertNull((playlists[1] as Map<*, *>)["entries"])

    val result = NativeDesktopSync.applyPlan(user, catalog, converted)
    val results = result["playlistResults"] as List<*>
    assertEquals(listOf("created", "created"), results.map { (it as Map<*, *>)["status"] })
    assertEquals(2, (results.first() as Map<*, *>)["entriesFallback"])
    val dao = user.userDao()
    val storedNormal = requireNotNull(dao.getPlaylistBySyncUid("normal"))
    assertNull(storedNormal.dynamicRulesJson)
    assertEquals(1000L, storedNormal.createdAt)
    assertEquals(2000L, storedNormal.updatedAt)
    val entries = dao.getPlaylistTracks(storedNormal.id)
    assertEquals(listOf("Missing path", "Desktop path"), entries.map { it.fallbackTitle })
    assertEquals(listOf(0, 1), entries.map { it.position })
    assertEquals(listOf(1500L, 1600L), entries.map { it.addedAt })
    assertTrue(entries.first().trackPath.startsWith("astra-sync://unmatched/"))
    assertEquals("/Music/Desktop path.flac", entries.last().trackPath)
    val storedDynamic = requireNotNull(dao.getPlaylistBySyncUid("dynamic"))
    assertEquals(rules, storedDynamic.dynamicRulesJson)
    assertTrue(dao.getPlaylistTracks(storedDynamic.id).isEmpty())
    assertEquals("3000", dao.getSettings(listOf("desktop_sync_last_test")).single().value)
    assertEquals(2000L, dao.getPlaylistSyncStates().single().remoteUpdatedAt)

    // Retrying an already-applied plan must preserve timestamps and contents.
    NativeDesktopSync.applyPlan(user, catalog, converted)
    assertEquals(2, dao.getLocalPlaylists().size)
    assertEquals(storedNormal, dao.getPlaylistBySyncUid("normal"))
    assertEquals(entries.map { it.trackPath }, dao.getPlaylistTracks(storedNormal.id).map { it.trackPath })
    assertEquals(1, dao.getPlaylistSyncStates().size)
  }

  @Test
  fun desktopAndPhoneResolutionsAcceptNullMergedPlaylist() = runBlocking {
    val dao = user.userDao()
    for (resolution in listOf("desktop", "phone")) {
      val id = dao.insertPlaylist(PlaylistEntity(
        name = resolution, createdAt = 1000, updatedAt = 2000, syncUid = resolution,
      ))
      val mergedPlaylist: ReadableMap? = null
      NativeDesktopSync.resolveConflict(
        user, catalog, conflict(id, resolution).toHashMap(), resolution, mergedPlaylist?.toHashMap(),
      )
      val baseline = dao.getPlaylistSyncStates().single { it.syncUid == resolution }
      assertEquals(if (resolution == "desktop") 2000L else 0L, baseline.localUpdatedAt)
      assertEquals(if (resolution == "phone") 3000L else 0L, baseline.remoteUpdatedAt)
      assertEquals(2000L, dao.getPlaylist(id)?.updatedAt)
    }
  }

  @Test
  fun keepBothResolutionAcceptsNullMergedPlaylist() = runBlocking {
    val dao = user.userDao()
    val id = dao.insertPlaylist(PlaylistEntity(
      name = "Shared", createdAt = 1000, updatedAt = 2000, syncUid = "shared",
    ))
    dao.putPlaylistTracks(listOf(PlaylistTrackEntity(
      playlistId = id, trackPath = "/Music/Phone.flac", position = 0, addedAt = 1500,
    )))
    NativeDesktopSync.resolveConflict(user, catalog, conflict(id, "shared").toHashMap(), "both", null)
    val copy = dao.getLocalPlaylists().single { it.id != id }
    assertEquals("Shared (Phone)", copy.name)
    assertEquals("/Music/Phone.flac", dao.getPlaylistTracks(copy.id).single().trackPath)
    assertEquals("Shared", dao.getPlaylist(id)?.name)
    assertEquals(0L, dao.getPlaylistSyncStates().single().remoteUpdatedAt)
  }

  @Test
  fun mergeResolutionAcceptsNestedNullsAndPreservesSourceMetadata() = runBlocking {
    val dao = user.userDao()
    val id = dao.insertPlaylist(PlaylistEntity(
      name = "Before merge", createdAt = 1000, updatedAt = 2000, syncUid = "shared",
    ))
    val merged = bridgeMap(playlist("shared") + mapOf("updatedAt" to 4000.0))
    NativeDesktopSync.resolveConflict(
      user, catalog, conflict(id, "shared").toHashMap(), "merge", merged.toHashMap(),
    )
    val stored = requireNotNull(dao.getPlaylist(id))
    assertEquals("shared", stored.name)
    assertNull(stored.dynamicRulesJson)
    assertEquals(4000L, stored.updatedAt)
    assertEquals(listOf(1500L, 1600L), dao.getPlaylistTracks(id).map { it.addedAt })
    val baseline = dao.getPlaylistSyncStates().single()
    assertEquals(0L, baseline.localUpdatedAt)
    assertEquals(3000L, baseline.remoteUpdatedAt)
  }

  private fun bridgeMap(value: Map<String, Any?>): ReadableMap = Arguments.makeNativeMap(value)

  private fun conflict(playlistId: Long, uid: String): ReadableMap = bridgeMap(mapOf(
    "kind" to "concurrent-edit",
    "syncUid" to uid,
    "localPlaylistId" to playlistId.toDouble(),
    "localUpdatedAt" to 2000.0,
    "remoteUpdatedAt" to 3000.0,
    "local" to playlist(uid),
    "remote" to playlist(uid),
  ))

  private fun playlist(uid: String): Map<String, Any?> = mapOf(
    "syncUid" to uid,
    "name" to uid,
    "kind" to "normal",
    "dynamicRules" to null,
    "createdAt" to 1000.0,
    "updatedAt" to 2000.0,
    "entries" to listOf(
      mapOf(
        "title" to "Missing path", "artist" to "Artist", "album" to "Album",
        "durationSeconds" to null, "sourcePath" to null, "position" to 0, "addedAt" to 1500.0,
      ),
      mapOf(
        "title" to "Desktop path", "artist" to "Artist", "album" to "Album",
        "durationSeconds" to null, "sourcePath" to "/Music/Desktop path.flac",
        "position" to 1, "addedAt" to 1600.0,
      ),
    ),
  )
}
