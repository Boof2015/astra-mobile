package expo.modules.astradesktopdiscovery

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.Inet4Address
import java.util.concurrent.ConcurrentHashMap

class AstraDesktopDiscoveryModule : Module() {
  private val serviceType = "_astra-remote._tcp."
  private var discoveryListener: NsdManager.DiscoveryListener? = null
  private val cached = ConcurrentHashMap<String, Map<String, Any?>>()

  override fun definition() = ModuleDefinition {
    Name("AstraDesktopDiscovery")

    Events("onDesktopRemoteFound", "onDesktopRemoteLost")

    AsyncFunction("start").Coroutine<Unit> {
      withContext(Dispatchers.Main) { startDiscovery() }
    }

    AsyncFunction("stop").Coroutine<Unit> {
      withContext(Dispatchers.Main) { stopDiscovery() }
    }

    Function("getCached") {
      cached.values.toList()
    }
  }

  private fun requireContext(): Context =
    appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun nsdManager(): NsdManager =
    requireContext().getSystemService(Context.NSD_SERVICE) as NsdManager

  private fun startDiscovery() {
    if (discoveryListener != null) return

    val listener = object : NsdManager.DiscoveryListener {
      override fun onDiscoveryStarted(regType: String) = Unit
      override fun onDiscoveryStopped(serviceType: String) = Unit
      override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
        stopDiscovery()
      }
      override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
        stopDiscovery()
      }
      override fun onServiceFound(serviceInfo: NsdServiceInfo) {
        if (serviceInfo.serviceType != serviceType) return
        resolve(serviceInfo)
      }
      override fun onServiceLost(serviceInfo: NsdServiceInfo) {
        cached.remove(serviceInfo.serviceName)
        sendEvent("onDesktopRemoteLost", mapOf("name" to serviceInfo.serviceName))
      }
    }

    discoveryListener = listener
    nsdManager().discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, listener)
  }

  private fun stopDiscovery() {
    val listener = discoveryListener ?: return
    discoveryListener = null
    try {
      nsdManager().stopServiceDiscovery(listener)
    } catch (_: Throwable) {
      // Android can throw if discovery already stopped. Treat stop as idempotent.
    }
  }

  private fun resolve(serviceInfo: NsdServiceInfo) {
    try {
      nsdManager().resolveService(serviceInfo, object : NsdManager.ResolveListener {
        override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) = Unit

        override fun onServiceResolved(resolved: NsdServiceInfo) {
          val host = resolved.host
          val address = host?.hostAddress ?: return
          if (host !is Inet4Address) return
          val port = resolved.port
          if (port <= 0) return

          val endpointUuid = txt(resolved, "endpoint_uuid")
          val desktopName = txt(resolved, "name")
          val protocolVersion = txt(resolved, "protocol_version")?.toIntOrNull() ?: 1
          val transport = txt(resolved, "transport")
          val certificateFingerprint = txt(resolved, "certificate_fingerprint")
          if (protocolVersion != 3 || transport != "https" || certificateFingerprint.isNullOrBlank()) return
          val payload = mapOf(
            "endpointUuid" to endpointUuid,
            "desktopName" to desktopName,
            "protocolVersion" to protocolVersion,
            "certificateFingerprint" to certificateFingerprint,
            "transport" to "https",
            "name" to (desktopName ?: resolved.serviceName),
            "baseUrl" to "https://$address:$port",
            "address" to address,
            "port" to port,
            "lastSeenAt" to System.currentTimeMillis(),
          )
          cached[resolved.serviceName] = payload
          sendEvent("onDesktopRemoteFound", payload)
        }
      })
    } catch (_: Throwable) {
      // Resolve races are normal while browsing; ignore and wait for the next mDNS packet.
    }
  }

  private fun txt(serviceInfo: NsdServiceInfo, key: String): String? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) return null
    val value = serviceInfo.attributes[key] ?: return null
    return value.toString(Charsets.UTF_8).trim().ifEmpty { null }
  }
}
