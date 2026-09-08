package expo.modules.astracar

object AstraCarPagination {
  const val PAGE_SIZE = 100
  data class Range(val offset: Long, val size: Long)
  data class Letters(val first: String, val last: String, val count: Long) {
    val title get() = if (first == "#") "0–9 & other" else if (first == last) first else "$first–$last"
  }

  /** Never cut a letter across two folders. Only dense single letters need subranges. */
  fun letters(counts: List<Pair<String, Long>>, pageSize: Int = PAGE_SIZE): List<Letters> {
    val result = mutableListOf<Letters>()
    for ((label, count) in counts.filter { it.second > 0 }.sortedBy { it.first }) {
      val last = result.lastOrNull()
      if (last != null && last.first != "#" && label != "#" && last.count + count <= pageSize &&
        label.single() - last.first.single() < 4) {
        result[result.lastIndex] = last.copy(last = label, count = last.count + count)
      } else result += Letters(label, label, count)
    }
    return result
  }

  fun contentTitle(first: String?, last: String?): String {
    val start = first?.trim().orEmpty().ifEmpty { "Untitled" }
    val end = last?.trim().orEmpty().ifEmpty { start }
    return if (start == end) start else "${start.take(32)} … ${end.take(32)}"
  }
  fun queueWindow(position: Long, count: Long): Range {
    if (count <= 0) return Range(0, 0)
    val start = position.coerceIn(0, count - 1)
    return Range(start, minOf(30, count - start))
  }

  fun ranges(offset: Long, count: Long, maxFolders: Int = PAGE_SIZE): List<Range> {
    if (offset < 0 || count <= 0) return emptyList()
    var size = PAGE_SIZE.toLong()
    while ((count - 1) / size >= maxFolders.coerceIn(1, PAGE_SIZE)) size *= PAGE_SIZE
    return (0L until count step size).map { Range(offset + it, minOf(size, count - it)) }
  }
}
