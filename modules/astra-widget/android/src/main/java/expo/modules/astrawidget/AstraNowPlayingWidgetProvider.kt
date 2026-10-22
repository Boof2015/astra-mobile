package expo.modules.astrawidget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.os.Bundle

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

  override fun onDeleted(context: Context, appWidgetIds: IntArray) {
    AstraWidgetConfigStore.delete(context, appWidgetIds)
  }

  override fun onRestored(context: Context, oldWidgetIds: IntArray, newWidgetIds: IntArray) {
    AstraWidgetConfigStore.remap(context, oldWidgetIds, newWidgetIds)
  }

  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    AstraWidgetCommands.send(context, intent.action)
  }

  companion object {
    private const val ACTION_PREFIX = "com.astra.mobile.widget"
    const val ACTION_PREVIOUS = "$ACTION_PREFIX.PREVIOUS"
    const val ACTION_PLAY_PAUSE = "$ACTION_PREFIX.PLAY_PAUSE"
    const val ACTION_NEXT = "$ACTION_PREFIX.NEXT"
  }
}
