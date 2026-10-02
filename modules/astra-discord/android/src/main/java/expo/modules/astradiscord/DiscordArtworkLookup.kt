package expo.modules.astradiscord

import org.json.JSONArray
import org.json.JSONObject

internal fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
internal fun JSONObject.string(key: String): String = if (isNull(key)) "" else optString(key, "").trim()

/** Provider order and matching follow desktop; fetch is injected for fixture tests. */
class DiscordArtworkLookup(private val fetch: (String) -> JSONObject?) {
  fun resolve(query: DiscordArtworkQuery): DiscordArtworkResult {
    val artists = DiscordArtworkPolicy.artists(query).ifEmpty { listOf("") }
    val albums = DiscordArtworkPolicy.albums(query)
    if (albums.isEmpty()) return DiscordArtworkResult("not-found")
    var failed = false
    fun request(url: String): JSONObject? = try { fetch(url) } catch (error: java.io.IOException) {
      failed = true; null
    } catch (error: org.json.JSONException) { failed = true; null }
    fun array(json: JSONObject?, field: String): List<JSONObject> {
      if (json == null) return emptyList()
      if (!json.has(field)) { failed = true; return emptyList() }
      val entries = json.optJSONArray(field)
      if (entries == null && !(field == "album" && json.isNull(field))) failed = true
      return entries?.objects().orEmpty()
    }
    fun itunes(term: String, entity: String): String? {
      val entries = array(request("https://itunes.apple.com/search?term=${DiscordPresentation.encode(term)}&media=music&entity=$entity&limit=12"), "results")
      return DiscordArtworkPolicy.choose(entries.map {
        val art = it.string("artworkUrl100").ifEmpty { it.string("artworkUrl60") }
          .replace(Regex("/\\d+x\\d+bb\\."), "/600x600bb.")
        DiscordCoverCandidate(it.string("collectionName"), it.string("artistName"), art, it.string("trackName"))
      }, query, entity == "song")
    }
    for (album in albums.take(2)) for (artist in artists) {
      itunes("$album $artist".trim(), "album")?.let { return DiscordArtworkResult("found", it, "iTunes") }
    }
    if (query.title.isNotBlank()) for (artist in artists) {
      itunes("${query.title} $artist".trim(), "song")?.let { return DiscordArtworkResult("found", it, "iTunes") }
    }

    fun quoted(value: String) = value.replace("\\", "\\\\").replace("\"", "\\\"")
    for (album in albums.take(2)) {
      val artist = artists.first()
      val expression = "release:\"${quoted(album)}\"" + if (artist.isNotEmpty()) " AND artist:\"${quoted(artist)}\"" else ""
      val releases = array(request("https://musicbrainz.org/ws/2/release?query=${DiscordPresentation.encode(expression)}&fmt=json&limit=5"), "releases")
        .map { release ->
          val credit = release.optJSONArray("artist-credit")?.objects()?.joinToString(" ") {
            it.string("name").ifEmpty { it.optJSONObject("artist")?.string("name").orEmpty() }
          }.orEmpty()
          release to DiscordArtworkPolicy.score(DiscordCoverCandidate(release.string("title"), credit, ""), query)
        }.filter { it.second > 0 }.sortedByDescending { it.second }
      for ((release, _) in releases.take(3)) {
        val id = release.string("id").takeIf { it.matches(Regex("[a-fA-F0-9-]{36}")) } ?: continue
        val images = array(request("https://coverartarchive.org/release/$id"), "images")
        val front = images.firstOrNull { it.optBoolean("front") } ?: images.firstOrNull()
        val art = front?.optJSONObject("thumbnails")?.let { it.string("500").ifEmpty { it.string("large") } }
          ?.ifEmpty { front.string("image") } ?: front?.string("image")
        art?.let(DiscordArtworkPolicy::publicImage)?.let { return DiscordArtworkResult("found", it, "Cover Art Archive") }
      }
    }

    for (artist in artists.filter { it.isNotBlank() }) {
      val album = query.album.ifBlank { query.title }
      val entries = array(request("https://www.theaudiodb.com/api/v1/json/2/searchalbum.php?s=${DiscordPresentation.encode(artist)}&a=${DiscordPresentation.encode(album)}"), "album")
      val art = DiscordArtworkPolicy.choose(entries.map {
        DiscordCoverCandidate(it.string("strAlbum"), it.string("strArtist"), it.string("strAlbumThumb"))
      }, query)
      if (art != null) return DiscordArtworkResult("found", art, "TheAudioDB")
    }
    return DiscordArtworkResult(if (failed) "unavailable" else "not-found")
  }
}
