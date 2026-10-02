package expo.modules.astradiscord

import android.app.Activity
import com.discord.socialsdk.DiscordSocialSdkInit

object DiscordSdkActivity {
  fun initialize(activity: Activity) = DiscordSocialSdkInit.setEngineActivity(activity)
}

internal object DiscordNative {
  init { System.loadLibrary("astra_discord") }
  external fun open(applicationId: Long)
  external fun publish(request: Long, fields: Array<ByteArray>, start: Long, end: Long, statusDisplay: Int)
  external fun clear()
  external fun poll(): LongArray
  external fun close()
}

class SdkTransport : DiscordTransport {
  override fun open() = DiscordNative.open(1471059486100815915L)
  override fun publish(request: Long, activity: DiscordActivity) = DiscordNative.publish(
    request, arrayOf(activity.title, activity.state, activity.detailsUrl, activity.stateUrl,
      activity.largeImage, activity.largeText, activity.largeUrl, activity.smallImage).map { it.toByteArray(Charsets.UTF_8) }.toTypedArray(),
    activity.start, activity.end, activity.statusDisplay,
  )
  override fun clear() = DiscordNative.clear()
  override fun poll(): List<DiscordReceipt> = DiscordNative.poll().asList().chunked(2).map { DiscordReceipt(it[0], it[1] == 1L) }
  override fun close() = DiscordNative.close()
}
