package expo.modules.astrawidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.graphics.BitmapShader
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.util.SizeF
import android.view.View
import android.widget.RemoteViews
import java.io.File
import java.util.LinkedHashMap

object AstraWidgetUpdater {
  private const val REQUEST_OPEN_APP = 100
  private const val REQUEST_OPEN_RECENTS = 101

  private const val ONE_ROW_MAX_HEIGHT_DP = 110
  private const val THREE_ROW_MIN_HEIGHT_DP = 300
  private const val FOUR_CELL_MIN_WIDTH_DP = 300
  private const val FIVE_CELL_MIN_WIDTH_DP = 370
  private const val ARTWORK_CORNER_RADIUS_DP = 8f
  private const val MAX_PREPARED_ARTWORK = 16
  private val artworkBitmaps = WidgetArtworkBitmaps()

  private val RECENT_IMAGE_IDS = intArrayOf(
    R.id.astra_widget_recent_1_image,
    R.id.astra_widget_recent_2_image,
    R.id.astra_widget_recent_3_image,
    R.id.astra_widget_recent_4_image,
    R.id.astra_widget_recent_5_image,
    R.id.astra_widget_recent_6_image,
    R.id.astra_widget_recent_7_image,
    R.id.astra_widget_recent_8_image,
  )

  private val RECENT_LABEL_IDS = intArrayOf(
    R.id.astra_widget_recent_1_label,
    R.id.astra_widget_recent_2_label,
    R.id.astra_widget_recent_3_label,
    R.id.astra_widget_recent_4_label,
    R.id.astra_widget_recent_5_label,
    R.id.astra_widget_recent_6_label,
    R.id.astra_widget_recent_7_label,
    R.id.astra_widget_recent_8_label,
  )

  fun updateAll(context: Context) {
    val appContext = context.applicationContext
    val manager = AppWidgetManager.getInstance(appContext)
    val component = ComponentName(appContext, AstraNowPlayingWidgetProvider::class.java)
    val appWidgetIds = manager.getAppWidgetIds(component)
    updateWidgets(appContext, manager, appWidgetIds)
  }

  fun updateWidgets(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
    if (appWidgetIds.isEmpty()) return

    val state = AstraWidgetStateStore.load(context)
    appWidgetIds.forEach { appWidgetId ->
      val options = manager.getAppWidgetOptions(appWidgetId)
      manager.updateAppWidget(
        appWidgetId,
        buildRemoteViews(context, state, options, artworkBitmaps),
      )
    }
  }

  fun updateWidget(context: Context, manager: AppWidgetManager, appWidgetId: Int, options: Bundle) {
    val state = AstraWidgetStateStore.load(context)
    manager.updateAppWidget(
      appWidgetId,
      buildRemoteViews(context, state, options, artworkBitmaps),
    )
  }

  private fun buildRemoteViews(
    context: Context,
    state: AstraWidgetState,
    options: Bundle,
    artwork: WidgetArtworkBitmaps,
  ): RemoteViews {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      return buildResponsiveRemoteViews(context, state, artwork)
    }

    return buildBucketRemoteViews(context, state, WidgetLayoutBucket.fromOptions(options), artwork)
  }

  private fun buildResponsiveRemoteViews(
    context: Context,
    state: AstraWidgetState,
    artwork: WidgetArtworkBitmaps,
  ): RemoteViews {
    val mapping =
      WidgetLayoutBucket.entries.associate { bucket ->
        bucket.minSize to buildBucketRemoteViews(context, state, bucket, artwork)
      }

    return RemoteViews(mapping)
  }

  private fun buildBucketRemoteViews(
    context: Context,
    state: AstraWidgetState,
    bucket: WidgetLayoutBucket,
    artwork: WidgetArtworkBitmaps,
  ): RemoteViews {
    val views = RemoteViews(context.packageName, bucket.layoutRes)
    val title = if (state.hasTrack) state.title.cleanOrFallback("Unknown title") else "Astra"
    val artist = if (state.hasTrack) state.artist.cleanOrFallback("Unknown artist") else "Tap to open"
    val isPlaying = state.hasTrack && state.playbackState == "playing"

    views.setTextViewText(R.id.astra_widget_title, title)
    views.setTextViewText(R.id.astra_widget_artist, artist)
    setImageView(context, artwork, views, R.id.astra_widget_art, state.artworkUri, 320)
    views.setOnClickPendingIntent(R.id.astra_widget_root, openAppPendingIntent(context))

    if (bucket.hasPlayPause) {
      bindPlayPause(views, context, isPlaying, state.hasTrack)
    }
    if (bucket.hasNext) {
      bindControl(views, context, R.id.astra_widget_next, AstraNowPlayingWidgetProvider.ACTION_NEXT, 3, state.hasTrack)
    }
    if (bucket.hasPrevious) {
      bindControl(
        views,
        context,
        R.id.astra_widget_previous,
        AstraNowPlayingWidgetProvider.ACTION_PREVIOUS,
        1,
        state.hasTrack,
      )
    }
    if (bucket.recentCount > 0) {
      bindRecentlyPlayed(context, views, state.recentlyPlayed, bucket, artwork)
    }

    return views
  }

  private fun bindPlayPause(
    views: RemoteViews,
    context: Context,
    isPlaying: Boolean,
    controlsEnabled: Boolean,
  ) {
    views.setImageViewResource(
      R.id.astra_widget_play_pause,
      if (isPlaying) R.drawable.astra_widget_ic_pause else R.drawable.astra_widget_ic_play,
    )
    views.setContentDescription(R.id.astra_widget_play_pause, if (isPlaying) "Pause" else "Play")
    bindControl(
      views,
      context,
      R.id.astra_widget_play_pause,
      AstraNowPlayingWidgetProvider.ACTION_PLAY_PAUSE,
      2,
      controlsEnabled,
    )
  }

  private fun bindControl(
    views: RemoteViews,
    context: Context,
    viewId: Int,
    action: String,
    requestCode: Int,
    controlsEnabled: Boolean,
  ) {
    views.setBoolean(viewId, "setEnabled", controlsEnabled)
    views.setOnClickPendingIntent(viewId, controlPendingIntent(context, action, requestCode))
  }

  private fun bindRecentlyPlayed(
    context: Context,
    views: RemoteViews,
    recentlyPlayed: List<AstraWidgetRecentItem>,
    bucket: WidgetLayoutBucket,
    artwork: WidgetArtworkBitmaps,
  ) {
    val openRecents = openRecentlyPlayedPendingIntent(context)
    views.setOnClickPendingIntent(R.id.astra_widget_recent_container, openRecents)

    for (index in 0 until bucket.recentCount) {
      val item = recentlyPlayed.getOrNull(index)
      val imageId = RECENT_IMAGE_IDS[index]
      setImageView(context, artwork, views, imageId, item?.artworkUri, 128)
      views.setContentDescription(imageId, item?.title.cleanOrFallback("Recently played"))
      views.setOnClickPendingIntent(imageId, openRecents)

      if (bucket.showRecentLabels) {
        val labelId = RECENT_LABEL_IDS[index]
        views.setTextViewText(labelId, item?.title.cleanOrFallback("Recently played"))
        views.setViewVisibility(labelId, View.VISIBLE)
      }
    }
  }

  private fun setImageView(
    context: Context,
    artwork: WidgetArtworkBitmaps,
    views: RemoteViews,
    viewId: Int,
    uri: String?,
    maxPx: Int,
  ) {
    val bitmap = artwork.get(context, uri, maxPx)
    if (bitmap != null) {
      views.setImageViewBitmap(viewId, bitmap)
    } else {
      views.setImageViewResource(viewId, R.drawable.astra_widget_art_placeholder)
    }
  }

  private fun prepareArtworkBitmap(context: Context, bitmap: Bitmap, maxPx: Int): Bitmap {
    val square = cropCenterSquare(bitmap)
    val scaled =
      if (maxPx > 0 && (square.width > maxPx || square.height > maxPx)) {
        Bitmap.createScaledBitmap(square, maxPx, maxPx, true)
      } else {
        square
      }
    val radiusPx = ARTWORK_CORNER_RADIUS_DP * context.resources.displayMetrics.density
    val rounded = roundBitmap(scaled, radiusPx)
    // The rounded output owns its pixels. Release decode/crop/scale
    // intermediates immediately instead of waiting for native Bitmap GC.
    listOf(bitmap, square, scaled).distinct().forEach { intermediate ->
      if (intermediate !== rounded && !intermediate.isRecycled) intermediate.recycle()
    }
    return rounded
  }

  private fun cropCenterSquare(bitmap: Bitmap): Bitmap {
    val size = minOf(bitmap.width, bitmap.height)
    if (size <= 0) return bitmap

    val left = (bitmap.width - size) / 2
    val top = (bitmap.height - size) / 2
    return Bitmap.createBitmap(bitmap, left, top, size, size)
  }

  private fun roundBitmap(bitmap: Bitmap, radiusPx: Float): Bitmap {
    val output = Bitmap.createBitmap(bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(output)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      shader = BitmapShader(bitmap, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
    }
    val rect = RectF(0f, 0f, bitmap.width.toFloat(), bitmap.height.toFloat())
    canvas.drawRoundRect(rect, radiusPx, radiusPx, paint)
    return output
  }

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

  private fun decodeBitmap(context: Context, uri: String?, maxPx: Int): Bitmap? {
    if (uri.isNullOrBlank()) return null
    val bytes = runCatching { readImageBytes(context, uri) }.getOrNull() ?: return null
    if (bytes.isEmpty()) return null

    return runCatching {
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
      val largest = maxOf(bounds.outWidth, bounds.outHeight)
      val sampleSize = if (largest <= maxPx || maxPx <= 0) {
        1
      } else {
        Integer.highestOneBit(largest / maxPx).coerceAtLeast(1)
      }
      val options = BitmapFactory.Options().apply { inSampleSize = sampleSize }
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
    }.getOrNull()
  }

  /**
   * Android 12 responsive RemoteViews builds all size buckets at once. Cache
   * each prepared cover by source/size so responsive buckets and later
   * play/pause refreshes reuse the same bounded native Bitmaps. Content-keyed
   * artwork paths make eviction safe when the queue/recents change.
   */
  private class WidgetArtworkBitmaps {
    private val prepared = LinkedHashMap<String, Bitmap?>(MAX_PREPARED_ARTWORK, 0.75f, true)

    @Synchronized
    fun get(context: Context, uri: String?, maxPx: Int): Bitmap? {
      if (uri.isNullOrBlank()) return null
      val key = "$maxPx:$uri"
      if (prepared.containsKey(key)) return prepared[key]
      val bitmap = decodeBitmap(context, uri, maxPx)?.let {
        prepareArtworkBitmap(context, it, maxPx)
      }
      prepared[key] = bitmap
      while (prepared.size > MAX_PREPARED_ARTWORK) {
        val eldest = prepared.entries.iterator().next()
        prepared.remove(eldest.key)
        eldest.value?.let { evicted ->
          if (!evicted.isRecycled) evicted.recycle()
        }
      }
      return bitmap
    }
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

  private fun String?.cleanOrFallback(fallback: String): String {
    val value = this?.trim()
    return if (value.isNullOrEmpty()) fallback else value
  }

  private enum class WidgetLayoutBucket(
    val layoutRes: Int,
    val hasPrevious: Boolean,
    val hasPlayPause: Boolean,
    val hasNext: Boolean,
    val recentCount: Int,
    val showRecentLabels: Boolean,
    val minSize: SizeF,
  ) {
    Compact3x1(
      R.layout.astra_widget_3x1,
      hasPrevious = false,
      hasPlayPause = false,
      hasNext = false,
      recentCount = 0,
      showRecentLabels = false,
      minSize = SizeF(180f, 40f),
    ),
    Compact4x1(
      R.layout.astra_widget_4x1,
      hasPrevious = false,
      hasPlayPause = true,
      hasNext = true,
      recentCount = 0,
      showRecentLabels = false,
      minSize = SizeF(FOUR_CELL_MIN_WIDTH_DP.toFloat(), 40f),
    ),
    Wide5x1(
      R.layout.astra_widget_5x1,
      hasPrevious = true,
      hasPlayPause = true,
      hasNext = true,
      recentCount = 0,
      showRecentLabels = false,
      minSize = SizeF(FIVE_CELL_MIN_WIDTH_DP.toFloat(), 40f),
    ),
    Tall3x3(
      R.layout.astra_widget_3x3,
      hasPrevious = false,
      hasPlayPause = true,
      hasNext = true,
      recentCount = 0,
      showRecentLabels = false,
      minSize = SizeF(180f, ONE_ROW_MAX_HEIGHT_DP.toFloat()),
    ),
    Expanded4x2(
      R.layout.astra_widget_4x2,
      hasPrevious = true,
      hasPlayPause = true,
      hasNext = true,
      recentCount = 5,
      showRecentLabels = false,
      minSize = SizeF(FOUR_CELL_MIN_WIDTH_DP.toFloat(), ONE_ROW_MAX_HEIGHT_DP.toFloat()),
    ),
    Expanded4x3(
      R.layout.astra_widget_4x3,
      hasPrevious = true,
      hasPlayPause = true,
      hasNext = true,
      recentCount = 8,
      showRecentLabels = true,
      minSize = SizeF(FOUR_CELL_MIN_WIDTH_DP.toFloat(), THREE_ROW_MIN_HEIGHT_DP.toFloat()),
    );

    companion object {
      fun fromOptions(options: Bundle): WidgetLayoutBucket {
        val minWidth = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, FOUR_CELL_MIN_WIDTH_DP)
        val minHeight = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, ONE_ROW_MAX_HEIGHT_DP)

        return fromSize(minWidth.toFloat(), minHeight.toFloat())
      }

      fun fromSize(widthDp: Float, heightDp: Float): WidgetLayoutBucket {
        if (heightDp < ONE_ROW_MAX_HEIGHT_DP) {
          return when {
            widthDp >= FIVE_CELL_MIN_WIDTH_DP -> Wide5x1
            widthDp >= FOUR_CELL_MIN_WIDTH_DP -> Compact4x1
            else -> Compact3x1
          }
        }

        if (widthDp < FOUR_CELL_MIN_WIDTH_DP) return Tall3x3
        if (heightDp < THREE_ROW_MIN_HEIGHT_DP) return Expanded4x2
        return Expanded4x3
      }
    }
  }
}
