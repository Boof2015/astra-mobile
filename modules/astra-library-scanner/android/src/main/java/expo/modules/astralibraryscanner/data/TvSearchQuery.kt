package expo.modules.astralibraryscanner.data

import androidx.sqlite.db.SimpleSQLiteQuery

data class SearchName(val name: String, val kind: String)

/** The existing library search predicates, with bounded pages and a separate
 * name-only projection for TV autocomplete. No artwork is bridged while typing. */
class TvSearchQuery(
  val kind: String,
  query: String,
  revision: Long,
  includeSingles: Boolean,
  grouping: String,
  includeCollaborations: Boolean,
  literal: Boolean = false,
  namesOnly: Boolean = false,
) {
  private val field: String
  private val key: String
  private val order: String
  private val from: String
  private val args = mutableListOf<Any>()
  private val prefix = query.trim().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"

  init {
    require(kind in listOf("tracks", "albums", "artists"))
    field = when (kind) { "tracks" -> "title"; "albums" -> "album"; else -> "artist" }
    key = when (kind) { "tracks" -> "path"; "albums" -> "identity_key"; else -> "artist_key" }
    order = if (kind == "tracks") "x.title_sort_key, x.path" else "x.name_sort_key, x.$key"
    val table = when (kind) { "tracks" -> "active_tracks"; "albums" -> "album_summaries"; else -> "artist_summaries" }
    val conditions = mutableListOf<String>()
    val joins = when (kind) {
      "tracks" -> if (literal) "" else "INNER JOIN track_fts f ON f.rowid = x.id"
      "albums" -> "INNER JOIN active_tracks t ON t.album_identity_key = x.identity_key" +
        if (literal) "" else " INNER JOIN track_fts f ON f.rowid = t.id"
      else -> """INNER JOIN artist_track_index i ON i.revision = x.revision
        AND i.grouping_mode = x.grouping_mode AND i.artist_key = x.artist_key
        INNER JOIN active_tracks t ON t.id = i.track_id""" +
        if (literal) "" else " INNER JOIN track_fts f ON f.rowid = i.track_id"
    }
    if (kind != "tracks") { conditions += "x.revision = ?"; args += revision }
    if (kind == "albums" && !includeSingles) conditions += "x.is_single = 0"
    if (kind == "artists") {
      conditions += "x.grouping_mode = ?"; args += grouping
      if (!includeCollaborations) conditions += "x.is_collaboration = 0"
    }
    if (literal) {
      val fields = if (namesOnly) listOf("x.$field") else when (kind) {
        "tracks" -> listOf("x.title", "x.artist", "x.album", "x.file_name")
        "albums" -> listOf("x.album", "x.artist", "t.title", "t.file_name")
        else -> listOf("x.artist", "t.title", "t.album", "t.file_name")
      }
      conditions += fields.joinToString(" OR ", "(", ")") { "$it LIKE ? ESCAPE '\\'" }
      val pattern = "%${query.trim().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")}%"
      fields.forEach { args += pattern }
    } else {
      conditions += if (namesOnly) "f.$field MATCH ?" else "track_fts MATCH ?"
      args += query.trim().split(Regex("\\s+")).filter(String::isNotBlank).joinToString(" AND ") {
        "\"${it.replace("\"", "\"\"")}\"*"
      }
    }
    from = "FROM $table x $joins WHERE ${conditions.joinToString(" AND ")}"
  }

  fun count() = SimpleSQLiteQuery("SELECT COUNT(*) FROM (SELECT DISTINCT x.$key $from)", args.toTypedArray())
  fun page(offset: Int, limit: Int) = SimpleSQLiteQuery(
    "SELECT DISTINCT x.* $from ORDER BY $order LIMIT ? OFFSET ?",
    (args + listOf(limit.coerceIn(1, 120), offset.coerceAtLeast(0))).toTypedArray())
  fun names(limit: Int) = SimpleSQLiteQuery(
    "SELECT DISTINCT x.$field AS name, '${when (kind) { "tracks" -> "Track"; "albums" -> "Album"; else -> "Artist" }}' AS kind $from ORDER BY CASE WHEN x.$field LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, name COLLATE NOCASE LIMIT ?",
    (args + listOf(prefix, limit.coerceIn(1, 12))).toTypedArray())
}
