package expo.modules.astraaudioroute

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.MediaRouter
import android.os.Build
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.astrascope.EqBridge
import expo.modules.astrascope.GainBridge

class AstraAudioRouteModule : Module() {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var deviceCallback: AudioDeviceCallback? = null
  private var routeCallback: MediaRouter.Callback? = null
  private var listening = false

  override fun definition() = ModuleDefinition {
    Name("AstraAudioRoute")

    Events("onAudioRouteChanged")

    Function("getCurrentRoute") {
      snapshotRoute()
    }

    Function("getAudioDiagnostics") {
      snapshotDiagnostics()
    }

    Function("start") {
      startListening()
    }

    Function("stop") {
      stopListening()
    }

    OnDestroy {
      stopListening()
    }
  }

  private fun requireContext(): Context =
    appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun audioManager(): AudioManager =
    requireContext().getSystemService(Context.AUDIO_SERVICE) as AudioManager

  private fun mediaRouter(): MediaRouter =
    requireContext().getSystemService(Context.MEDIA_ROUTER_SERVICE) as MediaRouter

  private fun startListening() {
    if (listening) return
    listening = true

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      val callback = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) {
          emitCurrentRoute()
        }

        override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) {
          emitCurrentRoute()
        }
      }
      deviceCallback = callback
      audioManager().registerAudioDeviceCallback(callback, mainHandler)
    }

    val callback = object : MediaRouter.SimpleCallback() {
      override fun onRouteSelected(router: MediaRouter, type: Int, info: MediaRouter.RouteInfo) {
        emitCurrentRoute()
      }

      override fun onRouteUnselected(router: MediaRouter, type: Int, info: MediaRouter.RouteInfo) {
        emitCurrentRoute()
      }

      override fun onRouteChanged(router: MediaRouter, info: MediaRouter.RouteInfo) {
        emitCurrentRoute()
      }

      override fun onRouteAdded(router: MediaRouter, info: MediaRouter.RouteInfo) {
        emitCurrentRoute()
      }

      override fun onRouteRemoved(router: MediaRouter, info: MediaRouter.RouteInfo) {
        emitCurrentRoute()
      }
    }
    routeCallback = callback
    mediaRouter().addCallback(MediaRouter.ROUTE_TYPE_LIVE_AUDIO, callback)

    emitCurrentRoute()
  }

  private fun stopListening() {
    if (!listening) return
    listening = false

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      deviceCallback?.let {
        try {
          audioManager().unregisterAudioDeviceCallback(it)
        } catch (_: Throwable) {
          // Treat stop as idempotent.
        }
      }
    }
    deviceCallback = null

    routeCallback?.let {
      try {
        mediaRouter().removeCallback(it)
      } catch (_: Throwable) {
        // Treat stop as idempotent.
      }
    }
    routeCallback = null
  }

  private fun emitCurrentRoute() {
    mainHandler.post {
      sendEvent("onAudioRouteChanged", snapshotRoute())
    }
  }

  private fun snapshotRoute(): Map<String, Any?> {
    val selectedRouteName = selectedRouteName()
    val device = selectOutputDevice()
    return snapshotRoute(device, selectedRouteName)
  }

  private fun snapshotRoute(device: AudioDeviceInfo?, selectedRouteName: String?): Map<String, Any?> {
    val kind = device?.let { kindForType(it.type) } ?: "unknown"
    val identity = buildOutputRouteIdentity(
      kind,
      displayLabel(kind, device, selectedRouteName),
      deviceAddress(device),
      device?.productName?.toString(),
    )

    return mapOf(
      "key" to identity.key,
      "label" to identity.label,
      "kind" to kind,
      "nativeType" to device?.type,
      "nativeId" to device?.id,
      "selectedRouteName" to selectedRouteName,
      "updatedAt" to System.currentTimeMillis(),
    )
  }

  private fun selectedRouteName(): String? =
    try {
      mediaRouter()
        .getSelectedRoute(MediaRouter.ROUTE_TYPE_LIVE_AUDIO)
        ?.name
        ?.toString()
        ?.trim()
        ?.ifEmpty { null }
    } catch (_: Throwable) {
      null
    }

  private fun selectOutputDevice(): AudioDeviceInfo? {
    return selectDiagnosticDevice().first
  }

  private fun selectDiagnosticDevice(): Pair<AudioDeviceInfo?, String> {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return null to "unavailable"
    val outputs = try {
      audioManager().getDevices(AudioManager.GET_DEVICES_OUTPUTS).filter { it.isSink }
    } catch (_: Throwable) {
      emptyList()
    }
    val predicted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      try {
        val mediaAttributes = AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
          .build()
        audioManager().getAudioDevicesForAttributes(mediaAttributes).filter { it.isSink }
      } catch (_: Throwable) {
        emptyList()
      }
    } else {
      emptyList()
    }
    val device = selectPredictedOutputDevice(predicted, outputs) { kindForType(it.type) }
    return device to when {
      predicted.isNotEmpty() -> "media-prediction"
      device != null -> "connected-device-fallback"
      else -> "unavailable"
    }
  }

  /** Getter only: never starts route synchronization or applies an EQ/device profile. */
  private fun snapshotDiagnostics(): Map<String, Any?> {
    val (device, provenance) = selectDiagnosticDevice()
    return AudioDiagnosticsBridge.state.snapshot() + mapOf(
      "route" to device?.let {
        val route = snapshotRoute(it, selectedRouteName())
        route + ("label" to externalDeviceLabel(kindForType(it.type), it.productName?.toString(), route["label"] as String))
      },
      "routeProvenance" to provenance,
      "capabilities" to device?.let { runCatching { deviceCapabilities(it) }.getOrNull() },
      "processing" to mapOf(
        "eqEnabled" to EqBridge.enabled,
        "preampDb" to (20.0 * kotlin.math.log10(EqBridge.preampLinear.toDouble())).takeIf { it.isFinite() },
        "gainTargetDb" to (20.0 * kotlin.math.log10(GainBridge.targetGain.toDouble())).takeIf { it.isFinite() },
      ),
      "updatedAt" to System.currentTimeMillis(),
    )
  }

  private fun deviceCapabilities(device: AudioDeviceInfo): Map<String, Any?> {
    val profiles = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      runCatching {
        device.audioProfiles.map { profile ->
          mapOf(
            "encoding" to diagnosticEncoding(profile.format),
            "sampleRates" to profile.sampleRates.filter { it > 0 }.distinct().sorted(),
            "channelCounts" to (profile.channelMasks.map { Integer.bitCount(it) } +
              profile.channelIndexMasks.map { Integer.bitCount(it) }).filter { it > 0 }.distinct().sorted(),
          )
        }
      }.getOrNull()
    } else null
    return mapOf(
      "sampleRates" to device.sampleRates.filter { it > 0 }.distinct().sorted(),
      "encodings" to device.encodings.map { diagnosticEncoding(it) }.filterNotNull().distinct(),
      "channelCounts" to device.channelCounts.filter { it > 0 }.distinct().sorted(),
      "profiles" to profiles,
    )
  }

  private fun kindForType(type: Int): String =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      when (type) {
        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
        AudioDeviceInfo.TYPE_BLE_HEADSET,
        AudioDeviceInfo.TYPE_BLE_SPEAKER,
        AudioDeviceInfo.TYPE_BLE_BROADCAST -> "bluetooth"
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
        AudioDeviceInfo.TYPE_WIRED_HEADSET -> "wired"
        AudioDeviceInfo.TYPE_USB_ACCESSORY,
        AudioDeviceInfo.TYPE_USB_DEVICE,
        AudioDeviceInfo.TYPE_USB_HEADSET -> "usb"
        AudioDeviceInfo.TYPE_HDMI,
        AudioDeviceInfo.TYPE_HDMI_ARC,
        AudioDeviceInfo.TYPE_HDMI_EARC -> "hdmi"
        AudioDeviceInfo.TYPE_REMOTE_SUBMIX -> "remote"
        AudioDeviceInfo.TYPE_BUILTIN_EARPIECE,
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "speaker"
        else -> "unknown"
      }
    } else {
      "unknown"
    }

  private fun displayLabel(kind: String, device: AudioDeviceInfo?, selectedRouteName: String?): String {
    val productName = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      device?.productName?.toString()?.trim()?.ifEmpty { null }
    } else {
      null
    }
    val routeName = selectedRouteName?.takeIf { isUsefulRouteLabel(kind, it) }
    val deviceName = productName?.takeIf { isUsefulRouteLabel(kind, it) }
    return routeName ?: deviceName ?: defaultLabel(kind)
  }

  private fun deviceAddress(device: AudioDeviceInfo?): String? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      try {
        device?.address?.trim()?.ifEmpty { null }
      } catch (_: Throwable) {
        null
      }
    } else {
      null
    }

  private fun defaultLabel(kind: String): String =
    when (kind) {
      "speaker" -> "Phone speaker"
      "wired" -> "Wired headphones"
      "bluetooth" -> "Bluetooth"
      "usb" -> "USB audio"
      "hdmi" -> "HDMI audio"
      "remote" -> "Remote audio"
      else -> "Unknown output"
    }

  private fun isUsefulRouteLabel(kind: String, label: String): Boolean {
    val normalized = label.trim().lowercase()
    if (normalized.isEmpty()) return false
    val generic = setOf(
      "audio",
      "bluetooth",
      "bluetooth audio",
      "headphones",
      "headset",
      "phone",
      "phone speaker",
      "speaker",
      "speakers",
      "this device",
      "wired headphones",
    )
    if (normalized in generic) return false
    return kind == "bluetooth" || kind == "usb" || kind == "hdmi"
  }

}
