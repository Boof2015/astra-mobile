package expo.modules.astrawidget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.KeyEvent

class AstraNowPlayingWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray,
  ) {
    AstraWidgetUpdater.updateWidgets(context, appWidgetManager, appWidgetIds)
  }

  override fun onAppWidgetOptionsChanged(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetId: Int,
    newOptions: Bundle,
  ) {
    AstraWidgetUpdater.updateWidget(context, appWidgetManager, appWidgetId, newOptions)
  }

  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)

    when (intent.action) {
      ACTION_PREVIOUS -> dispatchMediaKey(context, KeyEvent.KEYCODE_MEDIA_PREVIOUS)
      ACTION_PLAY_PAUSE -> dispatchMediaKey(context, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
      ACTION_NEXT -> dispatchMediaKey(context, KeyEvent.KEYCODE_MEDIA_NEXT)
    }
  }

  private fun dispatchMediaKey(context: Context, keyCode: Int) {
    val audioManager =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        context.getSystemService(AudioManager::class.java)
      } else {
        @Suppress("DEPRECATION")
        context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
      } ?: return

    val eventTime = SystemClock.uptimeMillis()
    audioManager.dispatchMediaKeyEvent(KeyEvent(eventTime, eventTime, KeyEvent.ACTION_DOWN, keyCode, 0))
    audioManager.dispatchMediaKeyEvent(KeyEvent(eventTime, eventTime, KeyEvent.ACTION_UP, keyCode, 0))
  }

  companion object {
    private const val ACTION_PREFIX = "com.astra.mobile.widget"
    const val ACTION_PREVIOUS = "$ACTION_PREFIX.PREVIOUS"
    const val ACTION_PLAY_PAUSE = "$ACTION_PREFIX.PLAY_PAUSE"
    const val ACTION_NEXT = "$ACTION_PREFIX.NEXT"
  }
}
