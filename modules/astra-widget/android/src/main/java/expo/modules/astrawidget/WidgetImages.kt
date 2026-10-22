package expo.modules.astrawidget

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.net.Uri
import android.util.Base64
import java.io.File
import java.util.LinkedHashMap
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Every bitmap the widget draws, cached by content. Responsive RemoteViews build
 * up to 16 size buckets at once and share these objects, so one render costs one
 * decode per cover.
 *
 * Evicted bitmaps are left to the GC rather than recycled: a bitmap the launcher
 * (or the Customize sheet's preview) still holds must never be recycled under it.
 */
internal class WidgetImages {
  private class Lru<V>(private val capacity: Int) : LinkedHashMap<String, V>(capacity, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, V>?) = size > capacity
  }

  private val bitmaps = Lru<Bitmap?>(48)
  private val colors = Lru<ArtworkColorMath.CoverColors?>(32)

  /** A cover cropped square, at most [maxPx], corners rounded by [radiusFraction] of its side. */
  @Synchronized
  fun art(context: Context, uri: String?, maxPx: Int, radiusFraction: Float): Bitmap? {
    if (uri.isNullOrBlank()) return null
    val key = "art|$maxPx|${(radiusFraction * 100).roundToInt()}|$uri"
    if (bitmaps.containsKey(key)) return bitmaps[key]
    val bitmap = decode(context, uri, maxPx)?.let { prepare(it, maxPx, radiusFraction) }
    bitmaps[key] = bitmap
    return bitmap
  }

  /**
   * Now playing's cover colors, from the same 128px thumbnail the app clusters.
   * Null when the cover can't be read.
   */
  @Synchronized
  fun coverColors(context: Context, thumbUri: String?): ArtworkColorMath.CoverColors? {
    if (thumbUri.isNullOrBlank()) return null
    if (colors.containsKey(thumbUri)) return colors[thumbUri]
    val result = decode(context, thumbUri, THUMB_PX)?.let { decoded ->
      val sample =
        if (decoded.width > THUMB_PX || decoded.height > THUMB_PX) {
          val scale = THUMB_PX.toFloat() / max(decoded.width, decoded.height)
          Bitmap.createScaledBitmap(
            decoded,
            max(1, (decoded.width * scale).roundToInt()),
            max(1, (decoded.height * scale).roundToInt()),
            true,
          ).also { if (it !== decoded) decoded.recycle() }
        } else {
          decoded
        }
      val argb = IntArray(sample.width * sample.height)
      sample.getPixels(argb, 0, sample.width, 0, 0, sample.width, sample.height)
      sample.recycle()
      val rgba = IntArray(argb.size * 4)
      argb.forEachIndexed { index, pixel ->
        rgba[index * 4] = (pixel shr 16) and 0xff
        rgba[index * 4 + 1] = (pixel shr 8) and 0xff
        rgba[index * 4 + 2] = pixel and 0xff
        rgba[index * 4 + 3] = (pixel ushr 24) and 0xff
      }
      ArtworkColorMath.coverColors(rgba, WidgetPalettes.ON_ACCENT_DARK, WidgetPalettes.ON_ACCENT_LIGHT)
    }
    colors[thumbUri] = result
    return result
  }

  /**
   * The cover gradient at rest: the surface, then three soft blobs placed as
   * NowPlayingBackdrop places them at phase 0, composited as one layer at the
   * field's strength. Drawn small and stretched; the blobs are soft enough that
   * the upscale doesn't show.
   */
  @Synchronized
  fun field(roles: WidgetRoles, widthPx: Int, heightPx: Int): Bitmap {
    val key = "field|$widthPx×$heightPx|${roles.surface}|${roles.field}|${roles.fieldStrength}"
    bitmaps[key]?.let { return it }
    val bitmap = Bitmap.createBitmap(widthPx, heightPx, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawColor(roles.argb(roles.surface))
    val field = roles.field
    if (field != null) {
      val layer = canvas.saveLayerAlpha(
        0f, 0f, widthPx.toFloat(), heightPx.toFloat(),
        (roles.fieldStrength * 255).roundToInt().coerceIn(0, 255),
      )
      val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { isDither = true }
      val reach = max(widthPx, heightPx).toFloat()
      BLOBS.forEachIndexed { index, blob ->
        val color = roles.argb(field[index % field.size])
        val x = ((blob.ox + 0.22 * sin(blob.seed * 2.1)) * widthPx).toFloat()
        val y = ((blob.oy + 0.12 * cos(blob.seed * 1.3)) * heightPx).toFloat()
        paint.shader = RadialGradient(x, y, blob.r * reach, color, color and 0x00ffffff, Shader.TileMode.CLAMP)
        canvas.drawRect(0f, 0f, widthPx.toFloat(), heightPx.toFloat(), paint)
      }
      canvas.restoreToCount(layer)
    }
    bitmaps[key] = bitmap
    return bitmap
  }

  /** No cover: the Astra mark on a tile, in the widget's own colors. */
  @Synchronized
  fun emptyArt(context: Context, roles: WidgetRoles, sizePx: Int, radiusFraction: Float): Bitmap {
    val key = "empty|$sizePx|${(radiusFraction * 100).roundToInt()}|${roles.tile}|${roles.accent}"
    bitmaps[key]?.let { return it }
    val bitmap = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val radius = sizePx * radiusFraction
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = roles.argb(roles.tile) }
    canvas.drawRoundRect(RectF(0f, 0f, sizePx.toFloat(), sizePx.toFloat()), radius, radius, paint)
    context.getDrawable(R.drawable.astra_widget_mark)?.mutate()?.let { mark ->
      val width = (sizePx * 0.46f).roundToInt()
      val height = (width * mark.intrinsicHeight.toFloat() / mark.intrinsicWidth).roundToInt()
      val left = (sizePx - width) / 2
      val top = (sizePx - height) / 2
      mark.setBounds(left, top, left + width, top + height)
      mark.setTint(roles.argb(roles.accent))
      mark.draw(canvas)
    }
    bitmaps[key] = bitmap
    return bitmap
  }

  private fun prepare(source: Bitmap, maxPx: Int, radiusFraction: Float): Bitmap {
    val side = min(source.width, source.height)
    val square = Bitmap.createBitmap(source, (source.width - side) / 2, (source.height - side) / 2, side, side)
    val scaled = if (side > maxPx) Bitmap.createScaledBitmap(square, maxPx, maxPx, true) else square
    val output = Bitmap.createBitmap(scaled.width, scaled.height, Bitmap.Config.ARGB_8888)
    val radius = scaled.width * radiusFraction
    Canvas(output).drawRoundRect(
      RectF(0f, 0f, scaled.width.toFloat(), scaled.height.toFloat()),
      radius,
      radius,
      Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
        shader = BitmapShader(scaled, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
      },
    )
    // Only the rounded output is ever shared; the intermediates are ours to free.
    listOf(source, square, scaled).distinct().forEach { if (it !== output && !it.isRecycled) it.recycle() }
    return output
  }

  private fun decode(context: Context, uri: String, maxPx: Int): Bitmap? {
    val bytes = runCatching { readImageBytes(context, uri) }.getOrNull() ?: return null
    if (bytes.isEmpty()) return null
    return runCatching {
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
      val largest = max(bounds.outWidth, bounds.outHeight)
      val sampleSize = if (largest <= maxPx || maxPx <= 0) 1 else Integer.highestOneBit(largest / maxPx).coerceAtLeast(1)
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sampleSize })
    }.getOrNull()
  }

  private fun readImageBytes(context: Context, value: String): ByteArray? {
    if (value.startsWith("data:image", ignoreCase = true)) {
      val encoded = value.substringAfter(',', missingDelimiterValue = "")
      if (encoded.isBlank()) return null
      return Base64.decode(encoded, Base64.DEFAULT)
    }
    val uri = Uri.parse(value)
    return when (uri.scheme) {
      "file" -> uri.path?.let { File(it).readBytes() }
      else -> context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
    }
  }

  private class Blob(val ox: Double, val oy: Double, val r: Float, val seed: Int)

  private companion object {
    /** The app's color extraction runs on its 128px thumbnails. */
    const val THUMB_PX = 128

    // NowPlayingBackdrop.tsx BLOBS, at phase 0.
    val BLOBS = listOf(
      Blob(0.3, 0.22, 0.95f, 0),
      Blob(0.72, 0.34, 0.85f, 1),
      Blob(0.48, 0.55, 0.75f, 2),
    )
  }
}
