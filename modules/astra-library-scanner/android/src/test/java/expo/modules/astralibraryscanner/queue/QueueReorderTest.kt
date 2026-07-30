package expo.modules.astralibraryscanner.queue

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
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

  // --- SQL position arithmetic -------------------------------------------------
  //
  // These simulate the statements the DAO issues against an in-memory row set,
  // and assert two things: the end state is dense and matches the plain list
  // semantics above, and no intermediate step ever puts two rows on the same
  // position — which is exactly what the unique (session_id, position) index
  // would reject.

  /** (entryId, position), mirroring playback_queue_entries. */
  private fun rows(count: Int): MutableList<Pair<Long, Long>> =
    (0 until count).mapTo(mutableListOf()) { (100L + it) to it.toLong() }

  private fun applyShift(rows: MutableList<Pair<Long, Long>>, shift: QueueShift) {
    rows.forEachIndexed { index, (id, position) ->
      if (position >= shift.fromPosition && position <= shift.toPosition) {
        rows[index] = id to (position + shift.delta)
      }
    }
    assertNoCollision(rows)
  }

  private fun setPosition(rows: MutableList<Pair<Long, Long>>, entryId: Long, position: Long) {
    rows[rows.indexOfFirst { it.first == entryId }] = entryId to position
    assertNoCollision(rows)
  }

  private fun assertNoCollision(rows: List<Pair<Long, Long>>) {
    val positions = rows.map { it.second }
    assertEquals(
      "two rows share a position — the unique index would reject this",
      positions.size,
      positions.toSet().size,
    )
  }

  private fun orderedIds(rows: List<Pair<Long, Long>>): List<Long> =
    rows.sortedBy { it.second }.map { it.first }

  private fun assertDense(rows: List<Pair<Long, Long>>) {
    assertEquals(
      (0 until rows.size).map(Int::toLong),
      rows.map { it.second }.sorted(),
    )
  }

  private fun removeAndCompact(count: Int, removed: List<Long>): List<Long> {
    val live = rows(count)
    val expected = orderedIds(live).filterIndexed { index, _ -> index.toLong() !in removed }

    live.removeAll { it.second in removed }
    val park = QueueReorder.compactionShifts(removed)
    applyShift(live, QueueShift(removed.min(), Long.MAX_VALUE, QUEUE_PARK_OFFSET))
    park.forEach { applyShift(live, it) }

    assertDense(live)
    return orderedIds(live).also { assertEquals(expected, it) }
  }

  @Test
  fun `removing one row in the middle compacts the rest`() {
    removeAndCompact(count = 8, removed = listOf(3L))
  }

  @Test
  fun `removing the first and last rows compacts correctly`() {
    removeAndCompact(count = 8, removed = listOf(0L))
    removeAndCompact(count = 8, removed = listOf(7L))
  }

  @Test
  fun `removing several rows at once compacts by a deepening offset`() {
    removeAndCompact(count = 12, removed = listOf(2L, 5L, 6L, 9L))
  }

  @Test
  fun `removing adjacent rows leaves no empty segment behind`() {
    removeAndCompact(count = 6, removed = listOf(1L, 2L, 3L))
  }

  @Test
  fun `every single-row removal in a queue compacts densely`() {
    for (position in 0L until 10L) {
      removeAndCompact(count = 10, removed = listOf(position))
    }
  }

  @Test
  fun `the move plan reproduces applyMove for every source and destination`() {
    val size = 7
    for (from in 0 until size) {
      for (to in 0 until size) {
        val live = rows(size)
        val movedId = 100L + from
        val expected = orderedIds(live).toMutableList()
        val changed = QueueReorder.applyMove(expected, from, to)

        val plan = QueueReorder.movePlan(from.toLong(), to.toLong())
        assertEquals("from=$from to=$to", changed, plan != null)
        if (plan == null) continue

        setPosition(live, movedId, plan.parkedMovedPosition)
        plan.spanOut?.let { applyShift(live, it) }
        plan.spanBack?.let { applyShift(live, it) }
        setPosition(live, movedId, plan.finalPosition)

        assertDense(live)
        assertEquals("from=$from to=$to", expected, orderedIds(live))
      }
    }
  }

  @Test
  fun `moving to position zero does not collide with the parked row`() {
    val live = rows(5)
    val plan = QueueReorder.movePlan(4L, 0L)!!

    setPosition(live, 104L, plan.parkedMovedPosition)
    plan.spanOut?.let { applyShift(live, it) }
    plan.spanBack?.let { applyShift(live, it) }
    setPosition(live, 104L, plan.finalPosition)

    assertDense(live)
    assertEquals(listOf(104L, 100L, 101L, 102L, 103L), orderedIds(live))
  }

  @Test
  fun `a no-op move produces no plan`() {
    assertNull(QueueReorder.movePlan(3L, 3L))
    assertNull(QueueReorder.movePlan(-1L, 2L))
  }

  // --- write-plan detection ----------------------------------------------------
  //
  // Mis-classification here would persist a wrong order, so the bar is that every
  // recognised plan must reproduce `after` exactly when executed, and anything
  // not positively recognised must fall back to Rebuild.

  private fun keys(vararg ids: Long): List<QueueRowKey> =
    ids.mapIndexed { index, id -> QueueRowKey(id, "track-$id", index.toLong()) }

  private fun keysOf(ids: List<Long>): List<QueueRowKey> = keys(*ids.toLongArray())

  /** Runs a plan against the simulated table and returns the resulting id order. */
  private fun execute(before: List<QueueRowKey>, plan: QueueWritePlan): List<Long> {
    val live = before.mapTo(mutableListOf()) { it.entryId to it.position }
    when (plan) {
      is QueueWritePlan.Removal -> {
        live.removeAll { (id, _) -> id in plan.removedIds }
        applyShift(live, QueueShift(plan.removedPositions.min(), Long.MAX_VALUE, QUEUE_PARK_OFFSET))
        QueueReorder.compactionShifts(plan.removedPositions).forEach { applyShift(live, it) }
      }
      is QueueWritePlan.Move -> {
        val movePlan = QueueReorder.movePlan(plan.from, plan.to)!!
        setPosition(live, plan.entryId, movePlan.parkedMovedPosition)
        movePlan.spanOut?.let { applyShift(live, it) }
        movePlan.spanBack?.let { applyShift(live, it) }
        setPosition(live, plan.entryId, movePlan.finalPosition)
      }
      QueueWritePlan.NoChange, QueueWritePlan.Rebuild -> Unit
    }
    assertDense(live)
    return orderedIds(live)
  }

  @Test
  fun `every single removal is detected and executes to the right order`() {
    val ids = listOf(10L, 11L, 12L, 13L, 14L, 15L)
    for (dropped in ids) {
      val before = keysOf(ids)
      val after = keysOf(ids - dropped)
      val plan = QueueReorder.planWrite(before, after)

      assertTrue("dropping $dropped -> $plan", plan is QueueWritePlan.Removal)
      assertEquals("dropping $dropped", ids - dropped, execute(before, plan))
    }
  }

  @Test
  fun `a multi-row removal is detected and executes to the right order`() {
    val ids = listOf(10L, 11L, 12L, 13L, 14L, 15L, 16L)
    val dropped = setOf(11L, 12L, 15L)
    val before = keysOf(ids)
    val after = keysOf(ids.filterNot(dropped::contains))

    val plan = QueueReorder.planWrite(before, after)

    assertTrue(plan is QueueWritePlan.Removal)
    assertEquals(ids.filterNot(dropped::contains), execute(before, plan))
  }

  @Test
  fun `every single move is detected and executes to the right order`() {
    val ids = listOf(10L, 11L, 12L, 13L, 14L, 15L)
    for (from in ids.indices) {
      for (to in ids.indices) {
        if (from == to) continue
        val expected = ids.toMutableList()
        QueueReorder.applyMove(expected, from, to)
        val before = keysOf(ids)
        val plan = QueueReorder.planWrite(before, keysOf(expected))

        assertTrue("from=$from to=$to -> $plan", plan is QueueWritePlan.Move)
        assertEquals("from=$from to=$to", expected, execute(before, plan))
      }
    }
  }

  @Test
  fun `an unchanged order is detected as NoChange`() {
    val ids = listOf(10L, 11L, 12L)
    assertEquals(QueueWritePlan.NoChange, QueueReorder.planWrite(keysOf(ids), keysOf(ids)))
  }

  @Test
  fun `shapes that are not a plain removal or single move fall back to Rebuild`() {
    val ids = listOf(10L, 11L, 12L, 13L, 14L)

    // A shuffle.
    assertEquals(
      QueueWritePlan.Rebuild,
      QueueReorder.planWrite(keysOf(ids), keysOf(listOf(13L, 10L, 14L, 11L, 12L))),
    )
    // Two independent swaps — not expressible as one relocation.
    assertEquals(
      QueueWritePlan.Rebuild,
      QueueReorder.planWrite(keysOf(ids), keysOf(listOf(11L, 10L, 13L, 12L, 14L))),
    )
    // An insertion.
    assertEquals(
      QueueWritePlan.Rebuild,
      QueueReorder.planWrite(keysOf(ids), keysOf(ids + 99L)),
    )
    // A removal that also reorders the survivors.
    assertEquals(
      QueueWritePlan.Rebuild,
      QueueReorder.planWrite(keysOf(ids), keysOf(listOf(14L, 11L, 12L, 13L))),
    )
  }

  @Test
  fun `a survivor whose track path changed is not treated as a plain removal`() {
    val before = keys(10L, 11L, 12L)
    val after = listOf(
      QueueRowKey(10L, "track-10", 0L),
      QueueRowKey(12L, "replaced", 1L),
    )

    assertEquals(QueueWritePlan.Rebuild, QueueReorder.planWrite(before, after))
  }

  @Test
  fun `a non-dense before list falls back to Rebuild`() {
    val sparse = listOf(
      QueueRowKey(10L, "track-10", 0L),
      QueueRowKey(11L, "track-11", 5L),
    )

    assertEquals(QueueWritePlan.Rebuild, QueueReorder.planWrite(sparse, keys(10L)))
  }
}
