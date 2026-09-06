package expo.modules.astralibraryscanner.data

import android.icu.text.Collator
import java.util.Locale

// Behavioral port of desktop src/shared/library/albumGrouping.ts at 7e9d3dd.
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
  private fun compatible(a: Prepared, b: Prepared): Boolean {
    val left = a.track
    val right = b.track
    if (left.year != null && right.year != null && kotlin.math.abs(left.year - right.year) > 1) return false
    fun conflict(a: Int?, b: Int?) = a != null && b != null && a != b
    return !conflict(left.trackTotal, right.trackTotal) && !conflict(left.discTotal, right.discTotal)
  }
  private fun partition(tracks: List<Prepared>, collation: Collator): List<MutableList<Prepared>> {
    val result = mutableListOf<MutableList<Prepared>>()
    for (track in tracks.sortedWith { a, b -> collation.compare(a.track.id, b.track.id) }) {
      val target = result.firstOrNull { part -> part.all { compatible(track, it) } }
      if (target != null) target += track else result.add(mutableListOf(track))
    }
    return result
  }
  private fun commonYear(tracks: List<Prepared>): Int? {
    if (tracks.isEmpty() || tracks.any { it.track.year == null }) return null
    return tracks.map { it.track.year }.distinct().singleOrNull()
  }
  private fun coherent(tracks: List<Prepared>): Boolean {
    val numbered = tracks.map(Prepared::track).filter { it.trackNumber != null && it.trackTotal != null }
    if (numbered.size < 2) return false
    val positions = hashSetOf<String>()
    for (track in numbered) {
      if (track.trackNumber!! < 1 || track.trackNumber > track.trackTotal!!) return false
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
  private fun compilation(tracks: List<Prepared>): Pair<String, String?>? {
    if (tracks.map(Prepared::primaryKey).distinct().size <= 1) return null
    val counts = tracks.mapNotNull(Prepared::artwork).groupingBy { it }.eachCount()
    val dominant = counts.entries.sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key }).firstOrNull()
    val count = counts.values.sum()
    if (dominant != null && count >= 2 && dominant.value == count) return "shared-artwork-compilation" to dominant.key
    if (dominant != null && count >= 5 && dominant.value.toDouble() / count >= 0.8 &&
      (commonYear(tracks) != null || coherent(tracks))) return "shared-artwork-compilation" to dominant.key
    return if (complete(tracks)) "metadata-compilation" to null else null
  }
  private fun qualifier(tracks: List<Prepared>): String {
    val years = tracks.mapNotNull { it.track.year }.distinct().sorted()
    val year = when (years.size) { 0 -> "u"; 1 -> years[0].toString(); else -> "${years.first()}-${years.last()}" }
    val discTotal = tracks.firstOrNull { it.track.discTotal != null }?.track?.discTotal
    val trackTotal = tracks.firstOrNull { it.track.trackTotal != null }?.track?.trackTotal
    return "rp:y$year:d${discTotal ?: "u"}:t${trackTotal ?: "u"}"
  }

  fun group(tracks: List<ResolveAlbumTrack>, index: ArtistIdentityIndex = ArtistResolve.build(tracks.map { it.credit })): List<ResolvedAlbum> {
    // V8's reference fixture locale is en-US. ICU also preserves its ordering
    // for mixed-case and Unicode paths when release facts overlap ambiguously.
    val collation = Collator.getInstance(Locale.US)
    val groups = linkedMapOf<String, ResolvedAlbum>()
    val buckets = linkedMapOf<String, MutableList<Prepared>>()
    for (track in tracks) {
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
      val identity = key(albumKey, discriminator)
      groups[identity] = ResolvedAlbum(identity, albumKey, mode, display, tracks.map { it.track }.toMutableList())
    }
    for ((albumKey, bucket) in buckets) {
      val explicit = bucket.filter { it.owner.isNotEmpty() }.groupBy { ArtistResolve.artistKey(it.owner).ifEmpty { "unknown artist" } }
      val owners = explicit.flatMap { (key, tracks) -> partition(tracks, collation).map { OwnerPartition(key, it[0].owner, it) } }
      val remaining = mutableListOf<Prepared>()
      for (track in bucket.filter { it.owner.isEmpty() }) {
        val candidates = owners.filter { owner ->
          if (!owner.tracks.all { compatible(track, it) }) return@filter false
          val keys = setOf(owner.key) + owner.tracks.flatMap(Prepared::creditKeys)
          val artistMatch = track.creditKeys.any { it in keys }
          val artworkMatch = track.artwork != null && owner.tracks.any { it.artwork == track.artwork }
          val numbering = track.track.year != null && owner.tracks.any { it.track.year == track.track.year } && coherent(owner.tracks + track)
          artistMatch || artworkMatch || numbering
        }
        if (candidates.size == 1) candidates[0].tracks += track else remaining += track
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
