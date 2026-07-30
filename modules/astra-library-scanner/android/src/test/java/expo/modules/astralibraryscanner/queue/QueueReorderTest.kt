package expo.modules.astralibraryscanner.queue

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QueueReorderTest {
  @Test
  fun `moving down lands the item at the target index`() {
    val items = mutableListOf("A", "B", "C", "D", "E")

    assertTrue(QueueReorder.applyMove(items, from = 0, to = 2))

    assertEquals(listOf("B", "C", "A", "D", "E"), items)
    assertEquals(2, items.indexOf("A"))
  }

  @Test
  fun `moving up lands the item at the target index`() {
    val items = mutableListOf("A", "B", "C", "D", "E")

    assertTrue(QueueReorder.applyMove(items, from = 3, to = 1))

    assertEquals(listOf("A", "D", "B", "C", "E"), items)
    assertEquals(1, items.indexOf("D"))
  }

  @Test
  fun `dragging the last row to the front puts it at position zero`() {
    val items = mutableListOf("A", "B", "C", "D", "E")

    assertTrue(QueueReorder.applyMove(items, from = 4, to = 0))

    assertEquals(listOf("E", "A", "B", "C", "D"), items)
  }

  @Test
  fun `dragging the first row to the end puts it last`() {
    val items = mutableListOf("A", "B", "C", "D", "E")

    assertTrue(QueueReorder.applyMove(items, from = 0, to = 4))

    assertEquals(listOf("B", "C", "D", "E", "A"), items)
  }

  @Test
  fun `every destination index is reachable in both directions`() {
    // The whole point of the contract: `to` is the final index, no off-by-one
    // depending on travel direction.
    for (from in 0..4) {
      for (to in 0..4) {
        val items = mutableListOf("A", "B", "C", "D", "E")
        val moved = items[from]
        val changed = QueueReorder.applyMove(items, from, to)

        assertEquals(from != to, changed)
        assertEquals("from=$from to=$to", to, items.indexOf(moved))
        assertEquals("from=$from to=$to", 5, items.size)
        assertEquals("from=$from to=$to", setOf("A", "B", "C", "D", "E"), items.toSet())
      }
    }
  }

  @Test
  fun `out of range and no-op moves leave the list untouched`() {
    val items = mutableListOf("A", "B", "C")

    assertFalse(QueueReorder.applyMove(items, from = -1, to = 1))
    assertFalse(QueueReorder.applyMove(items, from = 1, to = 9))
    assertFalse(QueueReorder.applyMove(items, from = 1, to = 1))

    assertEquals(listOf("A", "B", "C"), items)
  }

  @Test
  fun `adapter indices translate to queue positions after the active row`() {
    assertEquals(6L, QueueReorder.queuePosition(activePosition = 5L, adapterIndex = 0))
    assertEquals(9L, QueueReorder.queuePosition(activePosition = 5L, adapterIndex = 3))
    // Nothing is playing yet: the first upcoming row is position zero.
    assertEquals(0L, QueueReorder.queuePosition(activePosition = -1L, adapterIndex = 0))
  }

  @Test
  fun `queue positions translate back to adapter indices`() {
    for (adapterIndex in 0..64) {
      val position = QueueReorder.queuePosition(activePosition = 5L, adapterIndex = adapterIndex)
      assertEquals(adapterIndex, QueueReorder.adapterIndex(activePosition = 5L, queuePosition = position))
    }
  }

  @Test
  fun `the active row and everything before it are not upcoming`() {
    assertEquals(-1, QueueReorder.adapterIndex(activePosition = 5L, queuePosition = 5L))
    assertEquals(-1, QueueReorder.adapterIndex(activePosition = 5L, queuePosition = 0L))
  }
}
