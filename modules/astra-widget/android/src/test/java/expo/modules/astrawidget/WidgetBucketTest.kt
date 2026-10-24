package expo.modules.astrawidget

import expo.modules.astrawidget.AstraWidgetUpdater.Family
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The launcher can show a bucket at exactly its minimum size, so every
 * declared layout must fit there. A play button cut off at the bottom of the
 * narrow 4×3 (device pass, 2026-10-22) was a deck sized for its art and not for
 * its contents.
 */
class WidgetBucketTest {
  private val buckets = AstraWidgetUpdater.BUCKETS

  private fun Boolean.label() = if (this) "with recents" else "without recents"

  @Test
  fun platformCapIsRespected() {
    assertTrue("${buckets.size} buckets", buckets.size <= 16)
  }

  @Test
  fun columnsBesideTheArtFitTheirHeight() {
    for (bucket in buckets.filter { it.family == Family.CARD }) {
      val play = bucket.playDp(true)
      val need = AstraWidgetUpdater.columnNeed(bucket.showEyebrow(true), bucket.titleLines(true), play)
      assertTrue("card ${bucket.widthDp}×${bucket.heightDp}: needs $need of ${bucket.contentHeight}", need <= bucket.contentHeight)
    }
    for (bucket in buckets.filter { it.family == Family.LARGE }) {
      for (recents in listOf(true, false)) {
        val play = bucket.playDp(recents)
        val need = AstraWidgetUpdater.columnNeed(bucket.showEyebrow(recents), bucket.titleLines(recents), play)
        val deck = bucket.deckArt(recents)
        assertTrue("large ${bucket.widthDp}×${bucket.heightDp} ${recents.label()}: needs $need of $deck", need <= deck)
      }
    }
  }

  @Test
  fun buttonRowsFitBesideTheArt() {
    for (bucket in buckets.filter { it.family == Family.CARD }) {
      val play = bucket.playDp(true)
      val column = bucket.contentWidth - (bucket.artCap ?: 0) - 14
      assertTrue("card ${bucket.widthDp}: buttons need ${80 + 12 + play} of $column", 80 + 12 + play <= column)
    }
    for (bucket in buckets.filter { it.family == Family.LARGE }) {
      for (recents in listOf(true, false)) {
        val play = bucket.playDp(recents)
        val column = bucket.contentWidth - bucket.deckArt(recents) - 14
        assertTrue("large ${bucket.widthDp} ${recents.label()}: buttons need ${80 + 12 + play} of $column", 80 + 12 + play <= column)
      }
    }
  }

  @Test
  fun sideButtonColumnFitsItsBand() {
    for (bucket in buckets.filter { it.family == Family.SQUARE_SIDE }) {
      val column = when (bucket.sideButtons) { 3 -> 136; 2 -> 92; else -> 48 }
      assertTrue("side ${bucket.widthDp}×${bucket.heightDp}: column $column of ${bucket.sideBand}", column <= bucket.sideBand)
      assertEquals(bucket.sideButtons >= 2, bucket.showNext)
      assertEquals(bucket.sideButtons == 3, bucket.showPrevious)
    }
  }

  @Test
  fun stackedArtKeepsRoom() {
    for (bucket in buckets.filter { it.family == Family.SQUARE_STACKED }) {
      // Text with its gap above, then a 10dp gap and the 48dp button row.
      val band = bucket.contentHeight - (AstraWidgetUpdater.SQUARE_TEXT_DP + 10 + 48)
      assertTrue("stacked ${bucket.widthDp}×${bucket.heightDp}: art band $band", band >= 96)
    }
  }

  /**
   * Every render sets the play button's size (the launcher reuses the view it
   * has, so a compact size would otherwise stick), so outside compact cards and
   * decks it must be the layout's own.
   */
  @Test
  fun playSizesMatchTheLayouts() {
    val layouts = mapOf(
      Family.STRIP to "astra_widget_strip",
      Family.SQUARE_SIDE to "astra_widget_square_side",
      Family.SQUARE_STACKED to "astra_widget_square_stacked",
      Family.CARD to "astra_widget_card",
      Family.LARGE to "astra_widget_large",
    )
    val playWidth = Regex("""astra_widget_play_pause"\s+android:layout_width="(\d+)dp"""")
    for (bucket in buckets) {
      val xml = File("src/main/res/layout/${layouts.getValue(bucket.family)}.xml").readText()
      val declared = playWidth.find(xml)!!.groupValues[1].toInt()
      for (recents in listOf(true, false)) {
        if (bucket.titleLines(recents) == 1) continue
        assertEquals("${bucket.family} ${bucket.widthDp}×${bucket.heightDp} ${recents.label()}", declared, bucket.playDp(recents))
      }
    }
  }

  @Test
  fun stripArtIsNeverSqueezedOut() {
    for (bucket in buckets.filter { it.family == Family.STRIP }) {
      assertTrue("strip ${bucket.widthDp}: art cap ${bucket.artCap}", (bucket.artCap ?: 0) >= 48)
    }
  }
}
