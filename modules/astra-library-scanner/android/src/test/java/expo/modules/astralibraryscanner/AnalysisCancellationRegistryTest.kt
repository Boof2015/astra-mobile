package expo.modules.astralibraryscanner

import org.junit.Assert.*
import org.junit.Test

class AnalysisCancellationRegistryTest {
  @Test fun cancellationBeforeRegistrationIsRetained() {
    val registry = AnalysisCancellationRegistry()
    registry.cancel("a-1")
    assertTrue(registry.register("a-1").get())
  }
  @Test fun oldAttemptCannotCancelNewAttemptForTheSameTrack() {
    val registry = AnalysisCancellationRegistry()
    val first = registry.register("a-1")
    registry.cancel("a-1"); registry.finish("a-1", first)
    val second = registry.register("a-2")
    registry.cancel("a-1")
    assertFalse(second.get())
    registry.cancel("a-2"); assertTrue(second.get())
  }
}
