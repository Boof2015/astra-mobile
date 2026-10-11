package expo.modules.astralibraryscanner.data

import kotlin.random.Random

internal data class AmbientCandidate(val identityKey: String, val reasons: Set<String>)
internal data class AmbientSelection(val identityKey: String, val reason: String, val reset: Boolean)

/** Choose the kind of moment before the album, so a large related catalog cannot
 * crowd out the rest of the collection. Missing contexts become collection picks. */
internal object TvAmbientSelection {
  private val weights = listOf(
    "collection" to 60, "related" to 8, "favorite" to 10,
    "forgotten" to 8, "added" to 6, "repeat" to 8,
  )

  fun pick(
    albums: List<AmbientCandidate>, excluded: List<String>, random: Random = Random.Default,
  ): AmbientSelection? {
    if (albums.isEmpty()) return null
    val seen = excluded.toHashSet()
    val unseen = albums.filter { it.identityKey !in seen }
    val reset = unseen.isEmpty()
    val pool = if (!reset) unseen else albums.filter { it.identityKey != excluded.lastOrNull() }.ifEmpty { albums }
    var ticket = random.nextInt(weights.sumOf { it.second })
    val reason = weights.first { (_, weight) ->
      if (ticket < weight) true else { ticket -= weight; false }
    }.first
    val contextual = if (reason == "collection") emptyList() else pool.filter { reason in it.reasons }
    val chosen = (contextual.ifEmpty { pool }).random(random)
    return AmbientSelection(chosen.identityKey, if (contextual.isEmpty()) "collection" else reason, reset)
  }
}
