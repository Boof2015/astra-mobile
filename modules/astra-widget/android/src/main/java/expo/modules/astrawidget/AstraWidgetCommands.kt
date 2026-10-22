package expo.modules.astrawidget

import android.content.Context
import expo.modules.astracar.AstraCarCommandService

/**
 * Routes the widget's buttons to Astra itself. They used to be system media-key
 * events, which only reach a media session that is already alive: with Astra
 * closed they did nothing, or went to whichever other player was active last.
 *
 * Astra running (its JS is listening) → the command goes straight to JS, which
 * runs it through the same queue Android Auto uses.
 * Astra not running → AstraCarCommandService starts it headless, restores the
 * saved session and then plays or skips: Android Auto's cold-start path.
 */
internal object AstraWidgetCommands {
  @Volatile
  private var sink: ((String) -> Unit)? = null

  /**
   * Whether JS has pushed now-playing in this process. Until it has, a stored
   * "playing" is left over from a process that's gone, and nothing is playing.
   */
  @Volatile
  var jsAlive = false

  fun attach(deliver: (String) -> Unit) {
    sink = deliver
  }

  fun detach() {
    sink = null
  }

  /** Called on the main thread from the provider's onReceive. */
  fun send(context: Context, action: String?) {
    val command = when (action) {
      AstraNowPlayingWidgetProvider.ACTION_PLAY_PAUSE -> "togglePlay"
      AstraNowPlayingWidgetProvider.ACTION_NEXT -> "next"
      AstraNowPlayingWidgetProvider.ACTION_PREVIOUS -> "previous"
      else -> return
    }
    val live = sink
    if (live != null && runCatching { live(command) }.isSuccess) return
    // Nothing can be playing in a process JS hasn't started in, so toggling means play.
    AstraCarCommandService.startTransport(context, if (command == "togglePlay") "play" else command)
  }
}
