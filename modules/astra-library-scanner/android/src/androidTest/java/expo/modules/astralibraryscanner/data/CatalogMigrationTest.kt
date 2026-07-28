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
      assertEquals(CURRENT_ARTIST_CREDIT_VERSION, cursor.getInt(1))
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
