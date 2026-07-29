package expo.modules.astralibraryscanner.queue

import android.content.Context
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

class AstraQueueView(
  context: Context,
  appContext: AppContext,
) : ExpoView(context, appContext) {
  private val content = QueueContentView(context)

  var active: Boolean = true
    set(value) {
      field = value
      content.active = value
    }

  var palette: QueuePalette = QueuePalette()
    set(value) {
      field = value
      content.palette = value
    }

  init {
    addView(
      content,
      LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT),
    )
  }

  fun setPlaybackRequestListener(listener: QueueContentView.PlaybackRequestListener?) {
    content.playbackRequestListener = listener
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    content.attach()
  }

  override fun onDetachedFromWindow() {
    content.detach()
    super.onDetachedFromWindow()
  }
}
