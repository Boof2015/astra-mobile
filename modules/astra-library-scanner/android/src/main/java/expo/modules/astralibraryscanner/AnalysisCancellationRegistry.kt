package expo.modules.astralibraryscanner

import java.util.concurrent.atomic.AtomicBoolean

/** Cancellation can reach the bridge before the analysis coroutine starts. */
internal class AnalysisCancellationRegistry {
  private val active = mutableMapOf<String, AtomicBoolean>()
  private val early = linkedSetOf<String>()

  @Synchronized fun register(id: String): AtomicBoolean {
    check(!active.containsKey(id)) { "Duplicate analysis attempt" }
    return AtomicBoolean(early.remove(id)).also { active[id] = it }
  }

  @Synchronized fun cancel(id: String) {
    val flag = active[id]
    if (flag != null) flag.set(true)
    else {
      early.add(id)
      // Late cancellation after completion is harmless; bound retained tombstones.
      while (early.size > 256) early.remove(early.first())
    }
  }

  @Synchronized fun finish(id: String, flag: AtomicBoolean) {
    if (active[id] === flag) active.remove(id)
  }
}
