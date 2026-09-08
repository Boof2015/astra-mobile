package expo.modules.astracar

import org.junit.Assert.*
import org.junit.Test

class AstraCarPaginationTest {
  @Test fun lettersFollowRealBoundariesAndKeepDenseLettersTogether() {
    val groups = AstraCarPagination.letters(listOf("D" to 20L, "C" to 20L, "B" to 20L, "A" to 20L, "E" to 150L, "F" to 5L, "#" to 3L))
    assertEquals(listOf("0–9 & other", "A–D", "E", "F"), groups.map { it.title })
    assertEquals(listOf(3L, 80L, 150L, 5L), groups.map { it.count })
    assertEquals(listOf("A", "B"), AstraCarPagination.letters(listOf("A" to 70L, "B" to 70L)).map { it.title })
  }

  @Test fun queueStartsAtTheCurrentSongAndRetainsTheTail() {
    assertEquals(AstraCarPagination.Range(650, 30), AstraCarPagination.queueWindow(650, 1000))
    assertEquals(AstraCarPagination.Range(990, 10), AstraCarPagination.queueWindow(990, 1000))
    assertEquals(AstraCarPagination.Range(0, 0), AstraCarPagination.queueWindow(0, 0))
  }

  @Test fun contentRangesNameTheirSongsAndReserveSpaceForShortcuts() {
    assertEquals("Across the Universe … Atlas", AstraCarPagination.contentTitle("Across the Universe", "Atlas"))
    assertEquals("Same title", AstraCarPagination.contentTitle("Same title", "Same title"))
    assertTrue(AstraCarPagination.ranges(0, 10_000, 99).size <= 99)
  }

  @Test fun largeLibrariesHaveNoCutoffAndEveryFolderIsBounded() {
    for (count in listOf(101L, 501L, 10_001L, 100_000L, 1_000_001L)) {
      fun visit(offset: Long, total: Long): Long {
        if (total <= 100) return total
        val ranges = AstraCarPagination.ranges(offset, total)
        assertTrue(ranges.size <= 100)
        assertEquals(offset, ranges.first().offset)
        assertEquals(offset + total, ranges.last().let { it.offset + it.size })
        ranges.zipWithNext().forEach { (a, b) -> assertEquals(a.offset + a.size, b.offset) }
        return ranges.sumOf { visit(it.offset, it.size) }
      }
      assertEquals(count, visit(0, count))
    }
  }
  @Test fun rangesRetainAbsoluteOffsetsAndHandleEmptyInput() {
    assertEquals(listOf(AstraCarPagination.Range(500, 100), AstraCarPagination.Range(600, 25)), AstraCarPagination.ranges(500, 125))
    assertTrue(AstraCarPagination.ranges(0, 0).isEmpty())
    assertTrue(AstraCarPagination.ranges(-1, 100).isEmpty())
  }
}
