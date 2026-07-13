package expo.modules.astradesktoptransport

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertArrayEquals
import org.junit.Test
import java.net.InetSocketAddress
import java.net.InetAddress
import java.security.KeyFactory
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.security.spec.PKCS8EncodedKeySpec
import java.util.Base64
import java.util.concurrent.CopyOnWriteArrayList
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLServerSocket
import kotlin.concurrent.thread

class AstraDesktopTransportModuleTest {
  private var server: SSLServerSocket? = null
  private var serverThread: Thread? = null

  @After fun tearDown() {
    server?.close()
    serverThread?.join(1_000)
  }

  @Test fun correctPinSendsAuthorizationAndReturnsJson() {
    val fixture = startServer(200, "{\"ok\":true}")
    val (status, body) = executeJson(
      fixture.baseUrl, "/v1/identity", "GET", null, "control-secret",
      fixture.fingerprint, 5_000
    )
    assertEquals(200, status)
    assertEquals("{\"ok\":true}", body)
    assertEquals(listOf("Bearer control-secret"), fixture.authorizationHeaders)
  }

  @Test fun wrongCertificateFailsBeforeAuthorizationOrPayload() {
    val fixture = startServer(200, "{\"ok\":true}")
    val wrongFingerprint = "00".repeat(32)
    assertThrows(Throwable::class.java) {
      executeJson(
        fixture.baseUrl, "/v1/sync/apply", "POST", "{\"private\":\"sync-payload\"}",
        "sync-secret", wrongFingerprint, 5_000
      )
    }
    assertEquals(emptyList<String>(), fixture.authorizationHeaders)
    assertEquals(emptyList<String>(), fixture.requestBodies)
  }

  @Test fun redirectIsNeverFollowed() {
    val fixture = startServer(302, "")
    assertThrows(IllegalStateException::class.java) {
      executeJson(
        fixture.baseUrl, "/v1/identity", "GET", null, null,
        fixture.fingerprint, 5_000
      )
    }
    assertEquals(1, fixture.requestCount())
  }

  @Test fun pairingTranscriptMatchesTheDesktopProtocolVector() {
    val privateKey = KeyFactory.getInstance("EC").generatePrivate(
      PKCS8EncodedKeySpec(Base64.getDecoder().decode(KEY_DER_BASE64))
    )
    val transcript = "[3,\"pairing-test\",\"$PUBLIC_KEY_BASE64URL\",\"$PUBLIC_KEY_BASE64URL\",\"$CERT_FINGERPRINT\",\"endpoint-test\",38402]"
      .toByteArray()
    val key = derivePairingKey(privateKey, PUBLIC_KEY_BASE64URL, transcript)
    assertArrayEquals(hex("f6755aa6d05cb1f5ce79f7d01c716feaa97efa552521fc8b5841877c859c9038"), key)
    assertEquals("824321", derivePairingCode(key, transcript))
    assertEquals("8VqyqyI_ndBul51SD2OU4eia4e_SGr2pu_0EdJ-iJVw", derivePairingProof(key, transcript))
  }

  private fun hex(value: String): ByteArray = value.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

  private data class Fixture(
    val baseUrl: String,
    val fingerprint: String,
    val authorizationHeaders: CopyOnWriteArrayList<String>,
    val requestBodies: CopyOnWriteArrayList<String>,
    val requestCount: () -> Int,
  )

  private fun startServer(status: Int, responseBody: String): Fixture {
    val certificate = CertificateFactory.getInstance("X.509")
      .generateCertificate(CERT_DER_BASE64.byteInputStream().let(Base64.getDecoder()::wrap)) as X509Certificate
    val privateKey = KeyFactory.getInstance("EC").generatePrivate(
      PKCS8EncodedKeySpec(Base64.getDecoder().decode(KEY_DER_BASE64))
    )
    val password = "test-password".toCharArray()
    val keyStore = KeyStore.getInstance(KeyStore.getDefaultType()).apply {
      load(null, null)
      setKeyEntry("server", privateKey, password, arrayOf(certificate))
    }
    val keyManagers = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply {
      init(keyStore, password)
    }
    val context = SSLContext.getInstance("TLSv1.2").apply {
      init(keyManagers.keyManagers, null, SecureRandom())
    }
    val auth = CopyOnWriteArrayList<String>()
    val bodies = CopyOnWriteArrayList<String>()
    var count = 0
    server = context.serverSocketFactory.createServerSocket(
      0, 16, InetAddress.getByName("127.0.0.1")
    ) as SSLServerSocket
    val socketServer = server!!
    serverThread = thread(name = "astra-desktop-transport-test-server", isDaemon = true) {
      while (!socketServer.isClosed) {
        try {
          socketServer.accept().use { socket ->
            val input = socket.getInputStream().bufferedReader(Charsets.UTF_8)
            val requestLine = input.readLine() ?: return@use
            if (requestLine.isBlank()) return@use
            val headers = mutableMapOf<String, String>()
            while (true) {
              val line = input.readLine() ?: break
              if (line.isEmpty()) break
              val separator = line.indexOf(':')
              if (separator > 0) headers[line.substring(0, separator).lowercase()] = line.substring(separator + 1).trim()
            }
            count += 1
            headers["authorization"]?.let(auth::add)
            val length = headers["content-length"]?.toIntOrNull() ?: 0
            if (length > 0) {
              val body = CharArray(length)
              var offset = 0
              while (offset < length) {
                val read = input.read(body, offset, length - offset)
                if (read < 0) break
                offset += read
              }
              if (offset > 0) bodies.add(String(body, 0, offset))
            }
            val bytes = responseBody.toByteArray()
            val reason = if (status in 300..399) "Found" else "OK"
            val response = buildString {
              append("HTTP/1.1 $status $reason\r\n")
              append("Content-Type: application/json\r\n")
              append("Content-Length: ${bytes.size}\r\n")
              if (status in 300..399) append("Location: /redirected\r\n")
              append("Connection: close\r\n\r\n")
            }.toByteArray()
            socket.getOutputStream().use { output ->
              output.write(response)
              output.write(bytes)
              output.flush()
            }
          }
        } catch (_: Throwable) {
          if (!socketServer.isClosed) continue
        }
      }
    }
    val fingerprint = MessageDigest.getInstance("SHA-256")
      .digest(certificate.encoded)
      .joinToString("") { "%02X".format(it) }
    return Fixture(
      "https://127.0.0.1:${(server!!.localSocketAddress as InetSocketAddress).port}", fingerprint, auth, bodies, { count }
    )
  }

  companion object {
    private const val CERT_DER_BASE64 = "MIIBgzCCASmgAwIBAgIQb1XrfH3Pjja0eaxzR9J2NTAKBggqhkjOPQQDAjAUMRIwEAYDVQQDEwlsb2NhbGhvc3QwHhcNMjYwNzEyMjMwMzE2WhcNMzYwNzEwMjMwMzE2WjAUMRIwEAYDVQQDEwlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAQyKPCr7mEqvp/LVhnUgexpbTOPcq09dRNMfeF96uSbPXaL2E7qktUQFLYNm6A0kv3i6XK0aZiIcjUHrhNiJkjKo10wWzASBgNVHRMBAf8ECDAGAQH/AgEAMA4GA1UdDwEB/wQEAwIChDAWBgNVHSUBAf8EDDAKBggrBgEFBQcDATAdBgNVHQ4EFgQUT3YyZJjuQU9t1PTIM6ShuJX1j6QwCgYIKoZIzj0EAwIDSAAwRQIgcoTHim922rYnRyOduB8pMQNplwQ4N33xxV3BmphP09ICIQCV+FdMVUE8ykFdluehZ63HXYa+UUJOk9v3K8LKdS6HKQ=="
    private const val KEY_DER_BASE64 = "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgC2+uZe2nmL2ChsSJDBMu9bkQu9NSlaNn0eCuf1CxcPqhRANCAAQyKPCr7mEqvp/LVhnUgexpbTOPcq09dRNMfeF96uSbPXaL2E7qktUQFLYNm6A0kv3i6XK0aZiIcjUHrhNiJkjK"
    private const val PUBLIC_KEY_BASE64URL = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEMijwq-5hKr6fy1YZ1IHsaW0zj3KtPXUTTH3hferkmz12i9hO6pLVEBS2DZugNJL94ulytGmYiHI1B64TYiZIyg"
    private const val CERT_FINGERPRINT = "7FE09E5A9EE622987491D2877F9E3661AAA0ABC253CC3220BCC4AA9E28C3D14F"
  }
}
