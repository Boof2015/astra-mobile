package expo.modules.astratv

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BlurMaskFilter
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.Executors

/** Ambient's fixed 300dp cover shadow, rasterized once instead of re-blurring
 * a scaled rounded path throughout each cover entrance. Shared by all covers. */
class AstraTvAmbientShadow(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  companion object {
    private val worker = Executors.newSingleThreadExecutor { task ->
      Thread({ android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND); task.run() }, "AstraTvShadow").apply { isDaemon = true }
    }
    // The 80dp CSS blur corresponds to sigma 40. Half-resolution is ample for
    // this soft shape; use the same Android sigma-to-radius conversion as RN.
    private val shared = worker.submit<Bitmap> {
      val image = Bitmap.createBitmap(310, 310, Bitmap.Config.ARGB_8888)
      val canvas = Canvas(image)
      val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0x99000000.toInt()
        maskFilter = BlurMaskFilter((20f - .5f) / .57735f, BlurMaskFilter.Blur.NORMAL)
      }
      // 160dp bleed around the 300dp cover, offset down 34dp, radius 14dp.
      canvas.drawRoundRect(RectF(80f, 97f, 230f, 247f), 7f, 7f, paint)
      image.prepareToDraw()
      image
    }
  }

  private var bitmap: Bitmap? = null
  private var generation = 0
  private val destination = RectF()
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
  private val cover = Path()

  init { setWillNotDraw(false); isFocusable = false }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    val version = ++generation
    worker.execute {
      val image = shared.get()
      post { if (isAttachedToWindow && version == generation) { bitmap = image; invalidate() } }
    }
  }
  override fun onDetachedFromWindow() { generation++; bitmap = null; super.onDetachedFromWindow() }
  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    destination.set(0f, 0f, w.toFloat(), h.toFloat())
    val unit = w / 620f
    cover.reset()
    cover.fillType = Path.FillType.INVERSE_WINDING
    // Match RN's slight inset, which prevents antialiasing seams at the cover.
    cover.addRoundRect(RectF(160.4f * unit, 160.4f * unit, 459.6f * unit, 459.6f * unit), 14f * unit, 14f * unit, Path.Direction.CW)
  }
  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    bitmap?.let {
      val save = canvas.save()
      canvas.clipPath(cover)
      canvas.drawBitmap(it, null, destination, paint)
      canvas.restoreToCount(save)
    }
  }
  override fun hasOverlappingRendering() = false
  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) = Unit
}
