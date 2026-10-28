package expo.modules.astralibraryscanner.queue

import android.content.Context
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

class AstraQueueView(
  context: Context,
  appContext: AppContext,
) : ExpoView(context, appContext) {
  private val content = QueueContentView(context)

  // React Native swallows requestLayout() from native children, so rows the
  // RecyclerView receives after the first layout never got measured: the
  // companion pane showed "Up next" over an empty list. The sheet is immune
  // because a dialog is a plain Android hierarchy.
  override val shouldUseAndroidLayout: Boolean = true

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

  var paneMode: Boolean = false
    set(value) {
      field = value
      content.paneMode = value
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
