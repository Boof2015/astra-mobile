package expo.modules.astralibraryscanner.data

import androidx.room.testing.MigrationTestHelper
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class UserMigrationTest {
  @get:Rule
  val helper = MigrationTestHelper(
    InstrumentationRegistry.getInstrumentation(),
    AstraUserDatabase::class.java,
  )

  @After
  fun cleanUp() {
    InstrumentationRegistry.getInstrumentation().targetContext.deleteDatabase(TEST_DATABASE)
  }

  @Test
  fun migrationAddsDetailedHistoryWithoutChangingProtectedUserData() {
    helper.createDatabase(TEST_DATABASE, 1).apply {
      execSQL("INSERT INTO settings (`key`, value) VALUES ('theme_base', 'amoled')")
      execSQL(
        """
          INSERT INTO folders
            (id, tree_uri, display_name, added_at, last_scanned_at, last_scan_status, last_scan_error)
          VALUES (1, 'content://music', 'Music', 10, 20, 'ready', NULL)
        """.trimIndent(),
      )
      execSQL(
        """
          INSERT INTO playlists
            (id, name, created_at, updated_at, last_played_at, kind, dynamic_rules_json,
             remote_source_id, remote_playlist_id, sync_uid)
          VALUES (1, 'Keep Me', 10, 20, 30, 'static', NULL, NULL, NULL, 'playlist-1')
        """.trimIndent(),
      )
      execSQL(
        """
          INSERT INTO playlist_tracks
            (id, playlist_id, track_path, position, added_at, fallback_title,
             fallback_artist, fallback_album)
          VALUES (1, 1, '/music/track.flac', 0, 10, 'Track', 'Artist', 'Album')
        """.trimIndent(),
      )
      execSQL("INSERT INTO favorites (track_path, added_at) VALUES ('/music/track.flac', 10)")
      execSQL(
        """
          INSERT INTO playback_history (track_path, last_played_at, play_count)
          VALUES ('/music/track.flac', 30, 9)
        """.trimIndent(),
      )
      execSQL(
        """
          INSERT INTO playback_sessions
            (id, context_json, anchor_path, shuffle_seed, active_position, created_at, updated_at)
          VALUES ('session', '{}', '/music/track.flac', NULL, 0, 10, 20)
        """.trimIndent(),
      )
      execSQL(
        """
          INSERT INTO playback_queue_entries (session_id, position, track_path)
          VALUES ('session', 0, '/music/track.flac')
        """.trimIndent(),
      )
      close()
    }

    val database = helper.runMigrationsAndValidate(
      TEST_DATABASE,
      2,
      true,
      USER_MIGRATION_1_2,
    )

    assertEquals("amoled", database.singleString("SELECT value FROM settings WHERE `key` = 'theme_base'"))
    assertEquals("Music", database.singleString("SELECT display_name FROM folders WHERE id = 1"))
    assertEquals("Keep Me", database.singleString("SELECT name FROM playlists WHERE id = 1"))
    assertEquals(1, database.singleInt("SELECT COUNT(*) FROM playlist_tracks"))
    assertEquals(1, database.singleInt("SELECT COUNT(*) FROM favorites"))
    assertEquals(9, database.singleInt("SELECT play_count FROM playback_history"))
    assertEquals(1, database.singleInt("SELECT COUNT(*) FROM playback_sessions"))
    assertEquals(1, database.singleInt("SELECT COUNT(*) FROM playback_queue_entries"))

    val tables = buildSet {
      database.query(
        """
          SELECT name FROM sqlite_master
          WHERE type = 'table' AND name LIKE 'listening_%'
        """.trimIndent(),
      ).use { cursor ->
        while (cursor.moveToNext()) add(cursor.getString(0))
      }
    }
    assertTrue("listening_history_meta" in tables)
    assertTrue("listening_sessions" in tables)
    assertTrue("listening_segments" in tables)
  }

  @Test
  fun queueV3MigrationAssignsStableIdsByDuplicateOccurrence() {
    helper.createDatabase(TEST_DATABASE, 2).apply {
      execSQL(
        """
          INSERT INTO playback_sessions
            (id, context_json, anchor_path, shuffle_seed, active_position, created_at, updated_at)
          VALUES ('active-context', '{}', '/a.flac', 42, 0, 10, 20)
        """.trimIndent(),
      )
      execSQL(
        """
          INSERT INTO playback_queue_entries (session_id, position, track_path) VALUES
            ('active-context', 0, '/a.flac'),
            ('active-context', 1, '/b.flac'),
            ('active-context', 2, '/a.flac')
        """.trimIndent(),
      )
      execSQL(
        """
          INSERT INTO playback_original_queue_entries (session_id, position, track_path) VALUES
            ('active-context', 0, '/a.flac'),
            ('active-context', 1, '/a.flac'),
            ('active-context', 2, '/b.flac')
        """.trimIndent(),
      )
      close()
    }

    val database = helper.runMigrationsAndValidate(
      TEST_DATABASE,
      3,
      true,
      USER_MIGRATION_2_3,
    )

    val current = database.query(
      """
        SELECT entry_id, track_path
        FROM playback_queue_entries
        WHERE session_id = 'active-context'
        ORDER BY position
      """.trimIndent(),
    ).use { cursor ->
      buildList {
        while (cursor.moveToNext()) add(cursor.getLong(0) to cursor.getString(1))
      }
    }
    val original = database.query(
      """
        SELECT entry_id, track_path
        FROM playback_original_queue_entries
        WHERE session_id = 'active-context'
        ORDER BY position
      """.trimIndent(),
    ).use { cursor ->
      buildList {
        while (cursor.moveToNext()) add(cursor.getLong(0) to cursor.getString(1))
      }
    }

    assertEquals(listOf(0L to "/a.flac", 1L to "/b.flac", 2L to "/a.flac"), current)
    assertEquals(listOf(0L to "/a.flac", 2L to "/a.flac", 1L to "/b.flac"), original)
    assertEquals(
      3,
      database.singleInt(
        "SELECT next_entry_id FROM playback_sessions WHERE id = 'active-context'",
      ),
    )
    assertEquals(
      1,
      database.singleInt(
        "SELECT queue_revision FROM playback_sessions WHERE id = 'active-context'",
      ),
    )
  }

  private fun androidx.sqlite.db.SupportSQLiteDatabase.singleString(query: String): String =
    this.query(query).use { cursor ->
      assertTrue(cursor.moveToFirst())
      cursor.getString(0)
    }

  private fun androidx.sqlite.db.SupportSQLiteDatabase.singleInt(query: String): Int =
    this.query(query).use { cursor ->
      assertTrue(cursor.moveToFirst())
      cursor.getInt(0)
    }

  private companion object {
    const val TEST_DATABASE = "listening-history-user-migration-test"
  }
}
