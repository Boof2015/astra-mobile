package expo.modules.astralibraryscanner.data

import android.icu.text.Collator
import java.util.Locale

// Behavioral port of desktop src/shared/library/albumGrouping.ts at 565a451.
internal data class ResolveAlbumTrack(
  val id: String,
  val credit: ResolveCredit,
  val artwork: String? = null,
  val year: Int? = null,
  val trackNumber: Int? = null,
  val trackTotal: Int? = null,
  val discNumber: Int? = null,
  val discTotal: Int? = null,
)

internal data class ResolvedAlbum(
  val identityKey: String,
  val albumKey: String,
  val mode: String,
  val displayArtist: String,
  val tracks: MutableList<ResolveAlbumTrack> = mutableListOf(),
)

internal object AlbumResolve {
  private data class Prepared(
    val track: ResolveAlbumTrack,
    val albumKey: String,
    val owner: String,
    val primary: String,
    val primaryKey: String,
    val creditKeys: List<String>,
    val artwork: String?,
  )
  private data class OwnerPartition(val key: String, val display: String, val tracks: MutableList<Prepared>)
  private fun key(album: String, discriminator: String) = "album:$album::$discriminator"
  private fun totalsCompatible(tracks: List<Prepared>): Boolean {
    val discTotals = hashSetOf<Int>()
    val totalsByDisc = hashMapOf<Int, Int>()
    val unknownDiscTotals = hashSetOf<Int>()
    for ((track) in tracks) {
      track.discTotal?.let(discTotals::add)
      val total = track.trackTotal ?: continue
      val disc = track.discNumber
      if (disc == null || disc < 1) unknownDiscTotals += total
      else {
        val previous = totalsByDisc[disc]
        if (previous != null && previous != total) return false
        totalsByDisc[disc] = total
      }
    }
    if (discTotals.size > 1 || unknownDiscTotals.size > 1) return false
    val unknownTotal = unknownDiscTotals.firstOrNull() ?: return true
    return totalsByDisc.values.all { it == unknownTotal }
  }
  private fun strictlyCompatible(tracks: List<Prepared>): Boolean {
    if (!totalsCompatible(tracks)) return false
    val years = tracks.mapNotNull { it.track.year }
    return years.isEmpty() || years.max().toLong() - years.min() <= 1
  }
  private fun compatible(tracks: List<Prepared>): Boolean {
    if (!totalsCompatible(tracks)) return false
    val years = tracks.mapNotNull { it.track.year }.distinct()
    val disputed = years.filter { year -> years.any { kotlin.math.abs(year.toLong() - it) > 1 } }
    if (disputed.isEmpty()) return true
    if (!coherent(tracks)) return false
    // Each disputed date needs its own numbered evidence; undated tracks cannot supply it.
    if (!disputed.all { year -> tracks.any { it.track.year == year && it.track.trackNumber != null } }) return false
    val owners = tracks.map { ArtistResolve.artistKey(it.owner) }.toSet()
    if (owners.size == 1 && "" !in owners) return true
    if (owners.count(String::isNotEmpty) > 1) return false
    val artwork = sharedArtwork(tracks) ?: return false
    return disputed.all { year -> tracks.any { it.track.year == year && it.artwork == artwork } }
  }
  private fun mergePartitions(
    partitions: List<MutableList<Prepared>>,
    accepts: (List<Prepared>) -> Boolean = ::compatible,
  ): MutableList<MutableList<Prepared>> {
    val neighbors = partitions.map { linkedSetOf<Int>() }
    for (left in partitions.indices) for (right in left + 1 until partitions.size) {
      if (accepts(partitions[left] + partitions[right])) {
        neighbors[left] += right
        neighbors[right] += left
      }
    }
    val visited = hashSetOf<Int>()
    val merged = mutableListOf<MutableList<Prepared>>()
    for (start in partitions.indices) {
      if (!visited.add(start)) continue
      val component = mutableListOf(start)
      var cursor = 0
      while (cursor < component.size) {
        for (neighbor in neighbors[component[cursor++]]) if (visited.add(neighbor)) component += neighbor
      }
      val combined = component.flatMap { partitions[it] }.toMutableList()
      // A conflicting component stays separate; never choose an arbitrary subset of joins.
      if (accepts(combined)) merged.add(combined)
      else merged.addAll(component.map { partitions[it] })
    }
    return merged
  }
  private fun partition(tracks: List<Prepared>, collation: Collator): List<MutableList<Prepared>> {
    if (tracks.isEmpty()) return emptyList()
    fun specificity(row: Prepared) = listOf(row.track.trackTotal, row.track.discTotal, row.track.discNumber).count { it != null }
    val sorted = tracks.sortedWith(compareByDescending<Prepared>(::specificity)
      .thenBy { it.track.year ?: 0 }.thenComparator { a, b -> collation.compare(a.track.id, b.track.id) })
    val hasDates = sorted.any { it.track.year != null }
    val deferred = mutableListOf<Prepared>()
    val byFacts = linkedMapOf<List<Int?>, MutableList<Prepared>>()
    for (row in sorted) {
      val track = row.track
      if (hasDates && track.year == null) deferred += row
      else byFacts.getOrPut(listOf(track.year, track.discTotal, track.discNumber, track.trackTotal)) { mutableListOf() } += row
    }
    val merged = mergePartitions(mergePartitions(byFacts.values.toList(), ::strictlyCompatible))
    // Establish incompatible undated releases before assigning any wildcard tracks.
    val pending = mutableListOf<Prepared>()
    for (track in deferred) {
      if (merged.any { compatible(it + track) }) pending += track
      else merged.add(mutableListOf(track))
    }
    // Stable indices avoid using mutable lists as hash keys.
    val additions = linkedMapOf<Int, MutableList<Prepared>>()
    val remaining = mutableListOf<Prepared>()
    for (track in pending) {
      val candidates = merged.indices.filter { compatible(merged[it] + track) }
      if (candidates.size == 1) additions.getOrPut(candidates[0]) { mutableListOf() } += track
      else remaining += track
    }
    for ((target, proposed) in additions) {
      if (compatible(merged[target] + proposed)) merged[target].addAll(proposed)
      else remaining.addAll(proposed)
    }
    return merged + partition(remaining, collation)
  }
  private fun commonYear(tracks: List<Prepared>): Int? {
    if (tracks.isEmpty() || tracks.any { it.track.year == null }) return null
    return tracks.map { it.track.year }.distinct().singleOrNull()
  }
  private fun coherent(tracks: List<Prepared>): Boolean {
    val numbered = tracks.map(Prepared::track).filter { it.trackNumber != null }
    if (numbered.size < 2) return false
    val multiDisc = tracks.any { (it.track.discNumber ?: 1) > 1 || (it.track.discTotal ?: 1) > 1 }
    val positions = hashSetOf<String>()
    for (track in numbered) {
      if (track.trackNumber!! < 1) return false
      if (track.trackTotal != null && track.trackNumber > track.trackTotal) return false
      if (multiDisc && track.discNumber == null) return false
      if ((track.discNumber ?: 1) < 1 || (track.discTotal != null && (track.discNumber ?: 1) > track.discTotal)) return false
      if (!positions.add("${track.discNumber ?: 1}:${track.trackNumber}")) return false
    }
    return true
  }
  private fun complete(tracks: List<Prepared>): Boolean {
    if (tracks.size < 4 || commonYear(tracks) == null) return false
    if (tracks.any { it.track.trackNumber == null || it.track.trackTotal == null }) return false
    val discTotals = tracks.mapNotNull { it.track.discTotal }.distinct()
    if (discTotals.size > 1) return false
    val expectedDiscs = discTotals.singleOrNull() ?: 1
    val discs = tracks.groupBy { it.track.discNumber ?: 1 }
    if (discs.size != expectedDiscs || discs.keys.any { it < 1 || it > expectedDiscs }) return false
    for (disc in 1..expectedDiscs) {
      val group = discs[disc].orEmpty()
      val total = group.map { it.track.trackTotal }.distinct().singleOrNull() ?: return false
      val positions = group.map { it.track.trackNumber }.toSet()
      if (positions.size != total || (1..total).any { it !in positions }) return false
    }
    return true
  }
  private fun sharedArtwork(tracks: List<Prepared>): String? {
    val counts = tracks.mapNotNull(Prepared::artwork).groupingBy { it }.eachCount()
    val dominant = counts.entries.sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key }).firstOrNull()
    val count = counts.values.sum()
    if (dominant != null && count >= 2 && dominant.value == count) return dominant.key
    if (dominant != null && count >= 5 && dominant.value.toDouble() / count >= 0.8 &&
      (commonYear(tracks) != null || coherent(tracks))) return dominant.key
    return null
  }
  private fun compilation(tracks: List<Prepared>): Pair<String, String?>? {
    if (tracks.map(Prepared::primaryKey).distinct().size <= 1) return null
    sharedArtwork(tracks)?.let { return "shared-artwork-compilation" to it }
    return if (complete(tracks)) "metadata-compilation" to null else null
  }
  private fun qualifier(tracks: List<Prepared>): String {
    val years = tracks.mapNotNull { it.track.year }.distinct().sorted()
    val year = when (years.size) { 0 -> "u"; 1 -> years[0].toString(); else -> "${years.first()}-${years.last()}" }
    val discTotals = tracks.mapNotNull { it.track.discTotal }.distinct().sorted().joinToString(",").ifEmpty { "u" }
    val trackTotals = tracks.filter { it.track.trackTotal != null }.groupBy { it.track.discNumber ?: 0 }
      .toSortedMap().entries.joinToString(";") { (disc, rows) ->
        "${if (disc == 0) "u" else disc}=${rows.mapNotNull { it.track.trackTotal }.distinct().sorted().joinToString(",")}"
      }.ifEmpty { "u" }
    return "rp:y$year:d$discTotals:t$trackTotals"
  }

  fun group(tracks: List<ResolveAlbumTrack>, index: ArtistIdentityIndex = ArtistResolve.build(tracks.map { it.credit })): List<ResolvedAlbum> {
    // V8's reference fixture locale is en-US. ICU also preserves its ordering
    // for mixed-case and Unicode paths when release facts overlap ambiguously.
    val collation = Collator.getInstance(Locale.US)
    val groups = linkedMapOf<String, ResolvedAlbum>()
    val buckets = linkedMapOf<String, MutableList<Prepared>>()
    for (track in tracks.sortedWith { a, b -> collation.compare(a.id, b.id) }) {
      val albumKey = ArtistResolve.identityKey(ArtistResolve.display(track.credit.album).ifEmpty { "Unknown Album" })
      val owner = ArtistResolve.display(track.credit.albumArtist).let {
        if (it.isNotEmpty()) ArtistResolve.canonicalDisplay(it)
        else ArtistResolve.format(ArtistResolve.trackNames(track.credit, index, true))
      }
      val credits = ArtistResolve.trackNames(track.credit, index)
      val primary = ArtistResolve.display(credits.firstOrNull()).ifEmpty { "Unknown Artist" }
      buckets.getOrPut(albumKey) { mutableListOf() } += Prepared(
        track, albumKey, owner, primary, ArtistResolve.artistKey(primary),
        credits.map(ArtistResolve::artistKey).filter(String::isNotEmpty),
        ArtistResolve.display(track.artwork).lowercase(java.util.Locale.ROOT).ifEmpty { null },
      )
    }
    fun add(albumKey: String, discriminator: String, mode: String, display: String, tracks: List<Prepared>) {
      val baseKey = key(albumKey, discriminator)
      var identity = baseKey
      var suffix = 2
      while (identity in groups) identity = "$baseKey:p${suffix++}"
      val ordered = tracks.sortedWith { a, b -> collation.compare(a.track.id, b.track.id) }
      groups[identity] = ResolvedAlbum(identity, albumKey, mode, display, ordered.map { it.track }.toMutableList())
    }
    for ((albumKey, bucket) in buckets) {
      val explicit = bucket.filter { it.owner.isNotEmpty() }.groupBy { ArtistResolve.artistKey(it.owner).ifEmpty { "unknown artist" } }
      val owners = explicit.flatMap { (key, tracks) -> partition(tracks, collation).map { OwnerPartition(key, it[0].owner, it) } }
      val remaining = mutableListOf<Prepared>()
      val ownerAdditions = linkedMapOf<Int, MutableList<Prepared>>()
      for (track in bucket.filter { it.owner.isEmpty() }) {
        val candidates = owners.indices.filter { ownerIndex ->
          val owner = owners[ownerIndex]
          if (!compatible(owner.tracks + track)) return@filter false
          val keys = setOf(owner.key) + owner.tracks.flatMap(Prepared::creditKeys)
          val artistMatch = track.creditKeys.any { it in keys }
          val artworkMatch = track.artwork != null && owner.tracks.any { it.artwork == track.artwork }
          val numbering = track.track.year != null && owner.tracks.any { it.track.year == track.track.year } && coherent(owner.tracks + track)
          artistMatch || artworkMatch || numbering
        }
        if (candidates.size == 1) ownerAdditions.getOrPut(candidates[0]) { mutableListOf() } += track else remaining += track
      }
      for ((target, proposed) in ownerAdditions) {
        if (compatible(owners[target].tracks + proposed)) owners[target].tracks.addAll(proposed)
        else remaining.addAll(proposed)
      }
      for (owner in owners) {
        val suffix = if (owners.count { it.key == owner.key } > 1) ":${qualifier(owner.tracks)}" else ""
        add(albumKey, "aa:${owner.key}$suffix", "explicit-album-artist", owner.display, owner.tracks)
      }
      val partitions = partition(remaining, collation)
      val primaryPartitionCounts = partitions.flatMap { it.map(Prepared::primaryKey).distinct() }.groupingBy { it }.eachCount()
      for (release in partitions) {
        val compilation = if (albumKey != "unknown album") compilation(release) else null
        if (compilation != null) {
          var discriminator = compilation.second?.let { "ah:$it" } ?: "ci:${qualifier(release)}"
          if (key(albumKey, discriminator) in groups) discriminator += ":${qualifier(release)}"
          add(albumKey, discriminator, compilation.first, "Various Artists", release)
          continue
        }
        for ((primaryKey, primaryTracks) in release.groupBy(Prepared::primaryKey)) {
          val samePrimary = partition(primaryTracks, collation)
          for (part in samePrimary) {
            val qualified = (primaryPartitionCounts[primaryKey] ?: 0) > 1 || samePrimary.size > 1
            val suffix = if (qualified) ":${qualifier(part)}" else ""
            add(albumKey, "ta:$primaryKey$suffix", "track-artist", part[0].primary, part)
          }
        }
      }
    }
    return groups.values.toList()
  }
}
