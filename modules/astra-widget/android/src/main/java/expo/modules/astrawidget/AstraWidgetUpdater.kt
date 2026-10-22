package expo.modules.astrawidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.SizeF
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.RemoteViews
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

object AstraWidgetUpdater {
  private const val REQUEST_OPEN_APP = 100
  private const val REQUEST_OPEN_RECENTS = 101

  internal val images = WidgetImages()

  /**
   * Building RemoteViews decodes covers and renders every responsive size
   * bucket, then ships them to the launcher over Binder. Done synchronously from
   * JS it stalled now-playing's track-change animations (~250ms on S22U,
   * 2026-10-02). JS updates are therefore built on one background thread, and a
   * burst — a skip pushes "loading" then "playing" within milliseconds —
   * collapses into a single launcher update.
   */
  private val updateExecutor = Executors.newSingleThreadScheduledExecutor { runnable ->
    Thread(runnable, "astra-widget-update").apply {
      isDaemon = true
      priority = Thread.NORM_PRIORITY - 1
    }
  }
  private var pendingUpdate: ScheduledFuture<*>? = null
  private const val UPDATE_COALESCE_MS = 150L

  /** Renders for the launcher and the Customize sheet's preview share the image cache. */
  private val renderLock = Any()

  fun requestUpdateAll(context: Context) {
    val appContext = context.applicationContext
    synchronized(this) {
      pendingUpdate?.cancel(false)
      pendingUpdate = updateExecutor.schedule(
        { runCatching { updateAll(appContext) } },
        UPDATE_COALESCE_MS,
        TimeUnit.MILLISECONDS,
      )
    }
  }

  /** One widget, off the main thread: the Customize sheet's Save. */
  internal fun requestUpdate(context: Context, appWidgetId: Int) {
    val appContext = context.applicationContext
    updateExecutor.execute {
      runCatching {
        val manager = AppWidgetManager.getInstance(appContext)
        updateWidget(appContext, manager, appWidgetId, manager.getAppWidgetOptions(appWidgetId))
      }
    }
  }

  fun updateAll(context: Context) {
    val appContext = context.applicationContext
    val manager = AppWidgetManager.getInstance(appContext)
    val component = ComponentName(appContext, AstraNowPlayingWidgetProvider::class.java)
    updateWidgets(appContext, manager, manager.getAppWidgetIds(component))
  }

  fun updateWidgets(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
    if (appWidgetIds.isEmpty()) return
    synchronized(renderLock) {
      val state = AstraWidgetStateStore.load(context)
      val theme = AstraWidgetThemeStore.load(context)
      appWidgetIds.forEach { appWidgetId ->
        val config = AstraWidgetConfigStore.load(context, appWidgetId)
        manager.updateAppWidget(
          appWidgetId,
          buildRemoteViews(context, state, theme, config, manager.getAppWidgetOptions(appWidgetId)),
        )
      }
    }
  }

  fun updateWidget(context: Context, manager: AppWidgetManager, appWidgetId: Int, options: Bundle) {
    synchronized(renderLock) {
      val state = AstraWidgetStateStore.load(context)
      val theme = AstraWidgetThemeStore.load(context)
      val config = AstraWidgetConfigStore.load(context, appWidgetId)
      manager.updateAppWidget(appWidgetId, buildRemoteViews(context, state, theme, config, options))
    }
  }

  private fun buildRemoteViews(
    context: Context,
    state: AstraWidgetState,
    theme: AstraWidgetAppTheme?,
    config: AstraWidgetConfig,
    options: Bundle,
  ): RemoteViews {
    val render = Render(context, state, theme, config)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      return RemoteViews(BUCKETS.associate { it.size to render.build(it) })
    }
    return render.build(bestBucket(portraitSize(options)))
  }

  /** The widget as it would render at [size]: the Customize sheet's live preview. */
  internal fun buildPreview(context: Context, config: AstraWidgetConfig, size: SizeF): RemoteViews =
    synchronized(renderLock) {
      val state = AstraWidgetStateStore.load(context)
      val theme = AstraWidgetThemeStore.load(context)
      Render(context, state, theme, config).build(bestBucket(size))
    }

  /** Each style's colors for the current state, for the sheet's swatches. */
  internal fun paintFor(context: Context, config: AstraWidgetConfig): WidgetPaint =
    synchronized(renderLock) {
      val state = AstraWidgetStateStore.load(context)
      val theme = AstraWidgetThemeStore.load(context)
      val cover = if (state.hasTrack) images.coverColors(context, state.artworkUri) else null
      WidgetPalettes.resolve(context, config, cover, theme)
    }

  /** The size the widget currently occupies, as the launcher reports it. */
  internal fun currentSize(options: Bundle): SizeF {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      @Suppress("DEPRECATION")
      val sizes = options.getParcelableArrayList<SizeF>(AppWidgetManager.OPTION_APPWIDGET_SIZES)
      sizes?.firstOrNull()?.let { return it }
    }
    return portraitSize(options)
  }

  /** Launchers report portrait as min width × max height. */
  private fun portraitSize(options: Bundle): SizeF = SizeF(
    options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0).takeIf { it > 0 }?.toFloat() ?: 250f,
    options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0).takeIf { it > 0 }?.toFloat() ?: 110f,
  )

  // ── Size buckets ─────────────────────────────────────────

  internal enum class Family { STRIP, SQUARE_SIDE, SQUARE_STACKED, CARD, LARGE }

  // What sits beside or under the art, in dp, from the layouts and styles.
  // Inter with font padding off runs about 1.2× its size per line.
  private const val EYEBROW_DP = 20 // 11sp label + 6dp gap
  private const val TITLE_LINE_DP = 19 // 16sp
  private const val ARTIST_DP = 19 // 13sp + 3dp gap
  internal const val SQUARE_TEXT_DP = 48 // 10dp gap + 15sp title + artist
  internal const val STRIP_MIN_TEXT_DP = 56

  /** A column of eyebrow · title · artist over a play row. */
  internal fun columnNeed(eyebrow: Boolean, titleLines: Int, playDp: Int) =
    (if (eyebrow) EYEBROW_DP else 0) + titleLines * TITLE_LINE_DP + ARTIST_DP + playDp

  /**
   * A responsive size. The launcher shows the bucket nearest the widget's size
   * among those that fit (RemoteViews.findBestFitLayout), so a bucket is the
   * smallest size its layout must work at: everything here is decided for that
   * minimum, so nothing clips at it. Only the art grows into extra space,
   * through XML (match_parent with adjustViewBounds), and its caps keep it from
   * crowding the rest.
   */
  internal class Bucket(val family: Family, val widthDp: Int, val heightDp: Int, val recentLabels: Boolean = false) {
    val size = SizeF(widthDp.toFloat(), heightDp.toFloat())

    val layout: Int = when (family) {
      Family.STRIP -> R.layout.astra_widget_strip
      Family.SQUARE_SIDE -> R.layout.astra_widget_square_side
      Family.SQUARE_STACKED -> R.layout.astra_widget_square_stacked
      Family.CARD -> R.layout.astra_widget_card
      Family.LARGE -> R.layout.astra_widget_large
    }

    val padding: Int = if (family == Family.STRIP) 12 else 16
    val contentWidth = widthDp - 2 * padding
    val contentHeight = heightDp - 2 * padding

    /** Strip: under 240dp there's only room for the art and play. */
    val stripText: Boolean = widthDp >= 240
    val stripButtons: Int = if (widthDp >= 400) 3 else if (widthDp >= 300) 2 else 1

    /** Side square: the button column must fit beside the art, above the text. */
    val sideBand = contentHeight - SQUARE_TEXT_DP
    val sideButtons: Int = if (sideBand >= 136) 3 else if (sideBand >= 92) 2 else 1

    val showPrevious: Boolean = when (family) {
      Family.STRIP -> stripButtons == 3
      Family.SQUARE_SIDE -> sideButtons == 3
      else -> true
    }
    val showNext: Boolean = when (family) {
      Family.STRIP -> stripButtons >= 2
      Family.SQUARE_SIDE -> sideButtons >= 2
      else -> true
    }

    /** The widest the height-filled art may get before it crowds the buttons. */
    val artCap: Int? = when (family) {
      Family.STRIP -> {
        val buttons = when (stripButtons) { 3 -> 140; 2 -> 92; else -> 48 }
        contentWidth - buttons - (if (stripText) 12 + STRIP_MIN_TEXT_DP else 0)
      }
      Family.SQUARE_SIDE -> contentWidth - 56
      Family.CARD -> max(64, contentWidth - 14 - 150)
      else -> null
    }

    /** Card: a roomy column holds the eyebrow and two title lines over a 52dp play button. */
    private val compactCard: Boolean = family == Family.CARD && contentHeight < columnNeed(true, 2, 52)

    /** Large: the deck's declared art size, and the deck alone when recents are off. */
    fun deckArt(showRecents: Boolean): Int =
      if (showRecents) min(136, contentWidth - 14 - 150) else min(contentHeight, contentWidth - 14 - 150)

    private fun compactDeck(showRecents: Boolean) = deckArt(showRecents) < columnNeed(true, 2, 52)

    private fun compact(showRecents: Boolean): Boolean = when (family) {
      Family.CARD -> compactCard
      Family.LARGE -> compactDeck(showRecents)
      else -> false
    }

    fun showEyebrow(showRecents: Boolean): Boolean =
      (family == Family.CARD || family == Family.LARGE) && !compact(showRecents)

    fun titleLines(showRecents: Boolean): Int = if (compact(showRecents)) 1 else 2

    /**
     * The play button when the layout's own doesn't fit: a compact card at its
     * minimum has 78dp for title · artist · play, a compact deck 104dp.
     */
    fun playDp(showRecents: Boolean): Int? = when {
      family == Family.CARD && compactCard -> 40
      family == Family.LARGE && compactDeck(showRecents) -> 44
      else -> null
    }

    val recentTiles: Int = if (widthDp >= 440) 7 else if (widthDp >= 360) 6 else 5

    /** The art's size at this bucket's minimum, which its corner radius is drawn for. */
    fun artEstimate(showRecents: Boolean): Int = when (family) {
      Family.STRIP -> 72
      Family.SQUARE_SIDE -> max(48, min(artCap ?: 0, sideBand))
      Family.SQUARE_STACKED -> contentWidth
      Family.CARD -> max(48, min(artCap ?: 0, contentHeight))
      Family.LARGE -> deckArt(showRecents)
    }

    /** The gradient bitmap's aspect: strips are drawn for a typical row height. */
    fun fieldPx(): Pair<Int, Int> {
      val w = widthDp.toFloat()
      val h = if (family == Family.STRIP) 96f else heightDp.toFloat()
      return if (w >= h) FIELD_PX to max(16, (FIELD_PX * h / w).roundToInt()) else max(16, (FIELD_PX * w / h).roundToInt()) to FIELD_PX
    }
  }

  private const val FIELD_PX = 128
  private const val ART_PX = 512
  private const val RECENT_PX = 192
  private const val EMPTY_ART_PX = 192

  // Sixteen is the platform's cap. Square sides need 172dp before play and
  // next fit beside the art; shorter narrow sizes take the strip.
  internal val BUCKETS = listOf(
    Bucket(Family.STRIP, 180, 40),
    Bucket(Family.STRIP, 240, 40),
    Bucket(Family.STRIP, 300, 40),
    Bucket(Family.STRIP, 400, 40),
    Bucket(Family.SQUARE_SIDE, 160, 130),
    Bucket(Family.SQUARE_SIDE, 180, 172),
    Bucket(Family.SQUARE_SIDE, 240, 172),
    Bucket(Family.SQUARE_SIDE, 240, 250),
    Bucket(Family.SQUARE_STACKED, 160, 280),
    Bucket(Family.CARD, 300, 110),
    Bucket(Family.CARD, 300, 170),
    Bucket(Family.CARD, 360, 170),
    Bucket(Family.CARD, 440, 170),
    Bucket(Family.LARGE, 300, 250),
    Bucket(Family.LARGE, 360, 250),
    Bucket(Family.LARGE, 360, 300, recentLabels = true),
  )

  /** The platform's own pick (RemoteViews.findBestFitLayout), for pre-31 and the preview. */
  private fun bestBucket(size: SizeF): Bucket {
    fun fits(bucket: Bucket) =
      Math.ceil(size.width.toDouble()) + 1 > bucket.widthDp && Math.ceil(size.height.toDouble()) + 1 > bucket.heightDp
    fun distance(bucket: Bucket): Float {
      val dx = bucket.widthDp - size.width
      val dy = bucket.heightDp - size.height
      return dx * dx + dy * dy
    }
    return BUCKETS.filter(::fits).minByOrNull(::distance)
      ?: BUCKETS.minBy { it.widthDp * it.heightDp }
  }

  private val RECENT_IDS = intArrayOf(
    R.id.astra_widget_recent_1, R.id.astra_widget_recent_2, R.id.astra_widget_recent_3, R.id.astra_widget_recent_4,
    R.id.astra_widget_recent_5, R.id.astra_widget_recent_6, R.id.astra_widget_recent_7,
  )
  private val RECENT_IMAGE_IDS = intArrayOf(
    R.id.astra_widget_recent_1_image, R.id.astra_widget_recent_2_image, R.id.astra_widget_recent_3_image,
    R.id.astra_widget_recent_4_image, R.id.astra_widget_recent_5_image, R.id.astra_widget_recent_6_image,
    R.id.astra_widget_recent_7_image,
  )
  private val RECENT_LABEL_IDS = intArrayOf(
    R.id.astra_widget_recent_1_label, R.id.astra_widget_recent_2_label, R.id.astra_widget_recent_3_label,
    R.id.astra_widget_recent_4_label, R.id.astra_widget_recent_5_label, R.id.astra_widget_recent_6_label,
    R.id.astra_widget_recent_7_label,
  )

  // ── Rendering ────────────────────────────────────────────

  private class Render(
    private val context: Context,
    private val state: AstraWidgetState,
    theme: AstraWidgetAppTheme?,
    private val config: AstraWidgetConfig,
  ) {
    private val responsive = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    private val density = context.resources.displayMetrics.density
    private val outerRadiusDp = context.resources.getDimension(R.dimen.astra_widget_radius) / density
    // A "playing" stored by a process that has since died is stale: nothing plays without JS.
    private val playing = state.hasTrack && state.playbackState == "playing" && AstraWidgetCommands.jsAlive
    private val cover = if (state.hasTrack) images.coverColors(context, state.artworkUri) else null
    private val paint = WidgetPalettes.resolve(context, config, cover, theme)
    private val my = paint.materialYou

    /** Pre-31 renders once, for the configuration it's in now. */
    private val current: WidgetRoles by lazy {
      val night = (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
        Configuration.UI_MODE_NIGHT_YES
      paint.forNight(night)
    }

    /** Large shows its recents row only when it has something to show. */
    private val showRecents = config.showRecents && state.recentlyPlayed.isNotEmpty()

    private val title = if (state.hasTrack) state.title.cleanOrFallback("Unknown title") else "Astra"
    private val artist = if (state.hasTrack) state.artist.cleanOrFallback("Unknown artist") else "Tap to play"

    fun build(bucket: Bucket): RemoteViews {
      val views = RemoteViews(context.packageName, bucket.layout)
      bindBackground(views, bucket)
      bindText(views, bucket)
      bindArt(views, bucket)
      bindControls(views, bucket)
      bucket.artCap?.let { views.setInt(R.id.astra_widget_art, "setMaxWidth", px(it)) }
      if (bucket.family == Family.STRIP && !bucket.stripText) {
        views.setViewVisibility(R.id.astra_widget_text, View.GONE)
        if (responsive) views.setInt(R.id.astra_widget_content, "setGravity", Gravity.CENTER)
      }
      if (bucket.family == Family.LARGE) bindLarge(views, bucket)
      openAppPendingIntent(context)?.let { views.setOnClickPendingIntent(android.R.id.background, it) }
      return views
    }

    private fun px(dp: Int): Int = (dp * density).roundToInt()

    private fun RemoteViews.textColor(id: Int, res: Int?, pick: (WidgetRoles) -> Int) {
      when {
        responsive && res != null -> setColorStateList(id, "setTextColor", res)
        responsive -> setColorInt(id, "setTextColor", pick(paint.day), pick(paint.night))
        else -> setTextColor(id, pick(current))
      }
    }

    private fun RemoteViews.tint(id: Int, res: Int?, pick: (WidgetRoles) -> Int) {
      when {
        responsive && res != null -> setColorStateList(id, "setImageTintList", res)
        responsive -> setColorInt(id, "setColorFilter", pick(paint.day), pick(paint.night))
        else -> setInt(id, "setColorFilter", pick(current))
      }
    }

    /** One image per theme; the launcher swaps them with dark mode (API 31+). */
    private fun RemoteViews.themedImage(id: Int, make: (WidgetRoles) -> android.graphics.Bitmap) {
      if (responsive) {
        setIcon(id, "setImageIcon", Icon.createWithBitmap(make(paint.day)), Icon.createWithBitmap(make(paint.night)))
      } else {
        setImageViewBitmap(id, make(current))
      }
    }

    private fun bindBackground(views: RemoteViews, bucket: Bucket) {
      val bg = R.id.astra_widget_bg
      views.setInt(bg, "setImageAlpha", (config.opacity * 255 / 100).coerceIn(0, 255))
      if (responsive && (paint.day.field != null || paint.night.field != null)) {
        val (w, h) = bucket.fieldPx()
        views.themedImage(bg) { images.field(it, w, h) }
      } else {
        views.tint(bg, my?.surface) { it.argb(it.surface) }
      }
    }

    private fun bindText(views: RemoteViews, bucket: Bucket) {
      views.setTextViewText(R.id.astra_widget_title, title)
      views.setTextViewText(R.id.astra_widget_artist, artist)
      views.textColor(R.id.astra_widget_title, my?.title) { it.argb(it.title) }
      views.textColor(R.id.astra_widget_artist, my?.subtitle) { it.argb(it.subtitle) }
      if (bucket.family == Family.CARD || bucket.family == Family.LARGE) {
        views.setInt(R.id.astra_widget_title, "setMaxLines", bucket.titleLines(showRecents))
        if (bucket.showEyebrow(showRecents)) {
          val label = if (!state.hasTrack) "Astra" else if (playing) "Now playing" else "Paused"
          views.setTextViewText(R.id.astra_widget_eyebrow_label, label)
          views.textColor(R.id.astra_widget_eyebrow_label, my?.muted) { it.mutedArgb }
          views.tint(R.id.astra_widget_eyebrow_mark, my?.accent) { it.argb(it.accent) }
        } else {
          views.setViewVisibility(R.id.astra_widget_eyebrow, View.GONE)
        }
      }
    }

    private fun radiusFraction(bucket: Bucket): Float {
      val inner = max(outerRadiusDp - bucket.padding, 8f)
      return (inner / bucket.artEstimate(showRecents)).coerceIn(0.04f, 0.25f)
    }

    private fun bindArt(views: RemoteViews, bucket: Bucket) {
      val fraction = radiusFraction(bucket)
      val bitmap =
        if (state.hasTrack) images.art(context, state.artworkFullUri ?: state.artworkUri, ART_PX, fraction) else null
      if (bitmap != null) {
        views.setImageViewBitmap(R.id.astra_widget_art, bitmap)
      } else {
        views.themedImage(R.id.astra_widget_art) { images.emptyArt(context, it, EMPTY_ART_PX, fraction) }
      }
    }

    private fun bindControls(views: RemoteViews, bucket: Bucket) {
      views.setViewVisibility(R.id.astra_widget_previous, if (bucket.showPrevious) View.VISIBLE else View.GONE)
      views.setViewVisibility(R.id.astra_widget_next, if (bucket.showNext) View.VISIBLE else View.GONE)

      views.setImageViewResource(
        R.id.astra_widget_play_icon,
        if (playing) R.drawable.astra_widget_ic_pause else R.drawable.astra_widget_ic_play,
      )
      views.setImageViewResource(
        R.id.astra_widget_play_bg,
        if (playing && config.playButtonShape == PlayButtonShape.MORPH) {
          R.drawable.astra_widget_play_squircle
        } else {
          R.drawable.astra_widget_play_circle
        },
      )
      views.setContentDescription(R.id.astra_widget_play_pause, if (playing) "Pause" else "Play")
      views.tint(R.id.astra_widget_play_bg, my?.accent) { it.argb(it.accent) }
      views.tint(R.id.astra_widget_play_icon, my?.onAccent) { it.argb(it.onAccent) }
      views.tint(R.id.astra_widget_previous, my?.icon) { it.argb(it.icon) }
      views.tint(R.id.astra_widget_next, my?.icon) { it.argb(it.icon) }

      val playDp = bucket.playDp(showRecents)
      if (playDp != null && responsive) {
        views.setViewLayoutWidth(R.id.astra_widget_play_pause, playDp.toFloat(), TypedValue.COMPLEX_UNIT_DIP)
        views.setViewLayoutHeight(R.id.astra_widget_play_pause, playDp.toFloat(), TypedValue.COMPLEX_UNIT_DIP)
        // The glyph stays half the button.
        val inset = px(playDp / 4)
        views.setViewPadding(R.id.astra_widget_play_icon, inset, inset, inset, inset)
      }

      bindControl(views, R.id.astra_widget_previous, AstraNowPlayingWidgetProvider.ACTION_PREVIOUS, 1)
      bindControl(views, R.id.astra_widget_play_pause, AstraNowPlayingWidgetProvider.ACTION_PLAY_PAUSE, 2)
      bindControl(views, R.id.astra_widget_next, AstraNowPlayingWidgetProvider.ACTION_NEXT, 3)
    }

    private fun bindControl(views: RemoteViews, viewId: Int, action: String, requestCode: Int) {
      views.setBoolean(viewId, "setEnabled", state.hasTrack)
      if (!state.hasTrack && responsive) views.setFloat(viewId, "setAlpha", 0.38f)
      views.setOnClickPendingIntent(viewId, controlPendingIntent(context, action, requestCode))
    }

    private fun bindLarge(views: RemoteViews, bucket: Bucket) {
      val recents = state.recentlyPlayed
      if (responsive) {
        val art = bucket.deckArt(showRecents).toFloat()
        views.setViewLayoutWidth(R.id.astra_widget_art, art, TypedValue.COMPLEX_UNIT_DIP)
        views.setViewLayoutHeight(R.id.astra_widget_art, art, TypedValue.COMPLEX_UNIT_DIP)
        views.setViewLayoutHeight(R.id.astra_widget_deck_column, art, TypedValue.COMPLEX_UNIT_DIP)
      }
      if (!showRecents) {
        views.setViewVisibility(R.id.astra_widget_recent_container, View.GONE)
        return
      }

      val openRecents = openRecentlyPlayedPendingIntent(context)
      views.setOnClickPendingIntent(R.id.astra_widget_recent_container, openRecents)
      views.textColor(R.id.astra_widget_recents_header, my?.muted) { it.mutedArgb }
      val fraction = max(outerRadiusDp - 16, 8f).let { min(it, 10f) } / 50f
      for (index in RECENT_IDS.indices) {
        val item = recents.getOrNull(index)
        if (item == null || index >= bucket.recentTiles) {
          views.setViewVisibility(RECENT_IDS[index], View.GONE)
          continue
        }
        val imageId = RECENT_IMAGE_IDS[index]
        val bitmap = images.art(context, item.artworkUri, RECENT_PX, fraction)
        if (bitmap != null) {
          views.setImageViewBitmap(imageId, bitmap)
        } else {
          views.themedImage(imageId) { images.emptyArt(context, it, RECENT_PX, fraction) }
        }
        views.setContentDescription(imageId, item.title.cleanOrFallback("Recently played"))
        views.setOnClickPendingIntent(imageId, openRecents)
        if (bucket.recentLabels) {
          val labelId = RECENT_LABEL_IDS[index]
          views.setTextViewText(labelId, item.title.cleanOrFallback("Recently played"))
          views.textColor(labelId, my?.muted) { it.mutedArgb }
          views.setViewVisibility(labelId, View.VISIBLE)
        }
      }
    }
  }

  // ── Intents ──────────────────────────────────────────────

  private fun openAppPendingIntent(context: Context): PendingIntent? {
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
      action = Intent.ACTION_VIEW
      data = Uri.parse("trackplayer://notification.click")
    }

    return intent?.let {
      PendingIntent.getActivity(
        context,
        REQUEST_OPEN_APP,
        it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }
  }

  private fun openRecentlyPlayedPendingIntent(context: Context): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("astra:///recently-played")).apply {
      setPackage(context.packageName)
      flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
    }

    return PendingIntent.getActivity(
      context,
      REQUEST_OPEN_RECENTS,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun controlPendingIntent(context: Context, action: String, requestCode: Int): PendingIntent {
    val intent = Intent(context, AstraNowPlayingWidgetProvider::class.java).setAction(action)
    return PendingIntent.getBroadcast(
      context,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun String?.cleanOrFallback(fallback: String): String {
    val value = this?.trim()
    return if (value.isNullOrEmpty()) fallback else value
  }
}
