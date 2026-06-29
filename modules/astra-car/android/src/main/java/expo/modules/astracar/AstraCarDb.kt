package expo.modules.astracar

import android.content.Context
import android.database.sqlite.SQLiteDatabase

/**
 * Shared read access to the op-sqlite library database (`astra-library.db`), used by
 * both the browse catalog and the artwork ContentProvider. op-sqlite stores the file at
 * [Context.getDatabasePath] (the same dir we read here).
 */
object AstraCarDb {
  const val DB_NAME = "astra-library.db"

  /**
   * Opens the library DB for reading. The JS side runs it in WAL mode
   * (`PRAGMA journal_mode = WAL`), and a strict `OPEN_READONLY` open of a live WAL
   * database can throw ("could not open in read/write mode" — read-only WAL needs a
   * writable `-shm`/`-wal`). Try read-only first, then fall back to read/write (we only
   * ever run `SELECT`s). Returns null if the DB is missing or can't be opened.
   */
  fun openReadable(context: Context): SQLiteDatabase? {
    val file = context.getDatabasePath(DB_NAME)
    if (!file.exists()) return null
    return runCatching {
      SQLiteDatabase.openDatabase(file.absolutePath, null, SQLiteDatabase.OPEN_READONLY)
    }.recoverCatching {
      SQLiteDatabase.openDatabase(file.absolutePath, null, SQLiteDatabase.OPEN_READWRITE)
    }.getOrNull()
  }
}
