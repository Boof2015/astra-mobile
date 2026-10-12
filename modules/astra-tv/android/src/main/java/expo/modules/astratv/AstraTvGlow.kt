package expo.modules.astratv

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.Executors
import java.util.concurrent.Future
import kotlin.math.roundToInt

/** Same small, precoloured gradient bitmap as the TV SVG field, prepared away
 * from the UI thread. Drawing and all existing React transforms stay unchanged. */
class AstraTvGlow(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  companion object {
    private val worker = Executors.newSingleThreadExecutor { task ->
      Thread({ android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND); task.run() }, "AstraTvGlow").apply { isDaemon = true }
    }
    private val stops = floatArrayOf(0f, .18f, .36f, .56f, .76f, 1f)
    private val alphas = floatArrayOf(1f, .78f, .5f, .25f, .08f, 0f)
    // Geometry mirrors playerBlobs in TvAtmosphere.tsx (percent of 960 x 540).
    private val blobs = arrayOf(floatArrayOf(18f, 32f, 70f, 105f), floatArrayOf(86f, 18f, 72f, 92f), floatArrayOf(58f, 112f, 90f, 70f))
  }

  val onReady by EventDispatcher()
  var color = "#000000"
    set(value) { if (field != value) { field = value; schedule() } }
  var blobIndex = 0
    set(value) { val next = value.coerceIn(0, 2); if (field != next) { field = next; schedule() } }
  private var generation = 0
  private var task: Future<*>? = null
  private var bitmap: Bitmap? = null
  private val destination = RectF()
  private val bitmapPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
  private val prepare = Runnable {
    if (!isAttachedToWindow || width <= 0 || height <= 0) return@Runnable
    val version = ++generation
    val requestedColor = color
    val tint = runCatching { Color.parseColor(requestedColor) }.getOrDefault(Color.BLACK)
    val blob = blobs[blobIndex]
    val w = width.coerceAtMost(640)
    val h = height.coerceAtMost(370)
    task?.cancel(false)
    task = worker.submit {
      val image = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
      val canvas = Canvas(image)
      canvas.scale(w / 1280f, h / 740f)
      canvas.translate(160f, 100f)
      val cx = blob[0] * 9.6f; val cy = blob[1] * 5.4f
      val rx = blob[2] * 9.6f; val ry = blob[3] * 5.4f
      val colors = alphas.map { Color.argb((it * 255).roundToInt(), Color.red(tint), Color.green(tint), Color.blue(tint)) }.toIntArray()
      val shader = RadialGradient(cx, cy, rx, colors, stops, Shader.TileMode.CLAMP)
      shader.setLocalMatrix(Matrix().apply { setScale(1f, ry / rx, cx, cy) })
      canvas.drawRect(cx - rx, cy - ry, cx + rx, cy + ry, Paint(Paint.ANTI_ALIAS_FLAG).apply { this.shader = shader })
      image.prepareToDraw()
      post {
        if (version == generation && isAttachedToWindow) {
          bitmap = image
          invalidate()
          onReady(mapOf("color" to requestedColor))
        }
        // RenderThread may still reference the previous bitmap. Let it/GC own
        // that lifetime rather than recycling a bitmap from under a draw.
      }
    }
  }

  init { setWillNotDraw(false); isFocusable = false }

  private fun schedule() {
    generation++
    removeCallbacks(prepare)
    if (isAttachedToWindow) post(prepare)
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    destination.set(0f, 0f, w.toFloat(), h.toFloat())
    schedule()
  }
  override fun onAttachedToWindow() { super.onAttachedToWindow(); schedule() }
  override fun onDetachedFromWindow() {
    generation++; removeCallbacks(prepare); task?.cancel(false); task = null; bitmap = null
    super.onDetachedFromWindow()
  }
  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    bitmap?.let { canvas.drawBitmap(it, null, destination, bitmapPaint) }
  }
  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) = Unit
}
