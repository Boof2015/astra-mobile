package expo.modules.astradiscord

import android.app.Activity

object DiscordSdkActivity {
  fun initialize(activity: Activity) = Unit
}
class SdkTransport : DiscordTransport {
  override fun open() = Unit
  override fun publish(request: Long, activity: DiscordActivity) = Unit
  override fun clear() = Unit
  override fun poll(): List<DiscordReceipt> = emptyList()
  override fun close() = Unit
}
