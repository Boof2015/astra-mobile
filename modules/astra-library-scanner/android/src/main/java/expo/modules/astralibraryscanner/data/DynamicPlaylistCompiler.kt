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

  private const val MAX_GROUP_DEPTH = 8
  private const val MAX_NODES = 256

  fun compile(rawRules: String?, offset: Int, requestedLimit: Int, now: Long = System.currentTimeMillis()): DynamicQueries {
    require(!rawRules.isNullOrBlank()) { "Dynamic playlist rules are missing." }
    val json = JSONObject(rawRules)
    val version = json.opt("version")
    require(version == 1 || version == 2) { "Dynamic playlist rule version is not supported." }
    val args = mutableListOf<Any?>()
    var nodeCount = 0
    fun compileNode(node: JSONObject, depth: Int): String {
      require(++nodeCount <= MAX_NODES) { "Use at most $MAX_NODES filter nodes." }
      if (node.optString("kind") == "group") {
        require(depth <= MAX_GROUP_DEPTH) { "Use at most $MAX_GROUP_DEPTH group levels." }
        val match = member(node, "match", setOf("all", "any"))
        val children = node.optJSONArray("children") ?: error("Group children must be an array.")
        require(depth == 1 || children.length() > 0) { "Add a filter to each group, or remove the empty group." }
        if (children.length() == 0) return "1 = 1"
        return (0 until children.length()).map { index ->
          compileNode(children.optJSONObject(index) ?: error("Dynamic playlist filter must be an object."), depth + 1)
        }.joinToString(if (match == "all") " AND " else " OR ", "(", ")")
      }
      val clauses = mutableListOf<String>()
      when (member(node, "kind", setOf("text", "exact", "numeric", "date"))) {
        "text" -> appendText(node, clauses, args)
        "exact" -> appendExact(node, clauses, args)
        "numeric" -> appendNumeric(node, clauses, args)
        "date" -> appendDate(node, clauses, args, now)
      }
      return clauses.single()
    }
    val root = if (version == 1) {
      val conditions = json.optJSONArray("conditions") ?: error("Dynamic playlist conditions must be an array.")
      for (index in 0 until conditions.length()) {
        val leaf = conditions.optJSONObject(index) ?: error("Dynamic playlist condition must be an object.")
        require(leaf.optString("kind") != "group") { "Groups require dynamic playlist rules version 2." }
      }
      JSONObject().put("kind", "group").put("match", "all").put("children", conditions)
    } else json.optJSONObject("filter") ?: error("A root filter group is required.")
    require(root.optString("kind") == "group") { "A root filter group is required." }
    val where = compileNode(root, 1)
    val sort = json.optJSONObject("sort")
    val sortExpression = if (sort == null) "t.title_sort_key" else sortFields.getValue(member(sort, "field", sortFields.keys))
    val direction = if (sort == null || member(sort, "direction", setOf("asc", "desc")) == "asc") "ASC" else "DESC"
    val ruleLimit = if (json.has("limit") && !json.isNull("limit")) {
      val value = number(json, "limit")
      require(value >= 1 && value.toInt() <= 5000) { "Result limit must be between 1 and 5000." }
      value.toInt()
    } else 0
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
    val expression = textFields.getValue(member(condition, "field", textFields.keys))
    val rawValue = condition.opt("value")
    require(rawValue is String && rawValue.trim().isNotEmpty()) { "Text value is required." }
    val value = rawValue.trim().lowercase(Locale.ROOT)
    when (member(condition, "operator", setOf("contains", "is", "is_not"))) {
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
    val negate = member(condition, "operator", setOf("is", "is_not")) == "is_not"
    when (member(condition, "field", setOf("source_type", "favorite"))) {
      "source_type" -> {
        clauses += "t.source_type ${if (negate) "<>" else "="} ?"
        args += member(condition, "value", setOf("local", "subsonic", "jellyfin"))
      }
      "favorite" -> {
        val value = condition.opt("value")
        require(value is Boolean) { "Favorite value must be true or false." }
        val wantsFavorite = value xor negate
        clauses += "COALESCE(f.is_favorite, 0) = ${if (wantsFavorite) 1 else 0}"
      }
    }
  }

  private fun appendNumeric(condition: JSONObject, clauses: MutableList<String>, args: MutableList<Any?>) {
    val expression = numericFields.getValue(member(condition, "field", numericFields.keys))
    val operator = when (member(condition, "operator", setOf("eq", "gte", "lte"))) {
      "gte" -> ">="
      "lte" -> "<="
      else -> "="
    }
    clauses += "$expression $operator ?"
    val value = number(condition, "value")
    args += if (condition.optString("field") == "year") value.toLong().toDouble() else value
  }

  private fun appendDate(condition: JSONObject, clauses: MutableList<String>, args: MutableList<Any?>, now: Long) {
    val field = member(condition, "field", setOf("last_played_at", "added_at"))
    val operator = member(condition, "operator", if (field == "last_played_at") setOf("never", "within_days", "not_within_days") else setOf("within_days", "older_than_days"))
    if (field == "last_played_at" && operator == "never") {
      clauses += "f.last_played_at IS NULL"
      return
    }
    val days = number(condition, "value")
    require(days >= 1) { "Day value must be a positive number." }
    val cutoff = now - days.toLong() * 86_400_000L
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

  private fun member(json: JSONObject, key: String, allowed: Set<String>): String {
    val value = json.opt(key)
    require(value is String && value in allowed) { "$key is not supported." }
    return value
  }

  private fun number(json: JSONObject, key: String): Double {
    val raw = json.opt(key)
    val value = when (raw) {
      is Number -> raw.toDouble()
      is String -> raw.toDoubleOrNull()
      else -> null
    }
    require(value != null && value.isFinite()) { "$key must be a number." }
    return value
  }

  private fun escapeLike(value: String): String =
    value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
}
