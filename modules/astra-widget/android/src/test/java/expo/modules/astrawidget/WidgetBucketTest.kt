package expo.modules.astrawidget

import expo.modules.astrawidget.AstraWidgetUpdater.Family
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
      val play = bucket.playDp(true) ?: 52
      val need = AstraWidgetUpdater.columnNeed(bucket.showEyebrow(true), bucket.titleLines(true), play)
      assertTrue("card ${bucket.widthDp}×${bucket.heightDp}: needs $need of ${bucket.contentHeight}", need <= bucket.contentHeight)
    }
    for (bucket in buckets.filter { it.family == Family.LARGE }) {
      for (recents in listOf(true, false)) {
        val play = bucket.playDp(recents) ?: 52
        val need = AstraWidgetUpdater.columnNeed(bucket.showEyebrow(recents), bucket.titleLines(recents), play)
        val deck = bucket.deckArt(recents)
        assertTrue("large ${bucket.widthDp}×${bucket.heightDp} ${recents.label()}: needs $need of $deck", need <= deck)
      }
    }
  }

  @Test
  fun buttonRowsFitBesideTheArt() {
    for (bucket in buckets.filter { it.family == Family.CARD }) {
      val play = bucket.playDp(true) ?: 52
      val column = bucket.contentWidth - (bucket.artCap ?: 0) - 14
      assertTrue("card ${bucket.widthDp}: buttons need ${80 + 12 + play} of $column", 80 + 12 + play <= column)
    }
    for (bucket in buckets.filter { it.family == Family.LARGE }) {
      for (recents in listOf(true, false)) {
        val play = bucket.playDp(recents) ?: 52
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

  @Test
  fun stripArtIsNeverSqueezedOut() {
    for (bucket in buckets.filter { it.family == Family.STRIP }) {
      assertTrue("strip ${bucket.widthDp}: art cap ${bucket.artCap}", (bucket.artCap ?: 0) >= 48)
    }
  }
}
