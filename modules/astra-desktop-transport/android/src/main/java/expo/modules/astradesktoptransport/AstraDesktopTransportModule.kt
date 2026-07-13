package expo.modules.astradesktoptransport

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.PrivateKey
import java.security.cert.X509Certificate
import java.security.spec.X509EncodedKeySpec
import java.util.UUID
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSession
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

private const val MAX_REQUEST_BYTES = 2 * 1024 * 1024
private const val MAX_RESPONSE_BYTES = 5 * 1024 * 1024
private const val PAIRING_INFO = "astra-phone-remote-v3-pairing"
private const val PAIRING_AAD_PREFIX = "astra-phone-remote-v3-confirm:"

private data class PairingAttempt(
  val baseUrl: String,
  val requestId: String,
  val expiresAt: Long,
  val certificateFingerprint: String,
  val key: ByteArray,
  val transcript: ByteArray,
  val code: String,
)

private class ExactFingerprintTrustManager(expected: String) : X509TrustManager {
  private val expectedFingerprint = normalizeFingerprint(expected)

  init {
    require(expectedFingerprint.length == 64) { "Invalid desktop certificate fingerprint." }
  }

  override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) = Unit

  override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
    val leaf = chain?.firstOrNull() ?: throw java.security.cert.CertificateException("Desktop sent no certificate.")
    if (certificateFingerprint(leaf) != expectedFingerprint) {
      throw java.security.cert.CertificateException("Desktop certificate changed.")
    }
  }

  override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}

internal class ObservingTrustManager : X509TrustManager {
  @Volatile var observedFingerprint: String? = null
  override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) = Unit
  override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
    val leaf = chain?.firstOrNull() ?: throw java.security.cert.CertificateException("Desktop sent no certificate.")
    observedFingerprint = certificateFingerprint(leaf)
  }
  override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}

private fun normalizeFingerprint(value: String): String =
  value.uppercase().filter { it in '0'..'9' || it in 'A'..'F' }

private fun certificateFingerprint(certificate: X509Certificate): String =
  MessageDigest.getInstance("SHA-256").digest(certificate.encoded).joinToString("") { "%02X".format(it) }

private fun displayFingerprint(value: String): String =
  normalizeFingerprint(value).chunked(2).joinToString(":")

private fun base64Url(bytes: ByteArray): String =
  Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

private fun decodeBase64Url(value: String): ByteArray =
  Base64.getUrlDecoder().decode(value)

private fun hmac(key: ByteArray, data: ByteArray): ByteArray =
  Mac.getInstance("HmacSHA256").run {
    init(SecretKeySpec(key, "HmacSHA256"))
    doFinal(data)
  }

private fun hkdf(sharedSecret: ByteArray, salt: ByteArray, info: ByteArray, length: Int): ByteArray {
  val prk = hmac(salt, sharedSecret)
  val output = ByteArrayOutputStream()
  var previous = ByteArray(0)
  var counter = 1
  while (output.size() < length) {
    previous = hmac(prk, previous + info + byteArrayOf(counter.toByte()))
    output.write(previous)
    counter += 1
  }
  return output.toByteArray().copyOf(length)
}

internal fun derivePairingKey(
  privateKey: PrivateKey,
  peerPublicKey: String,
  transcript: ByteArray,
): ByteArray {
  val peerKey = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(decodeBase64Url(peerPublicKey)))
  val sharedSecret = KeyAgreement.getInstance("ECDH").run {
    init(privateKey)
    doPhase(peerKey, true)
    generateSecret()
  }
  return hkdf(
    sharedSecret,
    MessageDigest.getInstance("SHA-256").digest(transcript),
    PAIRING_INFO.toByteArray(),
    32
  )
}

internal fun derivePairingCode(key: ByteArray, transcript: ByteArray): String {
  val digest = hmac(key, "astra-phone-remote-v3-code".toByteArray() + transcript)
  val value = ((digest[0].toLong() and 0xff) shl 24) or
    ((digest[1].toLong() and 0xff) shl 16) or
    ((digest[2].toLong() and 0xff) shl 8) or (digest[3].toLong() and 0xff)
  return (value % 1_000_000L).toString().padStart(6, '0')
}

internal fun derivePairingProof(key: ByteArray, transcript: ByteArray): String =
  base64Url(hmac(key, "astra-phone-remote-v3-proof".toByteArray() + transcript))

private fun validateBaseUrl(baseUrl: String): URI {
  val uri = URI(baseUrl)
  if (!uri.scheme.equals("https", ignoreCase = true) || uri.host.isNullOrBlank()) {
    throw IllegalArgumentException("Desktop Remote requires HTTPS.")
  }
  if (uri.userInfo != null || uri.port == 0 || uri.port < -1 || uri.port > 65_535) {
    throw IllegalArgumentException("Invalid desktop base URL.")
  }
  if (uri.rawQuery != null || uri.rawFragment != null || (uri.path.isNotBlank() && uri.path != "/")) {
    throw IllegalArgumentException("Invalid desktop base URL.")
  }
  return uri
}

private fun sslContext(trustManager: X509TrustManager): SSLContext =
  SSLContext.getInstance("TLSv1.2").apply {
    init(null, arrayOf<TrustManager>(trustManager), SecureRandom())
  }

private fun pinnedHostnameVerifier(expected: String): HostnameVerifier = HostnameVerifier { _, session ->
  sessionFingerprint(session) == normalizeFingerprint(expected)
}

private fun sessionFingerprint(session: SSLSession): String? = try {
  val leaf = session.peerCertificates.firstOrNull() as? X509Certificate
  leaf?.let(::certificateFingerprint)
} catch (_: Throwable) {
  null
}

private fun openConnection(
  baseUrl: String,
  path: String,
  fingerprint: String,
  observingTrustManager: ObservingTrustManager? = null,
): HttpsURLConnection {
  val base = validateBaseUrl(baseUrl)
  if (!path.startsWith('/') || path.startsWith("//")) throw IllegalArgumentException("Invalid desktop request path.")
  val url = base.resolve(path).toURL()
  val trustManager = observingTrustManager ?: ExactFingerprintTrustManager(fingerprint)
  return (url.openConnection() as HttpsURLConnection).apply {
    sslSocketFactory = sslContext(trustManager).socketFactory
    hostnameVerifier = if (observingTrustManager != null) {
      HostnameVerifier { _, session ->
        val observed = observingTrustManager.observedFingerprint
        observed != null && sessionFingerprint(session) == observed
      }
    } else {
      pinnedHostnameVerifier(fingerprint)
    }
    instanceFollowRedirects = false
    useCaches = false
    connectTimeout = 8_000
    readTimeout = 8_000
  }
}

private fun readBounded(connection: HttpURLConnection): String {
  val stream = if (connection.responseCode >= 400) connection.errorStream else connection.inputStream
  if (stream == null) return ""
  stream.use { input ->
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    while (true) {
      val count = input.read(buffer)
      if (count < 0) break
      if (output.size() + count > MAX_RESPONSE_BYTES) throw IllegalStateException("Desktop response is too large.")
      output.write(buffer, 0, count)
    }
    return output.toString(Charsets.UTF_8.name())
  }
}

internal fun executeJson(
  baseUrl: String,
  path: String,
  method: String,
  body: String?,
  token: String?,
  fingerprint: String,
  timeoutMs: Int,
  observingTrustManager: ObservingTrustManager? = null,
): Pair<Int, String> {
  if (method != "GET" && method != "POST") throw IllegalArgumentException("Unsupported desktop request method.")
  val bodyBytes = body?.toByteArray(Charsets.UTF_8)
  if (bodyBytes != null && bodyBytes.size > MAX_REQUEST_BYTES) throw IllegalArgumentException("Desktop request is too large.")
  val connection = openConnection(baseUrl, path, fingerprint, observingTrustManager)
  try {
    connection.requestMethod = method
    connection.connectTimeout = timeoutMs.coerceIn(1_000, 60_000)
    connection.readTimeout = timeoutMs.coerceIn(1_000, 65_000)
    connection.setRequestProperty("Accept", "application/json")
    // Authorization is configured only on an exact-pin connection. TLS runs before HTTP bytes.
    if (observingTrustManager == null && !token.isNullOrBlank()) {
      connection.setRequestProperty("Authorization", "Bearer $token")
    }
    if (bodyBytes != null) {
      connection.doOutput = true
      connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
      connection.setFixedLengthStreamingMode(bodyBytes.size)
      connection.outputStream.use { it.write(bodyBytes) }
    }
    val status = connection.responseCode
    if (status in 300..399) throw IllegalStateException("Desktop Remote refuses redirects.")
    return status to readBounded(connection)
  } finally {
    connection.disconnect()
  }
}

class AstraDesktopTransportModule : Module() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val streams = ConcurrentHashMap<String, Job>()
  private val pairingAttempts = ConcurrentHashMap<String, PairingAttempt>()

  override fun definition() = ModuleDefinition {
    Name("AstraDesktopTransport")
    Events("onDesktopTransportSse", "onDesktopTransportClosed")

    AsyncFunction("requestJson").Coroutine { baseUrl: String, path: String, method: String,
      body: String?, token: String?, fingerprint: String, timeoutMs: Int ->
      withContext(Dispatchers.IO) {
        val (status, responseBody) = executeJson(baseUrl, path, method, body, token, fingerprint, timeoutMs)
        mapOf("status" to status, "body" to responseBody)
      }
    }

    AsyncFunction("startEventStream") { baseUrl: String, token: String, fingerprint: String ->
      validateBaseUrl(baseUrl)
      val streamId = UUID.randomUUID().toString()
      val job = scope.launch(start = CoroutineStart.LAZY) { runEventStream(streamId, baseUrl, token, fingerprint) }
      streams[streamId] = job
      job.start()
      streamId
    }

    Function("stopEventStream") { streamId: String ->
      streams.remove(streamId)?.cancel()
    }

    AsyncFunction("beginPinPairing").Coroutine { baseUrl: String, deviceName: String, clientLabel: String ->
      withContext(Dispatchers.IO) { beginPinPairing(baseUrl, deviceName, clientLabel) }
    }

    AsyncFunction("confirmPinPairing").Coroutine { attemptId: String, enteredCode: String ->
      withContext(Dispatchers.IO) { confirmPinPairing(attemptId, enteredCode) }
    }

    OnDestroy {
      streams.values.forEach { it.cancel() }
      streams.clear()
      pairingAttempts.clear()
    }
  }

  private fun beginPinPairing(baseUrl: String, deviceName: String, clientLabel: String): Map<String, Any?> {
    val now = System.currentTimeMillis()
    pairingAttempts.entries.removeIf { it.value.expiresAt <= now }
    validateBaseUrl(baseUrl)
    val keyPair = KeyPairGenerator.getInstance("EC").apply { initialize(256) }.generateKeyPair()
    val phonePublicKey = base64Url(keyPair.public.encoded)
    val observer = ObservingTrustManager()
    val requestBody = JSONObject()
      .put("deviceName", deviceName)
      .put("clientLabel", clientLabel)
      .put("phoneEphemeralPublicKey", phonePublicKey)
    // Filled after the TLS handshake by the observing trust manager, before this credential-free body is sent.
    val uri = validateBaseUrl(baseUrl)
    val connection = openConnection(baseUrl, "/v1/pairing/pin-request", "", observer)
    val bodyBytes: ByteArray
    val responseBody: String
    val status: Int
    try {
      connection.requestMethod = "POST"
      connection.doOutput = true
      connection.setChunkedStreamingMode(4096)
      connection.setRequestProperty("Accept", "application/json")
      connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
      connection.connect()
      val observed = observer.observedFingerprint ?: throw IllegalStateException("Desktop certificate was not observed.")
      requestBody.put("observedCertificateFingerprint", displayFingerprint(observed))
      bodyBytes = requestBody.toString().toByteArray(Charsets.UTF_8)
      connection.outputStream.use { it.write(bodyBytes) }
      status = connection.responseCode
      if (status in 300..399) throw IllegalStateException("Desktop Remote refuses redirects.")
      responseBody = readBounded(connection)
    } finally {
      connection.disconnect()
    }
    if (status !in 200..299) throw IllegalStateException(JSONObject(responseBody).optString("error", "PIN pairing failed ($status)."))
    val response = JSONObject(responseBody)
    val certificateFingerprint = response.optString("certificateFingerprint")
    val observed = observer.observedFingerprint ?: throw IllegalStateException("Desktop certificate was not observed.")
    if (normalizeFingerprint(certificateFingerprint) != observed) throw IllegalStateException("Pairing transcript certificate mismatch.")
    if (response.optInt("protocolVersion", 0) != 3) throw IllegalStateException("Desktop does not support secure protocol v3.")
    val requestId = response.getString("requestId")
    val desktopPublicKey = response.getString("desktopEphemeralPublicKey")
    val identity = response.optJSONObject("identity") ?: JSONObject()
    val endpointUuid = identity.optString("endpointUuid", "")
    val desktopPort = if (uri.port > 0) uri.port else 443
    val transcript = JSONArray()
      .put(3)
      .put(requestId)
      .put(phonePublicKey)
      .put(desktopPublicKey)
      .put(normalizeFingerprint(certificateFingerprint))
      .put(endpointUuid)
      .put(desktopPort)
      .toString().toByteArray(Charsets.UTF_8)
    val pairingKey = derivePairingKey(keyPair.private, desktopPublicKey, transcript)
    val code = derivePairingCode(pairingKey, transcript)
    val attemptId = UUID.randomUUID().toString()
    val expiresAt = response.optLong("expiresAt", 0L)
    pairingAttempts[attemptId] = PairingAttempt(
      baseUrl, requestId, expiresAt, displayFingerprint(certificateFingerprint), pairingKey, transcript, code
    )
    return mapOf(
      "attemptId" to attemptId,
      "requestId" to requestId,
      "expiresAt" to expiresAt,
      "desktopName" to identity.optString("desktopName").ifBlank { null },
      "certificateFingerprint" to displayFingerprint(certificateFingerprint),
      "protocolVersion" to 3,
    )
  }

  private fun confirmPinPairing(attemptId: String, enteredCode: String): Map<String, Any?> {
    val attempt = pairingAttempts[attemptId] ?: throw IllegalStateException("PIN pairing attempt expired.")
    if (System.currentTimeMillis() >= attempt.expiresAt) {
      pairingAttempts.remove(attemptId)
      throw IllegalStateException("PIN pairing attempt expired.")
    }
    if (enteredCode != attempt.code) throw IllegalArgumentException("Wrong PIN. Try again.")
    val proof = derivePairingProof(attempt.key, attempt.transcript)
    val requestBody = JSONObject().put("requestId", attempt.requestId).put("proof", proof).toString()
    val (status, responseBody) = executeJson(
      attempt.baseUrl, "/v1/pairing/pin-confirm", "POST", requestBody, null,
      attempt.certificateFingerprint, 8_000
    )
    if (status !in 200..299) throw IllegalStateException(JSONObject(responseBody).optString("error", "PIN confirmation failed ($status)."))
    val response = JSONObject(responseBody)
    if (normalizeFingerprint(response.optString("certificateFingerprint")) != normalizeFingerprint(attempt.certificateFingerprint)) {
      throw IllegalStateException("Pairing transcript certificate mismatch.")
    }
    val sealed = response.getJSONObject("sealed")
    val nonce = decodeBase64Url(sealed.getString("nonce"))
    val encrypted = decodeBase64Url(sealed.getString("ciphertext")) + decodeBase64Url(sealed.getString("authTag"))
    val aad = PAIRING_AAD_PREFIX.toByteArray() + MessageDigest.getInstance("SHA-256").digest(attempt.transcript)
    val plaintext = Cipher.getInstance("AES/GCM/NoPadding").run {
      init(Cipher.DECRYPT_MODE, SecretKeySpec(attempt.key, "AES"), GCMParameterSpec(128, nonce))
      updateAAD(aad)
      doFinal(encrypted)
    }
    pairingAttempts.remove(attemptId)
    val credentials = JSONObject(String(plaintext, Charsets.UTF_8))
    if (normalizeFingerprint(credentials.getString("certificateFingerprint")) != normalizeFingerprint(attempt.certificateFingerprint)) {
      throw IllegalStateException("Sealed credential certificate mismatch.")
    }
    return mapOf(
      "controlToken" to credentials.getString("controlToken"),
      "syncToken" to credentials.getString("syncToken"),
      "deviceId" to credentials.optString("deviceId").ifBlank { null },
      "issuedAt" to credentials.getLong("issuedAt"),
      "identityJson" to credentials.getJSONObject("identity").toString(),
      "certificateFingerprint" to attempt.certificateFingerprint,
    )
  }

  private suspend fun runEventStream(streamId: String, baseUrl: String, token: String, fingerprint: String) {
    var unauthorized = false
    var message = "Desktop event stream closed."
    val connection = openConnection(baseUrl, "/v1/events", fingerprint)
    try {
      connection.requestMethod = "GET"
      connection.readTimeout = 65_000
      connection.setRequestProperty("Accept", "text/event-stream")
      connection.setRequestProperty("Authorization", "Bearer $token")
      val status = connection.responseCode
      if (status in 300..399) throw IllegalStateException("Desktop Remote refuses redirects.")
      if (status == 401) {
        unauthorized = true
        message = "Desktop pairing was revoked."
        return
      }
      if (status !in 200..299) throw IllegalStateException("Desktop event stream failed ($status).")
      connection.inputStream.bufferedReader(Charsets.UTF_8).use { reader ->
        var eventName = "message"
        val data = mutableListOf<String>()
        while (true) {
          val line = reader.readLine() ?: break
          if (line.isEmpty()) {
            if (data.isNotEmpty()) sendEvent("onDesktopTransportSse", mapOf(
              "streamId" to streamId, "event" to eventName, "data" to data.joinToString("\n")
            ))
            eventName = "message"
            data.clear()
          } else if (line.startsWith("event:")) {
            eventName = line.substring(6).trim()
          } else if (line.startsWith("data:")) {
            data.add(line.substring(5).trimStart())
          }
        }
      }
    } catch (_: CancellationException) {
      message = ""
    } catch (error: Throwable) {
      message = error.message ?: "Desktop event stream failed."
    } finally {
      connection.disconnect()
      streams.remove(streamId)
      sendEvent("onDesktopTransportClosed", mapOf(
        "streamId" to streamId, "unauthorized" to unauthorized, "message" to message
      ))
    }
  }
}
