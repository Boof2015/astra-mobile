package expo.modules.astrawidget

import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * The cover colors now playing derives, recomputed natively. Headless widget
 * updates (a skip from the notification, Bluetooth, Android Auto) can't run the
 * JS extractor, so this is a line-for-line port of the parts the widget needs:
 *
 *   src/theme/adaptiveAccent.ts  histogram → Wu → OKLab k-means → scoring → toneForTheme
 *   src/theme/artworkField.ts    the living-gradient field picks and toning
 *   src/theme/fieldContrast.ts   field strength and the text-contrast lift
 *   src/theme/colorUtils.ts      hex/HSL helpers
 *
 * Keep it in step with those files. ArtworkColorMathTest checks it against
 * fixtures generated from the JS (scripts/gen-widget-color-fixtures.mts), and
 * any drift fails on exact hex equality. StrictMath is fdlibm, which is what
 * Hermes' libm calls resolve to on Android.
 */
internal object ArtworkColorMath {
  data class Oklab(val L: Double, val a: Double, val b: Double)

  class WeightedColor(val lab: Oklab, val population: Double)

  class ScoredColor(val lab: Oklab, val population: Double, val score: Double)

  /** Always FIELD_SIZE `#rrggbb` colors. */
  data class Field(val colors: List<String>, val neutral: Boolean)

  data class CoverColors(
    val fieldDark: Field?,
    val fieldLight: Field?,
    /** Null when the image had no visible pixel. */
    val accentDark: String?,
    val accentLight: String?,
  )

  const val FIELD_SIZE = 3

  private const val MIN_ALPHA = 48
  private const val HISTOGRAM_BITS = 5
  private const val HISTOGRAM_SIDE = 1 shl HISTOGRAM_BITS
  private const val MAX_CLUSTERS = 16
  private const val KMEANS_MAX_ITERATIONS = 6

  private const val CHROMA_UNITS = 360.0
  private const val CHROMA_CUTOFF = 5.0
  private const val CHROMA_TARGET = 48.0
  private const val MIN_EXCITED_PROPORTION = 0.01
  private const val HUE_WINDOW_BEFORE = 14
  private const val HUE_WINDOW_AFTER = 15

  private const val CHROMA_FLOOR = 0.09
  private class Band(val preferred: Double, val min: Double, val max: Double)
  private val DARK_THEME_LIGHTNESS = Band(0.74, 0.64, 0.8)
  private val LIGHT_THEME_LIGHTNESS = Band(0.5, 0.42, 0.56)
  private const val LIGHTNESS_DRIFT_COST = 0.5
  private const val MIN_ON_ACCENT_CONTRAST = 4.5

  // artworkField.ts
  private const val MIN_SHARE = 0.02
  private const val MIN_HUE_SEPARATION = 28.0
  private const val MIN_LAB_DISTANCE = 0.08
  private class Tone(val lightness: DoubleArray, val chromaScale: Double, val chromaMax: Double)
  private val DARK_TONE = Tone(doubleArrayOf(0.42, 0.37, 0.46), 0.95, 0.16)
  private val LIGHT_TONE = Tone(doubleArrayOf(0.86, 0.89, 0.83), 0.6, 0.09)

  // fieldContrast.ts
  const val FIELD_STRENGTH_DARK = 0.7
  const val FIELD_STRENGTH_LIGHT = 0.85
  const val FIELD_NEUTRAL_SCALE = 0.6
  private const val MIX_STEP = 0.05

  /** artworkColors.ts with the adaptive method: one clustering pass, both themes. */
  fun coverColors(pixels: IntArray, onAccentDark: String, onAccentLight: String): CoverColors {
    val clusters = clusterArtworkPixels(pixels)
    val visible = hasVisiblePixel(pixels)
    val source = scoreColors(clusters).firstOrNull()?.lab
    return CoverColors(
      fieldDark = fieldFromClusters(clusters, true),
      fieldLight = fieldFromClusters(clusters, false),
      accentDark = if (visible) toneForTheme(source, false, onAccentDark) else null,
      accentLight = if (visible) toneForTheme(source, true, onAccentLight) else null,
    )
  }

  private fun hasVisiblePixel(pixels: IntArray): Boolean {
    var i = 3
    while (i < pixels.size) {
      if (pixels[i] >= MIN_ALPHA) return true
      i += 4
    }
    return false
  }

  // ── Colour maths ─────────────────────────────────────────

  private fun srgbToLinear(channel: Double): Double {
    val c = channel / 255
    return if (c <= 0.04045) c / 12.92 else StrictMath.pow((c + 0.055) / 1.055, 2.4)
  }

  private fun linearToSrgb(value: Double): Int {
    val c = if (value <= 0.0031308) value * 12.92 else 1.055 * StrictMath.pow(value, 1 / 2.4) - 0.055
    return jsRound(max(0.0, min(1.0, c)) * 255)
  }

  /** JS Math.round: halves round toward +∞. */
  private fun jsRound(value: Double): Int = floor(value + 0.5).toInt()

  fun rgbToOklab(r: Double, g: Double, b: Double): Oklab {
    val lr = srgbToLinear(r)
    val lg = srgbToLinear(g)
    val lb = srgbToLinear(b)
    val l = StrictMath.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
    val m = StrictMath.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
    val s = StrictMath.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
    return Oklab(
      L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    )
  }

  private fun cube(value: Double): Double = value * value * value

  private fun oklabToLinearRgb(lab: Oklab): DoubleArray {
    val l = cube(lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b)
    val m = cube(lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b)
    val s = cube(lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b)
    return doubleArrayOf(
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    )
  }

  private fun oklch(L: Double, chroma: Double, hueDegrees: Double): Oklab {
    val radians = (hueDegrees * Math.PI) / 180
    return Oklab(L, chroma * StrictMath.cos(radians), chroma * StrictMath.sin(radians))
  }

  fun chromaOf(lab: Oklab): Double = hypot(lab.a, lab.b)

  fun hueOf(lab: Oklab): Double {
    val degrees = (StrictMath.atan2(lab.b, lab.a) * 180) / Math.PI
    return if (degrees < 0) degrees + 360 else degrees
  }

  /** Math.hypot as V8 computes it (scaled Kahan sum), which the fixtures were made with. */
  private fun hypot(vararg values: Double): Double {
    var largest = 0.0
    for (value in values) largest = max(largest, abs(value))
    if (largest == 0.0) return 0.0
    var sum = 0.0
    var compensation = 0.0
    for (value in values) {
      val n = abs(value) / largest
      val summand = n * n - compensation
      val preliminary = sum + summand
      compensation = (preliminary - sum) - summand
      sum = preliminary
    }
    return sqrt(sum) * largest
  }

  private fun inGamut(rgb: DoubleArray): Boolean {
    val epsilon = 1e-4
    return rgb.all { it >= -epsilon && it <= 1 + epsilon }
  }

  private fun hex2(value: Int): String = value.toString(16).padStart(2, '0')

  private fun linearToHex(rgb: DoubleArray): String =
    "#${hex2(linearToSrgb(rgb[0]))}${hex2(linearToSrgb(rgb[1]))}${hex2(linearToSrgb(rgb[2]))}"

  private fun relativeLuminanceOfLinear(rgb: DoubleArray): Double {
    fun clamp(value: Double) = max(0.0, min(1.0, value))
    return 0.2126 * clamp(rgb[0]) + 0.7152 * clamp(rgb[1]) + 0.0722 * clamp(rgb[2])
  }

  private fun luminanceOfHex(hex: String): Double? {
    val match = Regex("^#?([0-9a-fA-F]{6})$").find(hex.trim()) ?: return null
    val value = match.groupValues[1].toInt(16)
    return relativeLuminanceOfLinear(
      doubleArrayOf(
        srgbToLinear(((value shr 16) and 255).toDouble()),
        srgbToLinear(((value shr 8) and 255).toDouble()),
        srgbToLinear((value and 255).toDouble()),
      ),
    )
  }

  private fun contrast(a: Double, b: Double): Double = (max(a, b) + 0.05) / (min(a, b) + 0.05)

  // ── 1. Histogram ─────────────────────────────────────────

  class ColorHistogram(size: Int) {
    val counts = IntArray(size)
    val sumR = DoubleArray(size)
    val sumG = DoubleArray(size)
    val sumB = DoubleArray(size)
    val sumSquares = DoubleArray(size)
    var total = 0
  }

  /** RGBA_8888 channel values (0–255), four per pixel, like a JS pixel buffer. */
  fun buildHistogram(pixels: IntArray): ColorHistogram {
    val histogram = ColorHistogram(HISTOGRAM_SIDE * HISTOGRAM_SIDE * HISTOGRAM_SIDE)
    val shift = 8 - HISTOGRAM_BITS
    var i = 0
    while (i + 3 < pixels.size) {
      if (pixels[i + 3] >= MIN_ALPHA) {
        val r = pixels[i]
        val g = pixels[i + 1]
        val b = pixels[i + 2]
        val bin = ((r shr shift) shl (HISTOGRAM_BITS * 2)) or ((g shr shift) shl HISTOGRAM_BITS) or (b shr shift)
        histogram.counts[bin] += 1
        histogram.sumR[bin] += r.toDouble()
        histogram.sumG[bin] += g.toDouble()
        histogram.sumB[bin] += b.toDouble()
        histogram.sumSquares[bin] += (r * r + g * g + b * b).toDouble()
        histogram.total += 1
      }
      i += 4
    }
    return histogram
  }

  // ── 2. Wu quantization ───────────────────────────────────

  private const val WU_SIDE = HISTOGRAM_SIDE + 1

  private class WuBox(
    var r0: Int = 0, var r1: Int = 0,
    var g0: Int = 0, var g1: Int = 0,
    var b0: Int = 0, var b1: Int = 0,
    var vol: Int = 0,
  )

  private fun wuIndex(r: Int, g: Int, b: Int): Int = r * WU_SIDE * WU_SIDE + g * WU_SIDE + b

  private class WuMoments(size: Int) {
    val weights = DoubleArray(size)
    val momentsR = DoubleArray(size)
    val momentsG = DoubleArray(size)
    val momentsB = DoubleArray(size)
    val moments = DoubleArray(size)
  }

  private fun buildWuMoments(histogram: ColorHistogram): WuMoments {
    val table = WuMoments(WU_SIDE * WU_SIDE * WU_SIDE)
    val mask = HISTOGRAM_SIDE - 1
    for (bin in histogram.counts.indices) {
      if (histogram.counts[bin] == 0) continue
      val index = wuIndex(
        ((bin shr (HISTOGRAM_BITS * 2)) and mask) + 1,
        ((bin shr HISTOGRAM_BITS) and mask) + 1,
        (bin and mask) + 1,
      )
      table.weights[index] += histogram.counts[bin].toDouble()
      table.momentsR[index] += histogram.sumR[bin]
      table.momentsG[index] += histogram.sumG[bin]
      table.momentsB[index] += histogram.sumB[bin]
      table.moments[index] += histogram.sumSquares[bin]
    }

    val area = DoubleArray(WU_SIDE)
    val areaR = DoubleArray(WU_SIDE)
    val areaG = DoubleArray(WU_SIDE)
    val areaB = DoubleArray(WU_SIDE)
    val area2 = DoubleArray(WU_SIDE)
    for (r in 1 until WU_SIDE) {
      area.fill(0.0); areaR.fill(0.0); areaG.fill(0.0); areaB.fill(0.0); area2.fill(0.0)
      for (g in 1 until WU_SIDE) {
        var line = 0.0
        var lineR = 0.0
        var lineG = 0.0
        var lineB = 0.0
        var line2 = 0.0
        for (b in 1 until WU_SIDE) {
          val index = wuIndex(r, g, b)
          line += table.weights[index]
          lineR += table.momentsR[index]
          lineG += table.momentsG[index]
          lineB += table.momentsB[index]
          line2 += table.moments[index]
          area[b] += line
          areaR[b] += lineR
          areaG[b] += lineG
          areaB[b] += lineB
          area2[b] += line2
          val previous = wuIndex(r - 1, g, b)
          table.weights[index] = table.weights[previous] + area[b]
          table.momentsR[index] = table.momentsR[previous] + areaR[b]
          table.momentsG[index] = table.momentsG[previous] + areaG[b]
          table.momentsB[index] = table.momentsB[previous] + areaB[b]
          table.moments[index] = table.moments[previous] + area2[b]
        }
      }
    }
    return table
  }

  private fun boxVolume(box: WuBox, moment: DoubleArray): Double =
    moment[wuIndex(box.r1, box.g1, box.b1)] -
      moment[wuIndex(box.r1, box.g1, box.b0)] -
      moment[wuIndex(box.r1, box.g0, box.b1)] +
      moment[wuIndex(box.r1, box.g0, box.b0)] -
      moment[wuIndex(box.r0, box.g1, box.b1)] +
      moment[wuIndex(box.r0, box.g1, box.b0)] +
      moment[wuIndex(box.r0, box.g0, box.b1)] -
      moment[wuIndex(box.r0, box.g0, box.b0)]

  private fun boxBottom(box: WuBox, axis: Int, moment: DoubleArray): Double = when (axis) {
    0 -> -moment[wuIndex(box.r0, box.g1, box.b1)] + moment[wuIndex(box.r0, box.g1, box.b0)] +
      moment[wuIndex(box.r0, box.g0, box.b1)] - moment[wuIndex(box.r0, box.g0, box.b0)]
    1 -> -moment[wuIndex(box.r1, box.g0, box.b1)] + moment[wuIndex(box.r1, box.g0, box.b0)] +
      moment[wuIndex(box.r0, box.g0, box.b1)] - moment[wuIndex(box.r0, box.g0, box.b0)]
    else -> -moment[wuIndex(box.r1, box.g1, box.b0)] + moment[wuIndex(box.r1, box.g0, box.b0)] +
      moment[wuIndex(box.r0, box.g1, box.b0)] - moment[wuIndex(box.r0, box.g0, box.b0)]
  }

  private fun boxTop(box: WuBox, axis: Int, position: Int, moment: DoubleArray): Double = when (axis) {
    0 -> moment[wuIndex(position, box.g1, box.b1)] - moment[wuIndex(position, box.g1, box.b0)] -
      moment[wuIndex(position, box.g0, box.b1)] + moment[wuIndex(position, box.g0, box.b0)]
    1 -> moment[wuIndex(box.r1, position, box.b1)] - moment[wuIndex(box.r1, position, box.b0)] -
      moment[wuIndex(box.r0, position, box.b1)] + moment[wuIndex(box.r0, position, box.b0)]
    else -> moment[wuIndex(box.r1, box.g1, position)] - moment[wuIndex(box.r1, box.g0, position)] -
      moment[wuIndex(box.r0, box.g1, position)] + moment[wuIndex(box.r0, box.g0, position)]
  }

  private fun boxVariance(box: WuBox, table: WuMoments): Double {
    val dr = boxVolume(box, table.momentsR)
    val dg = boxVolume(box, table.momentsG)
    val db = boxVolume(box, table.momentsB)
    val weight = boxVolume(box, table.weights)
    if (weight <= 0) return 0.0
    return boxVolume(box, table.moments) - (dr * dr + dg * dg + db * db) / weight
  }

  private class Split(val cut: Int, val score: Double)

  private fun maximizeSplit(box: WuBox, axis: Int, first: Int, last: Int, whole: DoubleArray, table: WuMoments): Split {
    val bottomR = boxBottom(box, axis, table.momentsR)
    val bottomG = boxBottom(box, axis, table.momentsG)
    val bottomB = boxBottom(box, axis, table.momentsB)
    val bottomW = boxBottom(box, axis, table.weights)
    var best = 0.0
    var cut = -1
    for (position in first until last) {
      var halfR = bottomR + boxTop(box, axis, position, table.momentsR)
      var halfG = bottomG + boxTop(box, axis, position, table.momentsG)
      var halfB = bottomB + boxTop(box, axis, position, table.momentsB)
      var halfW = bottomW + boxTop(box, axis, position, table.weights)
      if (halfW == 0.0) continue
      var score = (halfR * halfR + halfG * halfG + halfB * halfB) / halfW
      halfR = whole[0] - halfR
      halfG = whole[1] - halfG
      halfB = whole[2] - halfB
      halfW = whole[3] - halfW
      if (halfW == 0.0) continue
      score += (halfR * halfR + halfG * halfG + halfB * halfB) / halfW
      if (score > best) {
        best = score
        cut = position
      }
    }
    return Split(cut, best)
  }

  private fun volumeOf(box: WuBox): Int = (box.r1 - box.r0) * (box.g1 - box.g0) * (box.b1 - box.b0)

  private fun splitBox(one: WuBox, two: WuBox, table: WuMoments): Boolean {
    val whole = doubleArrayOf(
      boxVolume(one, table.momentsR),
      boxVolume(one, table.momentsG),
      boxVolume(one, table.momentsB),
      boxVolume(one, table.weights),
    )
    val red = maximizeSplit(one, 0, one.r0 + 1, one.r1, whole, table)
    val green = maximizeSplit(one, 1, one.g0 + 1, one.g1, whole, table)
    val blue = maximizeSplit(one, 2, one.b0 + 1, one.b1, whole, table)

    val axis: Int
    if (red.score >= green.score && red.score >= blue.score) {
      if (red.cut < 0) return false
      axis = 0
    } else if (green.score >= blue.score) {
      axis = 1
    } else {
      axis = 2
    }

    two.r1 = one.r1
    two.g1 = one.g1
    two.b1 = one.b1
    when (axis) {
      0 -> {
        one.r1 = red.cut
        two.r0 = one.r1; two.g0 = one.g0; two.b0 = one.b0
      }
      1 -> {
        one.g1 = green.cut
        two.r0 = one.r0; two.g0 = one.g1; two.b0 = one.b0
      }
      else -> {
        one.b1 = blue.cut
        two.r0 = one.r0; two.g0 = one.g0; two.b0 = one.b1
      }
    }
    one.vol = volumeOf(one)
    two.vol = volumeOf(two)
    return true
  }

  class RgbCluster(val r: Double, val g: Double, val b: Double, val population: Double)

  fun quantizeWu(histogram: ColorHistogram, maxColors: Int = MAX_CLUSTERS): List<RgbCluster> {
    if (histogram.total == 0) return emptyList()
    val table = buildWuMoments(histogram)
    val boxes = Array(maxColors) { WuBox() }
    boxes[0] = WuBox(0, HISTOGRAM_SIDE, 0, HISTOGRAM_SIDE, 0, HISTOGRAM_SIDE, 0)
    boxes[0].vol = volumeOf(boxes[0])
    val variance = DoubleArray(maxColors)
    var boxCount = maxColors
    var next = 0
    var i = 1
    while (i < maxColors) {
      if (splitBox(boxes[next], boxes[i], table)) {
        variance[next] = if (boxes[next].vol > 1) boxVariance(boxes[next], table) else 0.0
        variance[i] = if (boxes[i].vol > 1) boxVariance(boxes[i], table) else 0.0
      } else {
        variance[next] = 0.0
        i--
      }
      next = 0
      var highest = variance[0]
      for (j in 1..i) {
        if (variance[j] > highest) {
          highest = variance[j]
          next = j
        }
      }
      if (highest <= 0) {
        boxCount = i + 1
        break
      }
      i++
    }

    val clusters = ArrayList<RgbCluster>()
    for (index in 0 until boxCount) {
      val weight = boxVolume(boxes[index], table.weights)
      if (weight <= 0) continue
      clusters.add(
        RgbCluster(
          boxVolume(boxes[index], table.momentsR) / weight,
          boxVolume(boxes[index], table.momentsG) / weight,
          boxVolume(boxes[index], table.momentsB) / weight,
          weight,
        ),
      )
    }
    return clusters
  }

  // ── 3. OKLab k-means refinement ──────────────────────────

  fun refineInOklab(histogram: ColorHistogram, seeds: List<RgbCluster>): List<WeightedColor> {
    if (seeds.isEmpty()) return emptyList()
    val points = ArrayList<Oklab>()
    val weights = ArrayList<Double>()
    for (bin in histogram.counts.indices) {
      val count = histogram.counts[bin]
      if (count == 0) continue
      points.add(rgbToOklab(histogram.sumR[bin] / count, histogram.sumG[bin] / count, histogram.sumB[bin] / count))
      weights.add(count.toDouble())
    }

    val centroids = seeds.map { rgbToOklab(it.r, it.g, it.b) }.toMutableList()
    val assignment = IntArray(points.size) { -1 }
    val populations = DoubleArray(centroids.size)

    for (iteration in 0 until KMEANS_MAX_ITERATIONS) {
      var moved = 0
      for (p in points.indices) {
        val point = points[p]
        var nearest = 0
        var nearestDistance = Double.POSITIVE_INFINITY
        for (c in centroids.indices) {
          val dL = point.L - centroids[c].L
          val da = point.a - centroids[c].a
          val db = point.b - centroids[c].b
          val distance = dL * dL + da * da + db * db
          if (distance < nearestDistance) {
            nearestDistance = distance
            nearest = c
          }
        }
        if (assignment[p] != nearest) {
          assignment[p] = nearest
          moved += 1
        }
      }

      val sumL = DoubleArray(centroids.size)
      val sumA = DoubleArray(centroids.size)
      val sumB = DoubleArray(centroids.size)
      populations.fill(0.0)
      for (p in points.indices) {
        val cluster = assignment[p]
        val weight = weights[p]
        sumL[cluster] += points[p].L * weight
        sumA[cluster] += points[p].a * weight
        sumB[cluster] += points[p].b * weight
        populations[cluster] += weight
      }
      for (c in centroids.indices) {
        if (populations[c] <= 0) continue
        centroids[c] = Oklab(sumL[c] / populations[c], sumA[c] / populations[c], sumB[c] / populations[c])
      }
      if (moved == 0) break
    }

    return centroids.indices
      .map { WeightedColor(centroids[it], populations[it]) }
      .filter { it.population > 0 }
  }

  // ── 4. Scoring ───────────────────────────────────────────

  fun scoreColors(colors: List<WeightedColor>): List<ScoredColor> {
    val total = colors.sumOf { it.population }
    if (total <= 0) return emptyList()

    val hueShare = DoubleArray(360)
    for (color in colors) {
      if (chromaOf(color.lab) * CHROMA_UNITS < CHROMA_CUTOFF) continue
      hueShare[floor(hueOf(color.lab)).toInt() % 360] += color.population / total
    }
    val excited = DoubleArray(360)
    for (hue in 0 until 360) {
      for (offset in -HUE_WINDOW_BEFORE..HUE_WINDOW_AFTER) {
        excited[hue] += hueShare[(hue + offset + 360) % 360]
      }
    }

    val scored = ArrayList<ScoredColor>()
    for (color in colors) {
      val chroma = chromaOf(color.lab) * CHROMA_UNITS
      val proportion = excited[floor(hueOf(color.lab)).toInt() % 360]
      if (chroma < CHROMA_CUTOFF || proportion <= MIN_EXCITED_PROPORTION) continue
      val proportionScore = proportion * 100 * 0.7
      val chromaScore = (chroma - CHROMA_TARGET) * (if (chroma < CHROMA_TARGET) 0.1 else 0.3)
      scored.add(ScoredColor(color.lab, color.population, proportionScore + chromaScore))
    }
    // Stable, like Array.prototype.sort: equal scores keep cluster order.
    return scored.sortedByDescending { it.score }
  }

  // ── 5. Theme toning ──────────────────────────────────────

  private fun maxChroma(L: Double, chroma: Double, hue: Double): Double {
    if (inGamut(oklabToLinearRgb(oklch(L, chroma, hue)))) return chroma
    var low = 0.0
    var high = chroma
    for (step in 0 until 18) {
      val middle = (low + high) / 2
      if (inGamut(oklabToLinearRgb(oklch(L, middle, hue)))) low = middle else high = middle
    }
    return low
  }

  private fun gamutMapped(L: Double, chroma: Double, hue: Double): DoubleArray =
    oklabToLinearRgb(oklch(L, maxChroma(L, chroma, hue), hue))

  private fun chooseLightness(chroma: Double, hue: Double, band: Band): Double {
    if (chroma <= 0) return band.preferred
    var best = band.preferred
    var bestScore = Double.NEGATIVE_INFINITY
    var L = band.min
    while (L <= band.max + 1e-9) {
      val score = maxChroma(L, chroma, hue) - abs(L - band.preferred) * LIGHTNESS_DRIFT_COST
      if (score > bestScore) {
        bestScore = score
        best = L
      }
      L += 0.01
    }
    return best
  }

  fun toneForTheme(source: Oklab?, isLight: Boolean, onAccent: String): String {
    val chroma = if (source != null) max(chromaOf(source), CHROMA_FLOOR) else 0.0
    val hue = if (source != null) hueOf(source) else 0.0
    val onAccentLuminance = luminanceOfHex(onAccent) ?: (if (isLight) 1.0 else 0.0)
    val direction = if (onAccentLuminance > 0.5) -1 else 1
    var L = chooseLightness(chroma, hue, if (isLight) LIGHT_THEME_LIGHTNESS else DARK_THEME_LIGHTNESS)
    var rgb = gamutMapped(L, chroma, hue)
    while (contrast(relativeLuminanceOfLinear(rgb), onAccentLuminance) < MIN_ON_ACCENT_CONTRAST && L > 0.05 && L < 0.98) {
      L += direction * 0.02
      rgb = gamutMapped(L, chroma, hue)
    }
    return linearToHex(rgb)
  }

  // ── artworkField.ts ──────────────────────────────────────

  private fun isColored(lab: Oklab) = chromaOf(lab) * CHROMA_UNITS >= CHROMA_CUTOFF

  private fun hueDistance(a: Oklab, b: Oklab): Double {
    val d = abs(hueOf(a) - hueOf(b)) % 360
    return if (d > 180) 360 - d else d
  }

  private fun labDistance(a: Oklab, b: Oklab): Double = hypot(a.L - b.L, a.a - b.a, a.b - b.b)

  fun pickFieldSources(clusters: List<WeightedColor>): Pair<List<Oklab>, Boolean> {
    val total = clusters.sumOf { it.population }
    if (total <= 0) return Pair(emptyList(), true)
    val byPopulation = clusters
      .filter { it.population / total >= MIN_SHARE }
      .sortedByDescending { it.population }
    val colored = byPopulation.filter { isColored(it.lab) }

    val picks = ArrayList<Oklab>()
    fun tryAdd(lab: Oklab, separateHue: Boolean) {
      if (picks.size >= FIELD_SIZE) return
      if (picks.any { labDistance(it, lab) < MIN_LAB_DISTANCE }) return
      if (separateHue && picks.any { isColored(it) && hueDistance(it, lab) < MIN_HUE_SEPARATION }) return
      picks.add(lab)
    }

    colored.firstOrNull()?.let { tryAdd(it.lab, true) }
    scoreColors(clusters).firstOrNull()?.let { tryAdd(it.lab, true) }
    for (cluster in colored) tryAdd(cluster.lab, true)
    for (cluster in colored) tryAdd(cluster.lab, false)
    for (cluster in byPopulation) tryAdd(cluster.lab, false)

    val found = picks.size
    var i = 0
    while (found > 0 && picks.size < FIELD_SIZE) {
      picks.add(picks[i % found])
      i++
    }
    return Pair(picks, colored.isEmpty())
  }

  private fun fieldInGamut(rgb: DoubleArray): Boolean = rgb.all { it >= -1e-4 && it <= 1 + 1e-4 }

  fun oklchToHex(L: Double, chroma: Double, hueDegrees: Double): String {
    val h = (hueDegrees * Math.PI) / 180
    fun at(c: Double) = oklabToLinearRgb(Oklab(L, c * StrictMath.cos(h), c * StrictMath.sin(h)))
    var rgb = at(chroma)
    if (!fieldInGamut(rgb)) {
      var low = 0.0
      var high = chroma
      for (step in 0 until 18) {
        val middle = (low + high) / 2
        if (fieldInGamut(at(middle))) low = middle else high = middle
      }
      rgb = at(low)
    }
    return linearToHex(rgb)
  }

  fun toneField(sources: List<Oklab>, isDark: Boolean): List<String> {
    val tone = if (isDark) DARK_TONE else LIGHT_TONE
    return sources.mapIndexed { index, lab ->
      oklchToHex(
        tone.lightness[index % tone.lightness.size],
        min(chromaOf(lab) * tone.chromaScale, tone.chromaMax),
        hueOf(lab),
      )
    }
  }

  fun clusterArtworkPixels(pixels: IntArray): List<WeightedColor> {
    val histogram = buildHistogram(pixels)
    if (histogram.total <= 0) return emptyList()
    return refineInOklab(histogram, quantizeWu(histogram))
  }

  fun fieldFromClusters(clusters: List<WeightedColor>, isDark: Boolean): Field? {
    val (sources, neutral) = pickFieldSources(clusters)
    if (sources.isEmpty()) return null
    return Field(toneField(sources, isDark), neutral)
  }

  // ── fieldContrast.ts + colorUtils.ts ─────────────────────

  fun fieldStrength(isDark: Boolean, neutral: Boolean): Double =
    (if (isDark) FIELD_STRENGTH_DARK else FIELD_STRENGTH_LIGHT) * (if (neutral) FIELD_NEUTRAL_SCALE else 1.0)

  private fun rgbOf(hex: String): IntArray = intArrayOf(
    hex.substring(1, 3).toInt(16),
    hex.substring(3, 5).toInt(16),
    hex.substring(5, 7).toInt(16),
  )

  private fun channelHex(value: Double): String = hex2(jsRound(min(255.0, max(0.0, value))))

  fun rgbToHex(r: Double, g: Double, b: Double): String = "#${channelHex(r)}${channelHex(g)}${channelHex(b)}"

  fun mixHex(a: String, b: String, t: Double): String {
    val ca = rgbOf(a)
    val cb = rgbOf(b)
    return rgbToHex(
      ca[0] + (cb[0] - ca[0]) * t,
      ca[1] + (cb[1] - ca[1]) * t,
      ca[2] + (cb[2] - ca[2]) * t,
    )
  }

  fun relativeLuminance(hex: String): Double {
    val (r, g, b) = rgbOf(hex).toList()
    return 0.2126 * srgbToLinear(r.toDouble()) + 0.7152 * srgbToLinear(g.toDouble()) + 0.0722 * srgbToLinear(b.toDouble())
  }

  fun contrastRatio(a: String, b: String): Double = contrast(relativeLuminance(a), relativeLuminance(b))

  fun worstFieldSurface(background: String, field: List<String>, strength: Double, isDark: Boolean): String {
    var worst = background
    var worstLuminance = relativeLuminance(background)
    for (color in field) {
      val surface = mixHex(background, color, strength)
      val luminance = relativeLuminance(surface)
      if (if (isDark) luminance > worstLuminance else luminance < worstLuminance) {
        worst = surface
        worstLuminance = luminance
      }
    }
    return worst
  }

  fun liftToContrast(color: String, toward: String, surface: String, minimum: Double): String {
    if (contrastRatio(color, surface) >= minimum) return color
    var t = MIX_STEP
    while (t < 1) {
      val candidate = mixHex(color, toward, t)
      if (contrastRatio(candidate, surface) >= minimum) return candidate
      t += MIX_STEP
    }
    return toward
  }

  /** h in degrees [0,360), s/l in percent [0,100]. */
  fun hexToHsl(hex: String): DoubleArray {
    val (r, g, b) = rgbOf(hex).toList()
    val rn = r / 255.0
    val gn = g / 255.0
    val bn = b / 255.0
    val mx = max(rn, max(gn, bn))
    val mn = min(rn, min(gn, bn))
    val l = (mx + mn) / 2
    if (mx == mn) return doubleArrayOf(0.0, 0.0, l * 100)
    val d = mx - mn
    val s = if (l > 0.5) d / (2 - mx - mn) else d / (mx + mn)
    val h = when (mx) {
      rn -> ((gn - bn) / d + (if (gn < bn) 6 else 0)) / 6
      gn -> ((bn - rn) / d + 2) / 6
      else -> ((rn - gn) / d + 4) / 6
    }
    return doubleArrayOf(h * 360, s * 100, l * 100)
  }

  fun hslToHex(h: Double, s: Double, l: Double): String {
    val sn = min(100.0, max(0.0, s)) / 100
    val ln = min(100.0, max(0.0, l)) / 100
    val hn = (((h % 360) + 360) % 360) / 360
    if (sn == 0.0) {
      val v = ln * 255
      return rgbToHex(v, v, v)
    }
    val q = if (ln < 0.5) ln * (1 + sn) else ln + sn - ln * sn
    val p = 2 * ln - q
    fun hue(t: Double): Double {
      var tn = t
      if (tn < 0) tn += 1
      if (tn > 1) tn -= 1
      if (tn < 1.0 / 6) return p + (q - p) * 6 * tn
      if (tn < 1.0 / 2) return q
      if (tn < 2.0 / 3) return p + (q - p) * (2.0 / 3 - tn) * 6
      return p
    }
    return rgbToHex(hue(hn + 1.0 / 3) * 255, hue(hn) * 255, hue(hn - 1.0 / 3) * 255)
  }
}
