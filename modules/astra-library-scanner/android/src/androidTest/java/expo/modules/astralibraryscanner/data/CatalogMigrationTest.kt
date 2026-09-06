package expo.modules.astralibraryscanner.data

import androidx.room.testing.MigrationTestHelper
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CatalogMigrationTest {
  @get:Rule
  val helper = MigrationTestHelper(
    InstrumentationRegistry.getInstrumentation(),
    AstraCatalogDatabase::class.java,
  )

  @After
  fun cleanUp() {
    InstrumentationRegistry.getInstrumentation().targetContext.deleteDatabase(TEST_DATABASE)
  }

  @Test
  fun migrationAddsCreditColumnsAndMarksOnlyLocalSourcesStale() {
    helper.createDatabase(TEST_DATABASE, 1).apply {
      insertSource("local:1", "local", 1)
      insertSource("jellyfin:2", "jellyfin", 2)
      close()
    }

    val database = helper.runMigrationsAndValidate(
      TEST_DATABASE,
      2,
      true,
      CATALOG_MIGRATION_1_2,
    )

    database.query(
      "SELECT source_key, artist_credit_version FROM catalog_sources ORDER BY source_key",
    ).use { cursor ->
      assertTrue(cursor.moveToFirst())
      assertEquals("jellyfin:2", cursor.getString(0))
      assertEquals(INITIAL_MULTI_ARTIST_CREDIT_VERSION, cursor.getInt(1))
      assertTrue(cursor.moveToNext())
      assertEquals("local:1", cursor.getString(0))
      assertEquals(LEGACY_ARTIST_CREDIT_VERSION, cursor.getInt(1))
    }

    database.query("PRAGMA table_info(tracks)").use { cursor ->
      val columnNames = buildSet {
        val nameIndex = cursor.getColumnIndexOrThrow("name")
        while (cursor.moveToNext()) add(cursor.getString(nameIndex))
      }
      assertTrue("artist_names_json" in columnNames)
      assertTrue("album_artist_names_json" in columnNames)
    }
  }

  @Test
  fun metadataAndResolveMigrationsPreserveSourceRowsAndMarkDerivedStateStale() {
    helper.createDatabase(TEST_DATABASE, 2).apply {
      insertSource("local:1", "local", 1)
      execSQL("INSERT INTO catalog_meta (id, revision, collation_version, updated_at) VALUES (1, 7, 1, 42)")
      execSQL("""
        INSERT INTO tracks (generation_id, source_key, path, title, artist, artist_names_json,
          album, album_identity_key, format, file_name, added_at, modified_at,
          title_sort_key, artist_sort_key, album_sort_key, file_name_sort_key,
          disc_sort, track_sort, section_label, duration, mtime, source_type, rg_scanned)
        VALUES ('legacy', 'local:1', 'content://legacy/track.opus', '日本語', 'Earth, Wind & Fire',
          '["Earth, Wind & Fire","The Emotions"]', 'Album', 'legacy-key', 'OPUS', 'track.opus',
          100, 200, 'title', 'artist', 'album', 'file', 0, 0, 'T', 12, 300, 'local', 0)
      """.trimIndent())
      close()
    }
    val database = helper.runMigrationsAndValidate(TEST_DATABASE, 4, true, CATALOG_MIGRATION_2_3, CATALOG_MIGRATION_3_4)
    database.query("SELECT title, artist_names_json, added_at, metadata_reader_version, track_total, resolved_artist_names_json FROM tracks").use {
      assertTrue(it.moveToFirst())
      assertEquals("日本語", it.getString(0))
      assertEquals("[\"Earth, Wind & Fire\",\"The Emotions\"]", it.getString(1))
      assertEquals(100L, it.getLong(2))
      assertEquals(0, it.getInt(3))
      assertTrue(it.isNull(4))
      assertTrue(it.isNull(5))
    }
    database.query("SELECT revision, resolve_version FROM catalog_meta").use {
      assertTrue(it.moveToFirst())
      assertEquals(7L, it.getLong(0))
      assertEquals(0, it.getInt(1))
    }
  }

  private fun SupportSQLiteDatabase.insertSource(key: String, type: String, id: Long) {
    execSQL(
      """
        INSERT INTO catalog_sources
          (source_key, source_type, source_id, active_generation_id, updated_at)
        VALUES (?, ?, ?, NULL, 0)
      """.trimIndent(),
      arrayOf<Any>(key, type, id),
    )
  }

  private companion object {
    const val TEST_DATABASE = "artist-credit-migration-test"
  }
}
