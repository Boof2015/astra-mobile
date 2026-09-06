package expo.modules.astralibraryscanner.data

import java.text.Normalizer
import java.util.Locale

// Behavioral port of desktop src/shared/library/artistCredits.ts at 7e9d3dd.
internal data class ResolveCredit(
  val artist: String,
  val album: String? = null,
  val artists: List<String> = emptyList(),
  val albumArtist: String? = null,
  val albumArtists: List<String> = emptyList(),
)

internal data class ArtistIdentityIndex(
  val factualKeys: Set<String>,
  val structuredKeys: Set<String>,
  val rawCreditCounts: Map<String, Int>,
  val corroboratedAmpersandCreditKeys: Set<String> = emptySet(),
  val ampersandListAlbumKeys: Set<String> = emptySet(),
)

internal object ArtistResolve {
  private val zeroWidth = Regex("[\u200b-\u200d\u2060\ufeff]")
  private val apostrophes = Regex("[\u2018\u2019\u02bc]")
  private val spaces = Regex("[\\s\\p{Z}]+")
  private val generic = setOf("various artists", "various artist", "va", "v.a.", "v/a", "v a")
  private val strong = Regex("\\s*;\\s*|\\s+(?:feat\\.?|ft\\.?|featuring|with|[x×])\\s+", RegexOption.IGNORE_CASE)
  private val anySeparator = Regex("[,;&]|\\s+(?:feat\\.?|ft\\.?|featuring|with|[x×])\\s+", RegexOption.IGNORE_CASE)
  private val comma = Regex("\\s*,\\s*")
  private val ampersand = Regex("\\s+&\\s+")
  private val separators = Regex("\\s*[,;]\\s*|\\s+(?:&|feat\\.?|ft\\.?|featuring|with|[x×])\\s+", RegexOption.IGNORE_CASE)

  fun display(value: String?): String =
    spaces.replace(zeroWidth.replace(Normalizer.normalize(value.orEmpty(), Normalizer.Form.NFC), ""), " ").trim()
  fun identityKey(value: String?): String = apostrophes.replace(display(value), "'").lowercase(Locale.ROOT)
  fun artistKey(value: String?): String = identityKey(value).let { if (it in generic) "various artists" else it }
  fun canonicalDisplay(value: String?): String = if (artistKey(value) == "various artists") "Various Artists" else display(value)
  fun names(values: Iterable<String>): List<String> = values.map(::display).filter(String::isNotEmpty).distinctBy(::artistKey)
  fun format(values: List<String>): String = names(values).let {
    when (it.size) { 0 -> ""; 1 -> it[0]; else -> it.dropLast(1).joinToString(", ") + " & " + it.last() }
  }

  fun build(tracks: List<ResolveCredit>): ArtistIdentityIndex {
    val facts = linkedSetOf<String>()
    val structured = linkedSetOf<String>()
    val counts = linkedMapOf<String, Int>()
    val owners = linkedMapOf<String, String>()
    fun fact(value: String) { artistKey(value).takeIf(String::isNotEmpty)?.let(facts::add) }
    fun observe(value: String) { artistKey(value).takeIf(String::isNotEmpty)?.let { counts[it] = (counts[it] ?: 0) + 1 } }
    for (track in tracks) {
      for (name in names(track.artists) + names(track.albumArtists)) {
        fact(name)
        artistKey(name).takeIf(String::isNotEmpty)?.let(structured::add)
      }
      val artist = display(track.artist)
      if (artist.isNotEmpty()) {
        observe(artist)
        if (!anySeparator.containsMatchIn(artist)) fact(artist)
      }
      val owner = display(track.albumArtist)
      if (owner.isNotEmpty()) {
        owners[artistKey(owner)] = owner
        if (!anySeparator.containsMatchIn(owner)) fact(owner)
      }
    }
    for ((key, owner) in owners) if (key !in counts) observe(owner)
    val base = ArtistIdentityIndex(facts, structured, counts)
    data class Evidence(val observations: MutableSet<String> = linkedSetOf(), val candidates: MutableList<List<String>> = mutableListOf())
    val candidates = linkedMapOf<String, List<String>>()
    val albums = linkedMapOf<String, Evidence>()
    for (track in tracks) {
      val albumKey = identityKey(track.album)
      val evidence = if (albumKey.isNotEmpty() && albumKey != "unknown album") albums.getOrPut(albumKey) { Evidence() } else null
      val explicit = names(track.artists)
      if (explicit.isNotEmpty()) {
        explicit.map(::artistKey).filter(String::isNotEmpty).forEach { evidence?.observations?.add(it) }
        continue
      }
      val raw = display(track.artist)
      if (raw.isEmpty() || preserveCompound(raw, base)) continue
      val clauses = strong.split(raw).flatMap { comma.split(it) }.map(::display).filter(String::isNotEmpty)
      for (clause in clauses) {
        val parts = ampersand.split(clause).map(::display).filter(String::isNotEmpty)
        if (parts.size > 1) {
          artistKey(clause).takeIf(String::isNotEmpty)?.let { candidates[it] = parts }
          evidence?.candidates?.add(parts)
        } else artistKey(clause).takeIf(String::isNotEmpty)?.let { evidence?.observations?.add(it) }
      }
    }
    val direct = linkedSetOf<String>()
    val anchored = linkedSetOf<String>()
    for ((key, parts) in candidates) {
      if (parts.none { artistKey(it) in facts }) continue
      direct += key
      parts.mapTo(anchored, ::artistKey)
    }
    val corroborated = direct.toMutableSet()
    for ((key, parts) in candidates) if (parts.any { artistKey(it) in anchored }) corroborated += key
    val listAlbums = linkedSetOf<String>()
    for ((key, evidence) in albums) {
      val total = evidence.candidates.size
      if (total < 3) continue
      val supported = evidence.candidates.count { parts ->
        parts.any { artistKey(it) in facts || artistKey(it) in evidence.observations }
      }
      if (supported >= 2 && supported * 2 >= total) listAlbums += key
    }
    return base.copy(corroboratedAmpersandCreditKeys = corroborated, ampersandListAlbumKeys = listAlbums)
  }

  private fun preserveCompound(value: String, index: ArtistIdentityIndex): Boolean {
    if (!anySeparator.containsMatchIn(value)) return false
    val count = index.rawCreditCounts[artistKey(value)] ?: 0
    if (count < 8) return false
    val parts = strong.split(value).flatMap { Regex("\\s*,\\s*|\\s+&\\s+").split(it) }.map(::display).filter(String::isNotEmpty)
    if (parts.size <= 1 || parts.any { artistKey(it) in index.factualKeys }) return false
    val largest = parts.maxOfOrNull { index.rawCreditCounts[artistKey(it)] ?: 0 } ?: 0
    return count >= maxOf(8, largest * 4)
  }

  private fun protect(value: String, index: ArtistIdentityIndex): Pair<String, Map<String, String>> {
    data class Span(val start: Int, val end: Int)
    val components = mutableListOf<Span>()
    var cursor = 0
    fun component(end: Int) {
      val raw = value.substring(cursor, end)
      val leading = raw.indexOfFirst { !it.isWhitespace() }
      if (leading >= 0) components += Span(cursor + leading, cursor + raw.trimEnd().length)
    }
    for (match in separators.findAll(value)) {
      component(match.range.first)
      cursor = match.range.last + 1
    }
    component(value.length)
    val candidates = mutableListOf<Span>()
    for (start in components.indices) for (end in start until components.size) {
      val span = Span(components[start].start, components[end].end)
      val key = artistKey(value.substring(span.start, span.end))
      if (key != "various artists" && key in index.factualKeys) candidates += span
    }
    val spans = mutableListOf<Span>()
    for (candidate in candidates.sortedWith(compareByDescending<Span> { it.end - it.start }.thenBy { it.start })) {
      if (spans.none { candidate.start < it.end && candidate.end > it.start }) spans += candidate
    }
    if (spans.isEmpty()) return value to emptyMap()
    val replacements = linkedMapOf<String, String>()
    val protected = StringBuilder()
    cursor = 0
    spans.sortedBy(Span::start).forEachIndexed { i, span ->
      val placeholder = "\uE000$i\uE001"
      protected.append(value.substring(cursor, span.start)).append(placeholder)
      replacements[placeholder] = value.substring(span.start, span.end)
      cursor = span.end
    }
    return protected.append(value.substring(cursor)).toString() to replacements
  }

  private fun restore(value: String, replacements: Map<String, String>): String =
    replacements.entries.fold(value) { current, (placeholder, original) -> current.replace(placeholder, original) }

  private fun ampersandParts(value: String, index: ArtistIdentityIndex, replacements: Map<String, String>, albumEvidence: Boolean): List<String> {
    val parts = ampersand.split(value).map(::display).filter(String::isNotEmpty)
    if (parts.size <= 1) return listOf(value)
    val corroborated = artistKey(restore(value, replacements)) in index.corroboratedAmpersandCreditKeys
    return if (albumEvidence || corroborated || parts.all { it in replacements || artistKey(it) in index.factualKeys }) parts else listOf(value)
  }

  fun resolve(raw: String?, index: ArtistIdentityIndex, album: String? = null): List<String> {
    val value = display(raw)
    if (value.isEmpty()) return emptyList()
    if (artistKey(value) in index.structuredKeys || preserveCompound(value, index)) return listOf(value)
    val (protected, replacements) = protect(value, index)
    val albumEvidence = !album.isNullOrEmpty() && identityKey(album) in index.ampersandListAlbumKeys
    val resolved = strong.split(protected).flatMap { clause ->
      val part = display(clause)
      when {
        part.isEmpty() -> emptyList()
        artistKey(part) in index.structuredKeys || preserveCompound(part, index) -> listOf(part)
        else -> comma.split(part).map(::display).filter(String::isNotEmpty).flatMap {
          if (artistKey(it) in index.structuredKeys) listOf(it) else ampersandParts(it, index, replacements, albumEvidence)
        }
      }
    }
    return names(resolved.map { restore(it, replacements) })
  }

  fun trackNames(track: ResolveCredit, index: ArtistIdentityIndex, albumArtist: Boolean = false): List<String> {
    val structured = names(if (albumArtist) track.albumArtists else track.artists)
    if (structured.isNotEmpty()) return structured
    return resolve(if (albumArtist) track.albumArtist else track.artist, index, if (albumArtist) null else track.album)
  }
}
