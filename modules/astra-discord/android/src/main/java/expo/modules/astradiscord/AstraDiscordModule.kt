package expo.modules.astradiscord

import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AstraDiscordModule : Module() {
  private var unsubscribe: (() -> Unit)? = null
  override fun definition() = ModuleDefinition {
    Name("AstraDiscord")
    Constants("available" to BuildConfig.SDK_AVAILABLE)
    Events("onStatus")
    OnCreate {
      appContext.reactContext?.let { DiscordPresenceManager.initialize(it) }
      unsubscribe = DiscordPresenceManager.subscribe { sendEvent("onStatus", it) }
    }
    OnDestroy { unsubscribe?.invoke(); unsubscribe = null }
    AsyncFunction("readLegalDocument") { id: String ->
      val asset = when (id) {
        "gpl" -> "notices/astra/LICENSE"
        "discord-exception" -> "notices/astra/LICENSE-DISCORD-EXCEPTION"
        "discord-sdk" -> if (BuildConfig.SDK_AVAILABLE) "notices/astra/DISCORD-SDK-NOTICE.txt" else null
        "discord-third-party" -> if (BuildConfig.SDK_AVAILABLE) "notices/discord/License-Notices.txt" else null
        else -> null
      } ?: throw IllegalArgumentException("Unknown legal document.")
      val context = appContext.reactContext ?: throw IllegalStateException("Astra is not ready.")
      context.assets.open(asset).bufferedReader().use { it.readText() }
    }
    Function("getStatus") { DiscordPresenceManager.status() }
    AsyncFunction("setEnabled") { enabled: Boolean, promise: Promise ->
      Handler(Looper.getMainLooper()).post {
        val context = appContext.reactContext
        if (context == null) promise.reject("ERR_CONTEXT", "Astra is not ready.", null)
        else {
          DiscordPresenceManager.setEnabled(context, enabled)
          promise.resolve(DiscordPresenceManager.status())
        }
      }
    }
    AsyncFunction("configure") { options: Map<String, Any?>, promise: Promise ->
      Handler(Looper.getMainLooper()).post {
        val context = appContext.reactContext
        if (context == null) promise.reject("ERR_CONTEXT", "Astra is not ready.", null)
        else {
          DiscordPresenceManager.configure(context, options)
          promise.resolve(DiscordPresenceManager.status())
        }
      }
    }
    AsyncFunction("clearArtworkCache") { promise: Promise ->
      Handler(Looper.getMainLooper()).post {
        DiscordPresenceManager.clearArtworkCache()
        promise.resolve(DiscordPresenceManager.status())
      }
    }
  }
}
