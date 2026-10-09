package expo.modules.astratv

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Shader
import android.view.View
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/** TV collection/lyrics fades recorded directly into the hardware canvas.
 * No full-viewport bitmap or software drawing of an SVG mask is needed. */
class AstraTvViewport(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val mask = Paint().apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_IN) }
  private var stops = floatArrayOf(0f, 0f, 1f, 1f)
  var horizontal = false
    set(value) { if (field != value) { field = value; updateShader() } }

  init {
    clipChildren = true
    clipToPadding = true
    // Keep the masked result in a hardware layer. A fresh saveLayer on every
    // moving lyric frame forces expensive nested composition on TV drivers.
    setLayerType(View.LAYER_TYPE_HARDWARE, null)
  }

  fun setStops(value: List<Double>) {
    if (value.size != 4 || value.any { !it.isFinite() }) return
    val next = value.map { it.toFloat().coerceIn(0f, 1f) }.toFloatArray()
    if ((1..3).any { next[it] < next[it - 1] } || stops.contentEquals(next)) return
    stops = next
    updateShader()
  }

  private fun updateShader() {
    if (width > 0 && height > 0) mask.shader = LinearGradient(
      0f, 0f, if (horizontal) width.toFloat() else 0f, if (horizontal) 0f else height.toFloat(),
      intArrayOf(Color.TRANSPARENT, Color.WHITE, Color.WHITE, Color.TRANSPARENT), stops, Shader.TileMode.CLAMP
    )
    invalidate()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    updateShader()
  }

  // Fabric/Yoga owns the position and size of the React children.
  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) = Unit

  override fun dispatchDraw(canvas: Canvas) {
    if (width <= 0 || height <= 0) return
    val layer = if (canvas.isHardwareAccelerated) canvas.save()
      else canvas.saveLayer(0f, 0f, width.toFloat(), height.toFloat(), null)
    canvas.clipRect(0, 0, width, height)
    super.dispatchDraw(canvas)
    canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), mask)
    canvas.restoreToCount(layer)
  }
}
