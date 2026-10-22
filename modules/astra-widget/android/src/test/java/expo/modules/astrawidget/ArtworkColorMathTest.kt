package expo.modules.astrawidget

import java.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The widget's cover colors must match now playing's exactly. Fixtures come
 * from the JS extractor itself: scripts/gen-widget-color-fixtures.mts.
 */
class ArtworkColorMathTest {
  private val fixtures: JSONObject by lazy {
    val stream = javaClass.classLoader!!.getResourceAsStream("artwork-color-fixtures.json")
    JSONObject(stream.bufferedReader().use { it.readText() })
  }

  private fun pixelsOf(base64: String): IntArray =
    Base64.getDecoder().decode(base64).map { it.toInt() and 0xff }.toIntArray()

  private fun JSONArray.strings(): List<String> = (0 until length()).map { getString(it) }

  private fun assertField(name: String, expected: Any, actual: ArtworkColorMath.Field?) {
    if (expected == JSONObject.NULL) {
      assertNull("$name field", actual)
      return
    }
    val field = expected as JSONObject
    assertEquals("$name colors", field.getJSONArray("colors").strings(), actual?.colors)
    assertEquals("$name neutral", field.getBoolean("neutral"), actual?.neutral)
  }

  @Test
  fun coverColorsMatchTheJsExtractor() {
    val cases = fixtures.getJSONArray("cases")
    for (index in 0 until cases.length()) {
      val case = cases.getJSONObject(index)
      val name = case.getString("name")
      val pixels = pixelsOf(case.getString("pixels"))

      val clusters = ArtworkColorMath.clusterArtworkPixels(pixels)
      assertEquals("$name cluster count", case.getInt("clusterCount"), clusters.size)

      val colors = ArtworkColorMath.coverColors(
        pixels,
        fixtures.getString("onAccentDark"),
        fixtures.getString("onAccentLight"),
      )
      assertField("$name dark", case.get("fieldDark"), colors.fieldDark)
      assertField("$name light", case.get("fieldLight"), colors.fieldLight)
      assertEquals("$name accent dark", case.optString("accentDark").takeIf { !case.isNull("accentDark") }, colors.accentDark)
      assertEquals("$name accent light", case.optString("accentLight").takeIf { !case.isNull("accentLight") }, colors.accentLight)
    }
  }

  @Test
  fun oklchToHexMatches() {
    val samples = fixtures.getJSONObject("helpers").getJSONArray("oklch")
    for (index in 0 until samples.length()) {
      val sample = samples.getJSONObject(index)
      assertEquals(
        "oklch #$index",
        sample.getString("hex"),
        ArtworkColorMath.oklchToHex(sample.getDouble("L"), sample.getDouble("chroma"), sample.getDouble("hue")),
      )
    }
  }

  @Test
  fun hexHelpersMatch() {
    val helpers = fixtures.getJSONObject("helpers")
    val mix = helpers.getJSONArray("mix")
    for (index in 0 until mix.length()) {
      val sample = mix.getJSONObject(index)
      assertEquals(
        "mix #$index",
        sample.getString("hex"),
        ArtworkColorMath.mixHex(sample.getString("a"), sample.getString("b"), sample.getDouble("t")),
      )
    }
    val hsl = helpers.getJSONArray("hsl")
    for (index in 0 until hsl.length()) {
      val sample = hsl.getJSONObject(index)
      val (h, s, l) = ArtworkColorMath.hexToHsl(sample.getString("source")).toList()
      assertEquals("hsl h #$index", sample.getDouble("h"), h, 1e-9)
      assertEquals("hsl s #$index", sample.getDouble("s"), s, 1e-9)
      assertEquals("hsl l #$index", sample.getDouble("l"), l, 1e-9)
      assertEquals("hsl back #$index", sample.getString("back"), ArtworkColorMath.hslToHex(h, s, 83.0))
    }
  }

  @Test
  fun contrastLiftMatches() {
    val samples = fixtures.getJSONObject("helpers").getJSONArray("lift")
    for (index in 0 until samples.length()) {
      val sample = samples.getJSONObject(index)
      val surface = ArtworkColorMath.worstFieldSurface(
        sample.getString("background"),
        sample.getJSONArray("field").strings(),
        sample.getDouble("strength"),
        sample.getBoolean("isDark"),
      )
      assertEquals("surface #$index", sample.getString("surface"), surface)
      assertEquals(
        "lift #$index",
        sample.getString("lifted"),
        ArtworkColorMath.liftToContrast(sample.getString("color"), sample.getString("toward"), surface, 4.5),
      )
    }
  }
}
