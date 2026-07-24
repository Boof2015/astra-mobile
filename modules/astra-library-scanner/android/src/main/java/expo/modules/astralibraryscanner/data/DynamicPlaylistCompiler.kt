package expo.modules.astralibraryscanner.data

import androidx.sqlite.db.SimpleSQLiteQuery
import androidx.sqlite.db.SupportSQLiteQuery
import java.util.Locale
import org.json.JSONObject

data class DynamicQueries(
  val tracks: SupportSQLiteQuery,
  val count: SupportSQLiteQuery,
)

/** Allow-list compiler: rules become bound parameters; no user text becomes SQL. */
object DynamicPlaylistCompiler {
  private val textFields = mapOf(
    "title" to "t.title",
    "artist" to "t.artist",
    "album" to "t.album",
    "album_artist" to "t.album_artist",
    "genre" to "t.genre",
    "format" to "t.format",
    "musical_key" to "t.musical_key",
  )
  private val numericFields = mapOf(
    "play_count" to "COALESCE(f.play_count, 0)",
    "year" to "t.year",
    "duration_seconds" to "t.duration",
    "bpm" to "t.bpm",
  )
  private val sortFields = mapOf(
    "title" to "t.title_sort_key",
    "artist" to "t.artist_sort_key",
    "album" to "t.album_sort_key",
    "added_at" to "t.added_at",
    "last_played_at" to "f.last_played_at",
    "play_count" to "COALESCE(f.play_count, 0)",
    "year" to "t.year",
    "duration_seconds" to "t.duration",
    "bpm" to "t.bpm",
  )

  fun compile(rawRules: String?, offset: Int, requestedLimit: Int): DynamicQueries {
    val json = runCatching { JSONObject(rawRules ?: "{}") }.getOrElse { JSONObject() }
    val clauses = mutableListOf<String>()
    val args = mutableListOf<Any?>()
    json.optJSONArray("conditions")?.let { conditions ->
      for (index in 0 until conditions.length()) {
        val condition = conditions.optJSONObject(index) ?: continue
        when (condition.optString("kind")) {
          "text" -> appendText(condition, clauses, args)
          "exact" -> appendExact(condition, clauses, args)
          "numeric" -> appendNumeric(condition, clauses, args)
          "date" -> appendDate(condition, clauses, args)
        }
      }
    }
    val where = clauses.ifEmpty { listOf("1 = 1") }.joinToString(" AND ")
    val sort = json.optJSONObject("sort")
    val sortExpression = sortFields[sort?.optString("field")] ?: "t.title_sort_key"
    val direction = if (sort?.optString("direction") == "desc") "DESC" else "ASC"
    val ruleLimit = if (json.has("limit") && !json.isNull("limit")) json.optInt("limit", 0) else 0
    val pageLimit = requestedLimit.coerceIn(1, MAX_PAGE_SIZE)
    val limit = if (ruleLimit > 0) minOf(pageLimit, (ruleLimit - offset).coerceAtLeast(0)) else pageLimit
    val base = """
      FROM active_tracks t
      LEFT JOIN track_user_facts f ON f.path = t.path
      WHERE $where
    """.trimIndent()
    return DynamicQueries(
      tracks = SimpleSQLiteQuery(
        "SELECT t.* $base ORDER BY $sortExpression $direction, t.path ASC LIMIT ? OFFSET ?",
        (args + listOf(limit, offset)).toTypedArray(),
      ),
      count = SimpleSQLiteQuery(
        "SELECT ${if (ruleLimit > 0) "MIN(COUNT(*), $ruleLimit)" else "COUNT(*)"} $base",
        args.toTypedArray(),
      ),
    )
  }

  private fun appendText(condition: JSONObject, clauses: MutableList<String>, args: MutableList<Any?>) {
    val expression = textFields[condition.optString("field")] ?: return
    val value = condition.optString("value").trim().lowercase(Locale.ROOT)
    if (value.isEmpty()) return
    when (condition.optString("operator")) {
      "contains" -> {
        clauses += "LOWER(COALESCE($expression, '')) LIKE ? ESCAPE '\\'"
        args += "%${escapeLike(value)}%"
      }
      "is_not" -> {
        clauses += "LOWER(COALESCE($expression, '')) <> ?"
        args += value
      }
      else -> {
        clauses += "LOWER(COALESCE($expression, '')) = ?"
        args += value
      }
    }
  }

  private fun appendExact(condition: JSONObject, clauses: MutableList<String>, args: MutableList<Any?>) {
    val negate = condition.optString("operator") == "is_not"
    when (condition.optString("field")) {
      "source_type" -> {
        clauses += "t.source_type ${if (negate) "<>" else "="} ?"
        args += condition.optString("value")
      }
      "favorite" -> {
        val wantsFavorite = condition.optBoolean("value") xor negate
        clauses += "COALESCE(f.is_favorite, 0) = ${if (wantsFavorite) 1 else 0}"
      }
    }
  }

  private fun appendNumeric(condition: JSONObject, clauses: MutableList<String>, args: MutableList<Any?>) {
    val expression = numericFields[condition.optString("field")] ?: return
    val operator = when (condition.optString("operator")) {
      "gte" -> ">="
      "lte" -> "<="
      else -> "="
    }
    clauses += "$expression $operator ?"
    args += condition.optDouble("value")
  }

  private fun appendDate(condition: JSONObject, clauses: MutableList<String>, args: MutableList<Any?>) {
    val field = condition.optString("field")
    val operator = condition.optString("operator")
    if (field == "last_played_at" && operator == "never") {
      clauses += "f.last_played_at IS NULL"
      return
    }
    val cutoff = System.currentTimeMillis() -
      condition.optInt("value", 1).coerceAtLeast(1) * 86_400_000L
    when (field) {
      "last_played_at" -> clauses += if (operator == "within_days") {
        "f.last_played_at >= ?"
      } else {
        "(f.last_played_at IS NULL OR f.last_played_at < ?)"
      }
      "added_at" -> clauses += "t.added_at ${if (operator == "within_days") ">=" else "<"} ?"
      else -> return
    }
    args += cutoff
  }

  private fun escapeLike(value: String): String =
    value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
}
