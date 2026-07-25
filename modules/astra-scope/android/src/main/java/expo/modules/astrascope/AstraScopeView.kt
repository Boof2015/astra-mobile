package expo.modules.astrascope

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ComposeShader
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.Shader
import android.graphics.SurfaceTexture
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.view.TextureView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private object ScopeRenderDispatcher {
  private val thread = HandlerThread("AstraScopeRender").apply { start() }
  val handler = Handler(thread.looper)
}

/**
 * Android-native spectrum/oscilloscope surface. The shared worker owns every
 * FFT read and path mutation; the UI thread only paints the most recently
 * prepared front path.
 */
internal class AstraScopeView(
  context: Context,
  appContext: AppContext
) : ExpoView(context, appContext) {
  var mode = ScopeMode.SPECTRUM
  var source = ScopeSource.PRE
  var requestedActive = false
  var reducedMotion = false
  var frameMs = 32.0
  var analysisFrameMs = 32.0
  var smoothing = 0.92f
  var pointCount = 120
  var dbMin = -90f
  var dbMax = -10f
  var tiltDbPerOctave = 3.5f
  var scopeColor = Color.WHITE
  var lineWidthDp = 2f
  var lineOpacity = 1f
  var fillOpacity = 1f
  var glow = false
  var glowOpacity = 0.18f
  var edgeFade = false
  var edgeFadeWidthDp = 28f
  var gain = 1f
  var staticValues: FloatArray? = null

  private val density = resources.displayMetrics.density
  private val pathLock = Any()
  private val linePaths = arrayOf(Path(), Path())
  private val fillPaths = arrayOf(Path(), Path())
  private var frontPath = 0
  private val renderedValues = FloatArray(MAX_RENDER_POINTS)
  private var renderedPointCount = 0

  private val spectrumBytes =
    ByteBuffer.allocateDirect(AstraScopeProjection.SPECTRUM_BINS * Float.SIZE_BYTES)
      .order(ByteOrder.nativeOrder())
  private val spectrumFloats: FloatBuffer = spectrumBytes.asFloatBuffer()
  private val oscilloscopeBytes =
    ByteBuffer.allocateDirect(AstraScopeProjection.OSCILLOSCOPE_POINTS * Float.SIZE_BYTES)
      .order(ByteOrder.nativeOrder())
  private val oscilloscopeFloats: FloatBuffer = oscilloscopeBytes.asFloatBuffer()

  private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val textureView = TextureView(context)
  private val renderGate = ScopeRenderGate()
  private var attached = false
  private var windowVisible = false
  @Volatile
  private var surfaceAvailable = false
  private var scheduledToken = 0
  private var lastAnalysisAt = 0L
  private var lastDrawAt = 0L
  private var hasNewFrame = false
  @Volatile
  private var displayRefreshRate = 60f

  private val renderRunnable = object : Runnable {
    override fun run() {
      val token = scheduledToken
      if (!renderGate.isCurrent(token)) return

      val now = SystemClock.uptimeMillis()
      if (!requestedActive) {
        renderDecayFrame(token)
        return
      }

      val analysisCadence = AstraScopeProjection.cadenceMs(analysisFrameMs, displayRefreshRate)
      val drawCadence = AstraScopeProjection.cadenceMs(frameMs, displayRefreshRate)

      if (lastAnalysisAt == 0L || now - lastAnalysisAt >= analysisCadence) {
        lastAnalysisAt = now
        hasNewFrame = readScopeFrame()
      }
      if (hasNewFrame && (lastDrawAt == 0L || now - lastDrawAt >= drawCadence)) {
        if (!renderGate.isCurrent(token)) return
        preparePaths()
        hasNewFrame = false
        lastDrawAt = now
        publishFrame()
      }

      val loopCadence = min(analysisCadence, drawCadence)
      if (renderGate.isCurrent(token)) {
        ScopeRenderDispatcher.handler.postDelayed(this, loopCadence)
      }
    }
  }

  init {
    clipChildren = false
    clipToPadding = false
    textureView.isOpaque = false
    textureView.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
      override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
        surfaceAvailable = true
        restartRendering()
      }

      override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) {
        configurePaints()
        restartRendering()
      }

      override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
        surfaceAvailable = false
        cancelRendering()
        return true
      }

      override fun onSurfaceTextureUpdated(surface: SurfaceTexture) = Unit
    }
    addView(
      textureView,
      LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
    )
    configurePaints()
  }

  override fun hasOverlappingRendering(): Boolean = false

  fun commitProps() {
    configurePaints()
    restartRendering()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    attached = true
    windowVisible = windowVisibility == View.VISIBLE
    restartRendering()
  }

  override fun onDetachedFromWindow() {
    attached = false
    cancelRendering()
    super.onDetachedFromWindow()
  }

  override fun onWindowVisibilityChanged(visibility: Int) {
    super.onWindowVisibilityChanged(visibility)
    windowVisible = visibility == View.VISIBLE
    if (attached) restartRendering()
  }

  override fun onSizeChanged(width: Int, height: Int, oldWidth: Int, oldHeight: Int) {
    super.onSizeChanged(width, height, oldWidth, oldHeight)
    configurePaints()
    restartRendering()
  }

  private fun restartRendering() {
    ScopeRenderDispatcher.handler.removeCallbacks(renderRunnable)
    lastAnalysisAt = 0L
    lastDrawAt = 0L
    hasNewFrame = false

    val eligible = attached && windowVisible && surfaceAvailable && width > 0 && height > 0
    displayRefreshRate = display?.refreshRate ?: 60f
    scheduledToken = renderGate.update(eligible)
    if (eligible) ScopeRenderDispatcher.handler.post(renderRunnable)
  }

  private fun cancelRendering() {
    scheduledToken = renderGate.update(false)
    ScopeRenderDispatcher.handler.removeCallbacks(renderRunnable)
  }

  private fun readScopeFrame(): Boolean {
    val staticSnapshot = staticValues
    if (!requestedActive && staticSnapshot != null) {
      val count = min(min(staticSnapshot.size, pointCount), renderedValues.size)
      for (index in 0 until count) {
        renderedValues[index] = AstraScopeProjection.clamp01(staticSnapshot[index])
      }
      renderedPointCount = count
      return count >= 2
    }

    return when (mode) {
      ScopeMode.SPECTRUM -> {
        val count = if (source == ScopeSource.POST) {
          ScopeBridge.nativeFillSpectrumPostEq(
            spectrumBytes,
            AstraScopeProjection.SPECTRUM_BINS,
            smoothing
          )
        } else {
          ScopeBridge.nativeFillSpectrum(
            spectrumBytes,
            AstraScopeProjection.SPECTRUM_BINS,
            smoothing
          )
        }
        if (count <= 0) {
          false
        } else {
          renderedPointCount = pointCount.coerceIn(2, renderedValues.size)
          AstraScopeProjection.writeSpectrum(
            spectrumFloats,
            count,
            renderedValues,
            renderedPointCount,
            dbMin,
            dbMax,
            tiltDbPerOctave
          )
          true
        }
      }

      ScopeMode.OSCILLOSCOPE -> {
        val count = ScopeBridge.nativeFillOscilloscope(
          oscilloscopeBytes,
          AstraScopeProjection.OSCILLOSCOPE_POINTS
        )
        renderedPointCount = min(count, renderedValues.size)
        if (renderedPointCount < 2) {
          false
        } else {
          for (index in 0 until renderedPointCount) {
            renderedValues[index] =
              (oscilloscopeFloats.get(index) * gain).coerceIn(-1f, 1f)
          }
          true
        }
      }
    }
  }

  private fun renderDecayFrame(token: Int) {
    val staticSnapshot = staticValues
    if (staticSnapshot != null && mode == ScopeMode.SPECTRUM) {
      readScopeFrame()
      preparePaths()
      publishFrame()
      return
    }

    val count = renderedPointCount
    val peak = if (reducedMotion || count < 2) {
      renderedValues.fill(0f)
      0f
    } else {
      AstraScopeProjection.decay(renderedValues, count)
    }
    if (peak < AstraScopeProjection.REST_EPSILON) {
      renderedValues.fill(0f, 0, count)
    }
    preparePaths()
    publishFrame()

    if (peak >= AstraScopeProjection.REST_EPSILON && renderGate.isCurrent(token)) {
      val cadence = AstraScopeProjection.cadenceMs(frameMs, displayRefreshRate)
      ScopeRenderDispatcher.handler.postDelayed(renderRunnable, cadence)
    }
  }

  private fun preparePaths() {
    val count = renderedPointCount
    val canvasWidth = width.toFloat()
    val canvasHeight = height.toFloat()
    if (count < 2 || canvasWidth <= 0f || canvasHeight <= 0f) return

    val back = 1 - frontPath
    val line = linePaths[back]
    val fill = fillPaths[back]
    line.reset()
    fill.reset()

    val pad = lineWidthDp * density
    val usableHeight = max(0f, canvasHeight - pad * 2f)
    fun xAt(index: Int) = index.toFloat() / (count - 1).toFloat() * canvasWidth
    fun yAt(index: Int): Float {
      return if (mode == ScopeMode.SPECTRUM) {
        pad + (1f - AstraScopeProjection.clamp01(renderedValues[index])) * usableHeight
      } else {
        canvasHeight * 0.5f - renderedValues[index] * max(0f, canvasHeight * 0.5f - pad)
      }
    }

    line.moveTo(0f, yAt(0))
    if (mode == ScopeMode.SPECTRUM) {
      for (index in 1 until count) {
        val previousX = xAt(index - 1)
        val previousY = yAt(index - 1)
        line.quadTo(
          previousX,
          previousY,
          (previousX + xAt(index)) * 0.5f,
          (previousY + yAt(index)) * 0.5f
        )
      }
      line.lineTo(canvasWidth, yAt(count - 1))
      fill.addPath(line)
      fill.lineTo(canvasWidth, canvasHeight)
      fill.lineTo(0f, canvasHeight)
      fill.close()
    } else {
      for (index in 1 until count) line.lineTo(xAt(index), yAt(index))
    }

    synchronized(pathLock) {
      frontPath = back
    }
  }

  private fun configurePaints() {
    synchronized(pathLock) {
      val lineWidth = max(0.5f, lineWidthDp * density)
      configureStrokePaint(strokePaint, lineWidth, lineOpacity)
      configureStrokePaint(glowPaint, lineWidth * 3f, glowOpacity)
      fillPaint.style = Paint.Style.FILL
      fillPaint.shader = createFillShader()
      fillPaint.color = withAlpha(scopeColor, 0.38f * fillOpacity)
    }
  }

  /**
   * SurfaceTexture publication does not invalidate the React/Android view tree.
   * The serialized scope worker prepares and rasterizes this small transparent
   * layer; the platform compositor presents it with the retained scene.
   */
  private fun publishFrame() {
    if (!surfaceAvailable) return
    val canvas = textureView.lockCanvas() ?: return
    try {
      canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
      synchronized(pathLock) {
        if (mode == ScopeMode.SPECTRUM && fillOpacity > 0f) {
          canvas.drawPath(fillPaths[frontPath], fillPaint)
        }
        if (glow) canvas.drawPath(linePaths[frontPath], glowPaint)
        canvas.drawPath(linePaths[frontPath], strokePaint)
      }
    } finally {
      textureView.unlockCanvasAndPost(canvas)
    }
  }

  private fun configureStrokePaint(paint: Paint, width: Float, opacity: Float) {
    paint.style = Paint.Style.STROKE
    paint.strokeCap = Paint.Cap.ROUND
    paint.strokeJoin = Paint.Join.ROUND
    paint.strokeWidth = width
    paint.color = withAlpha(scopeColor, opacity)
    paint.shader = if (edgeFade && this.width > 0 && edgeFadeWidthDp > 0f) {
      val fade = min(edgeFadeWidthDp * density, this.width * 0.5f)
      LinearGradient(
        0f,
        0f,
        this.width.toFloat(),
        0f,
        intArrayOf(
          withAlpha(scopeColor, 0f),
          withAlpha(scopeColor, opacity),
          withAlpha(scopeColor, opacity),
          withAlpha(scopeColor, 0f)
        ),
        floatArrayOf(0f, fade / this.width, 1f - fade / this.width, 1f),
        Shader.TileMode.CLAMP
      )
    } else {
      null
    }
  }

  private fun createFillShader(): Shader? {
    if (width <= 0 || height <= 0 || fillOpacity <= 0f) return null
    val vertical = LinearGradient(
      0f,
      0f,
      0f,
      height.toFloat(),
      intArrayOf(
        withAlpha(scopeColor, 0.38f * fillOpacity),
        withAlpha(scopeColor, 0.08f * fillOpacity),
        withAlpha(scopeColor, 0f)
      ),
      null,
      Shader.TileMode.CLAMP
    )
    if (!edgeFade || edgeFadeWidthDp <= 0f) return vertical

    val fade = min(edgeFadeWidthDp * density, width * 0.5f)
    val mask = LinearGradient(
      0f,
      0f,
      width.toFloat(),
      0f,
      intArrayOf(Color.TRANSPARENT, Color.WHITE, Color.WHITE, Color.TRANSPARENT),
      floatArrayOf(0f, fade / width, 1f - fade / width, 1f),
      Shader.TileMode.CLAMP
    )
    return ComposeShader(vertical, mask, PorterDuff.Mode.MULTIPLY)
  }

  private fun withAlpha(color: Int, opacity: Float): Int {
    val baseAlpha = Color.alpha(color) / 255f
    val alpha = (255f * baseAlpha * opacity.coerceIn(0f, 1f)).roundToInt()
    return Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color))
  }

  companion object {
    private const val MAX_RENDER_POINTS = 512
  }
}
