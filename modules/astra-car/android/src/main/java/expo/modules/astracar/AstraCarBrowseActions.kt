package expo.modules.astracar

import android.content.Context
import android.os.Bundle

/** Wire constants from AndroidX MediaConstants; supported by legacy MediaBrowser clients too. */
object AstraCarBrowseActions {
  const val LIMIT = "androidx.media.utils.MediaBrowserCompat.extras.CUSTOM_BROWSER_ACTION_LIMIT"
  const val ROOT_ACTIONS = "androidx.media.utils.extras.CUSTOM_BROWSER_ACTION_ROOT_LIST"
  const val ITEM_ACTIONS = "androidx.media.utils.extras.CUSTOM_BROWSER_ACTION_ID_LIST"
  const val MEDIA_ID = "androidx.media.utils.extras.KEY_CUSTOM_BROWSER_ACTION_MEDIA_ITEM_ID"
  fun root(context: Context, limit: Int): ArrayList<Bundle> = ArrayList(
    listOf(Triple("playNext", "Play next", "ic_astra_play_next"), Triple("addToQueue", "Add to queue", "ic_astra_queue_add"))
      .take(limit.coerceIn(0, 2)).map { (id, label, icon) -> Bundle().apply {
        putString("androidx.media.utils.extras.KEY_CUSTOM_BROWSER_ACTION_ID", id)
        putString("androidx.media.utils.extras.KEY_CUSTOM_BROWSER_ACTION_LABEL", label)
        putString("androidx.media.utils.extras.KEY_CUSTOM_BROWSER_ACTION_ICON_URI", "android.resource://${context.packageName}/drawable/$icon")
      } })
}
