package expo.modules.astrascope

import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ScopeSurfaceSessionTest {
  @Test
  fun teardownWaitsForAnInFlightPublicationBeforeRelease() {
    val key = Any()
    val released = Collections.synchronizedList(mutableListOf<String>())
    val session = ScopeSurfaceSession<Any, String>(released::add)
    val publicationEntered = CountDownLatch(1)
    val allowPublicationToFinish = CountDownLatch(1)
    val closeStarted = CountDownLatch(1)
    val closeFinished = CountDownLatch(1)
    session.replace(key, "surface")

    val publisher = thread(name = "scope-publisher") {
      session.withCurrentIf(eligible = { true }) {
        publicationEntered.countDown()
        assertTrue(allowPublicationToFinish.await(2, TimeUnit.SECONDS))
      }
    }
    assertTrue(publicationEntered.await(2, TimeUnit.SECONDS))

    val closer = thread(name = "scope-closer") {
      closeStarted.countDown()
      session.close(key)
      closeFinished.countDown()
    }
    assertTrue(closeStarted.await(2, TimeUnit.SECONDS))
    assertFalse(closeFinished.await(100, TimeUnit.MILLISECONDS))

    allowPublicationToFinish.countDown()
    assertTrue(closeFinished.await(2, TimeUnit.SECONDS))
    publisher.join(2_000)
    closer.join(2_000)

    assertEquals(listOf("surface"), released)
    assertFalse(session.available)
  }

  @Test
  fun cancelledPublicationIsRejectedUnderTheSessionLock() {
    val eligible = AtomicBoolean(true)
    val publications = AtomicInteger(0)
    val session = ScopeSurfaceSession<Any, String> {}
    session.replace(Any(), "surface")

    assertEquals(
      "surface",
      session.withCurrentIf(eligible = eligible::get) {
        publications.incrementAndGet()
        it
      }
    )

    eligible.set(false)
    assertNull(
      session.withCurrentIf(eligible = eligible::get) {
        publications.incrementAndGet()
        it
      }
    )
    assertEquals(1, publications.get())
  }

  @Test
  fun staleRenderGenerationCannotUseAReplacementSurface() {
    val firstKey = Any()
    val secondKey = Any()
    val session = ScopeSurfaceSession<Any, String> {}
    val gate = ScopeRenderGate()

    session.replace(firstKey, "first")
    val firstToken = gate.update(true)
    gate.update(false)
    assertTrue(session.close(firstKey))
    session.replace(secondKey, "second")
    val secondToken = gate.update(true)

    assertNull(
      session.withCurrentIf(eligible = { gate.isCurrent(firstToken) }) { it }
    )
    assertEquals(
      "second",
      session.withCurrentIf(eligible = { gate.isCurrent(secondToken) }) { it }
    )
  }

  @Test
  fun replacementAndDelayedCloseReleaseEachSurfaceExactlyOnce() {
    val firstKey = Any()
    val secondKey = Any()
    val released = mutableListOf<String>()
    val session = ScopeSurfaceSession<Any, String>(released::add)

    session.replace(firstKey, "first")
    session.replace(secondKey, "second")
    assertFalse(session.close(firstKey))
    assertTrue(session.closeCurrent())
    assertFalse(session.close(secondKey))
    assertFalse(session.closeCurrent())

    assertEquals(listOf("first", "second"), released)
    assertFalse(session.available)
  }
}
