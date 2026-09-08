package expo.modules.astracar

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.ServerSocket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AstraCarArtworkTest {
  @Test fun localOriginalIsBoundedAndTraversalIsRejected() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val file = File(File(context.filesDir, "artwork").apply { mkdirs() }, "car-regression-original.png")
    val bitmap = Bitmap.createBitmap(1800, 900, Bitmap.Config.ARGB_8888)
    file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    bitmap.recycle()
    try {
      assertNull(AstraCarArtwork.localFile(context, "../secrets", true))
      val cached = AstraCarArtworkCache.local(context, file, true)!!
      val decoded = BitmapFactory.decodeFile(cached.path)
      assertEquals(512, decoded.width)
      assertEquals(256, decoded.height)
      decoded.recycle()
      val art = AstraCarArtwork.forTrack(context, AstraCarTrack("song", "Song", "Artist", "Album",
        artwork = file.toURI().toString().replace("file:/", "file:///"), entryId = "1", queuePosition = 0))
      assertEquals("content", art.scheme)
      assertEquals(file.name, art.lastPathSegment)
    } finally { file.delete() }
  }

  @Test fun remoteDownloadsDeduplicateAndCredentialChangesRejectCachedAndLateResults() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val bitmap = Bitmap.createBitmap(1024, 1024, Bitmap.Config.ARGB_8888)
    val bytes = ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
    bitmap.recycle()
    val server = ServerSocket(0)
    val requests = AtomicInteger()
    val arrived = CountDownLatch(1)
    val release = CountDownLatch(1)
    val workers = Executors.newFixedThreadPool(6)
    val source = 9_999_998L
    val artId = "cover-${System.nanoTime()}"
    workers.submit {
      runCatching {
        server.accept().use { socket ->
          requests.incrementAndGet()
          val reader = socket.getInputStream().bufferedReader()
          while (!reader.readLine().isNullOrEmpty()) { /* consume headers */ }
          arrived.countDown()
          release.await(3, TimeUnit.SECONDS)
          socket.getOutputStream().apply {
            write("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray())
            write(bytes); flush()
          }
        }
      }
    }
    try {
      val template = "http://127.0.0.1:${server.localPort}/__ASTRA_ART_ID__?token=private-old"
      AstraCarArtworkCache.register(context, source, template)
      val futures = (1..4).map { workers.submit<File?> { AstraCarArtworkCache.remote(context, source, artId, true) } }
      assertTrue(arrived.await(3, TimeUnit.SECONDS))
      release.countDown()
      val files = futures.map { it.get(5, TimeUnit.SECONDS) }
      assertTrue(files.all { it != null && it.length() > 0 })
      assertEquals(1, requests.get())
      val uri = AstraCarArtwork.remoteUri(context, source, artId)
      assertFalse(uri.toString().contains("private-old"))
      assertFalse(uri.toString().contains("127.0.0.1"))
      AstraCarArtworkCache.register(context, source, template.replace("private-old", "private-new"))
      assertNull(AstraCarArtworkCache.cached(context, source, artId, true))
      assertNotEquals(uri, AstraCarArtwork.remoteUri(context, source, artId))
      val lateStarted = CountDownLatch(1)
      val finishLate = CountDownLatch(1)
      workers.submit {
        server.accept().use { socket ->
          val reader = socket.getInputStream().bufferedReader()
          while (!reader.readLine().isNullOrEmpty()) { }
          lateStarted.countDown()
          finishLate.await(3, TimeUnit.SECONDS)
          socket.getOutputStream().apply {
            write("HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray())
            write(bytes); flush()
          }
        }
      }
      val stale = workers.submit<File?> { AstraCarArtworkCache.remote(context, source, artId, true) }
      assertTrue(lateStarted.await(3, TimeUnit.SECONDS))
      AstraCarArtworkCache.register(context, source, template.replace("private-old", "private-newest"))
      finishLate.countDown()
      assertNull(stale.get(5, TimeUnit.SECONDS))
      assertNull(AstraCarArtworkCache.cached(context, source, artId, true))
      AstraCarArtworkCache.register(context, source, null)
      assertNull(AstraCarArtworkCache.remote(context, source, artId, true))
    } finally { release.countDown(); server.close(); workers.shutdownNow(); AstraCarArtworkCache.register(context, source, null) }
  }
}
