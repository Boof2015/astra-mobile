package expo.modules.astralibraryscanner.data

import androidx.sqlite.db.SimpleSQLiteQuery

data class CarBrowseGroup(val label: String, val itemCount: Long)

/** Read-only car queries share the catalog's ICU sort keys and letter labels. */
class CarBrowseQuery(
  val kind: Kind,
  revision: Long,
  grouping: String = "astra",
  artistKey: String? = null,
  firstLetter: String? = null,
  lastLetter: String? = null,
) {
  enum class Kind { TRACKS, FAVORITES, ALBUMS, ARTISTS, ARTIST_ALBUMS }
  private val track = kind == Kind.TRACKS || kind == Kind.FAVORITES
  private val table = when (kind) {
    Kind.TRACKS, Kind.FAVORITES -> "active_tracks"
    Kind.ALBUMS, Kind.ARTIST_ALBUMS -> "album_summaries"
    Kind.ARTISTS -> "artist_summaries"
  }
  private val order = when (kind) {
    Kind.TRACKS, Kind.FAVORITES -> "x.title_sort_key, x.path"
    Kind.ALBUMS, Kind.ARTIST_ALBUMS -> "x.name_sort_key, x.identity_key"
    Kind.ARTISTS -> "x.name_sort_key, x.artist_key"
  }
  private val args = mutableListOf<Any>()
  private val conditions = mutableListOf<String>()
  init {
    if (!track) { conditions += "x.revision = ?"; args += revision }
    if (kind == Kind.ARTISTS) { conditions += "x.grouping_mode = ?"; args += grouping }
    if (kind == Kind.FAVORITES) {
      conditions += "EXISTS (SELECT 1 FROM track_user_facts f WHERE f.path = x.path AND f.is_favorite = 1)"
    }
    if (kind == Kind.ARTIST_ALBUMS) {
      // Include credited appearances, too, so changing this view from tracks to
      // albums does not hide music on compilations or another artist's release.
      conditions += """EXISTS (SELECT 1 FROM active_tracks t
        INNER JOIN artist_track_index i ON i.track_id = t.id
        WHERE t.album_identity_key = x.identity_key AND i.revision = ?
          AND i.grouping_mode = ? AND i.artist_key = ?)"""
      args.addAll(listOf(revision, grouping, artistKey ?: ""))
    }
    if (firstLetter != null && lastLetter != null) {
      conditions += "x.section_label >= ? AND x.section_label <= ?"
      args.addAll(listOf(firstLetter, lastLetter))
    }
  }
  private val from get() = "FROM $table x WHERE ${conditions.joinToString(" AND ").ifEmpty { "1" }}"
  fun count() = SimpleSQLiteQuery("SELECT COUNT(*) $from", args.toTypedArray())
  fun groups() = SimpleSQLiteQuery(
    "SELECT x.section_label AS label, COUNT(*) AS itemCount $from GROUP BY x.section_label ORDER BY x.section_label",
    args.toTypedArray())
  fun page(offset: Long, limit: Int) = SimpleSQLiteQuery(
    "SELECT x.* $from ORDER BY $order LIMIT ? OFFSET ?",
    (args + listOf(limit.coerceIn(0, 100), offset.coerceAtLeast(0))).toTypedArray())
}
