package expo.modules.astrascope

/**
 * Owns one replaceable surface-like resource.
 *
 * Publication holds [lock] for the complete use of the resource. Replacement
 * and teardown therefore wait for an in-flight publication before releasing
 * it, and an eligibility predicate is rechecked only after the lock is held so
 * work cancelled while waiting cannot start against a newer resource.
 */
internal class ScopeSurfaceSession<K : Any, T : Any>(
  private val release: (T) -> Unit
) {
  private data class Entry<K, T>(
    val key: K,
    val resource: T
  )

  private val lock = Any()
  private var current: Entry<K, T>? = null

  @Volatile
  var available: Boolean = false
    private set

  fun replace(key: K, resource: T) {
    synchronized(lock) {
      current?.resource?.let(release)
      current = Entry(key, resource)
      available = true
    }
  }

  /**
   * Releases only the resource belonging to [key]. A delayed destruction
   * callback for an older key cannot tear down a replacement.
   */
  fun close(key: K): Boolean =
    synchronized(lock) {
      val entry = current ?: return@synchronized false
      if (entry.key !== key) return@synchronized false

      closeLocked(entry)
    }

  /**
   * Detach is also a terminal surface boundary, but Android can deliver it
   * before the matching TextureView destruction callback. Explicitly closing
   * the current entry keeps the wrapper out of the runtime cleaner; the later
   * key-specific callback observes an empty session and does nothing.
   */
  fun closeCurrent(): Boolean =
    synchronized(lock) {
      val entry = current ?: return@synchronized false
      closeLocked(entry)
    }

  /**
   * Runs [block] while teardown/replacement is excluded. [eligible] is checked
   * under the same lock immediately before use.
   */
  fun <R> withCurrentIf(
    eligible: () -> Boolean,
    block: (T) -> R
  ): R? =
    synchronized(lock) {
      if (!eligible()) return@synchronized null
      val entry = current ?: return@synchronized null
      block(entry.resource)
    }

  /** Runs [block] against the current resource, serialized with teardown. */
  fun <R> withCurrent(block: (T) -> R): R? =
    synchronized(lock) {
      val entry = current ?: return@synchronized null
      block(entry.resource)
    }

  private fun closeLocked(entry: Entry<K, T>): Boolean {
    current = null
    available = false
    release(entry.resource)
    return true
  }
}
