package expo.modules.astracar

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/** One reader at a time; requests during a read collapse into a single follow-up pass. */
internal class AstraCarQueueRefresh(private val scope: CoroutineScope, private val refresh: suspend () -> Boolean) {
  private var job: Job? = null
  private var dirty = false

  fun request(): Job {
    dirty = true
    job?.takeIf { it.isActive }?.let { return it }
    return scope.launch(start = CoroutineStart.LAZY) {
      while (dirty) {
        dirty = false
        if (refresh()) dirty = true // The captured window became obsolete during the read.
      }
    }.also { job = it; it.start() }
  }
}
