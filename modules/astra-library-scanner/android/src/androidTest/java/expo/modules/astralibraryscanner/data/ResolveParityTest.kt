package expo.modules.astralibraryscanner.data

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ResolveParityTest {
  private fun corpus() = JSONObject(
    InstrumentationRegistry.getInstrumentation().context.assets.open("resolve/desktop.json")
      .bufferedReader().use { it.readText() },
  )
  private fun JSONArray.objects() = (0 until length()).map(::getJSONObject)
  private fun JSONArray.strings() = (0 until length()).map(::getString)
  private fun JSONObject.names(key: String, jsonKey: String): List<String> =
    optJSONArray(key)?.strings() ?: optString(jsonKey).takeIf { it.isNotEmpty() && it != "null" }?.let { JSONArray(it).strings() }.orEmpty()
  private fun JSONObject.text(key: String): String? = if (has(key) && !isNull(key)) getString(key) else null
  private fun JSONObject.number(key: String): Int? = if (has(key) && !isNull(key)) getInt(key) else null
  private fun credit(row: JSONObject) = ResolveCredit(
    row.optString("artist"), row.text("album"), row.names("artist_names", "artist_names_json"),
    row.text("album_artist"), row.names("album_artist_names", "album_artist_names_json"),
  )

  @Test fun artistIdentitiesMatchDesktop() {
    for ((i, fixture) in corpus().getJSONArray("artists").objects().withIndex()) {
      val tracks = fixture.getJSONArray("tracks").objects().map(::credit)
      val index = ArtistResolve.build(tracks)
      val expected = fixture.getJSONArray("expected")
      tracks.forEachIndexed { n, track ->
        assertEquals("artist case $i track $n", expected.getJSONObject(n).getJSONArray("artists").strings(), ArtistResolve.trackNames(track, index))
        assertEquals("album artist case $i track $n", expected.getJSONObject(n).getJSONArray("albumArtists").strings(), ArtistResolve.trackNames(track, index, true))
      }
    }
    for (fixture in corpus().getJSONArray("credits").objects()) {
      val index = ArtistResolve.build(fixture.getJSONArray("tracks").objects().map(::credit))
      assertEquals(fixture.getJSONArray("expected").strings(), ArtistResolve.resolve(fixture.getString("raw"), index, fixture.text("album")))
    }
  }

  @Test fun albumIdentitiesMatchDesktop() {
    for ((i, fixture) in corpus().getJSONArray("albums").objects().withIndex()) {
      val tracks = fixture.getJSONArray("tracks").objects().map { row ->
        ResolveAlbumTrack(row.getString("id"), credit(row), row.text("base_artwork_hash"),
          row.number("year"), row.number("track_number"), row.number("track_total"), row.number("disc_number"), row.number("disc_total"))
      }
      val actual = AlbumResolve.group(tracks).associate { group -> group.identityKey to listOf(
        group.albumKey, group.mode, group.displayArtist, group.tracks.map { it.id }.sorted(),
      ) }
      val expected = fixture.getJSONArray("expected").objects().associate { group -> group.getString("identityKey") to listOf(
        group.getString("albumKey"), group.getString("mode"), group.getString("displayArtist"), group.getJSONArray("ids").strings().sorted(),
      ) }
      assertEquals("album case $i", expected, actual)
    }
  }
}
