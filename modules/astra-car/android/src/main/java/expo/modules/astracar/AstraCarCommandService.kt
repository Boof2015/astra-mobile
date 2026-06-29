package expo.modules.astracar

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class AstraCarCommandService : HeadlessJsTaskService() {
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // We're started via startForegroundService (so transport from the car works even when
    // the app is backgrounded — the media-session callback grants the FGS-start allowlist).
    // Promote immediately to satisfy the "call startForeground within ~5s" requirement.
    if (intent?.getStringExtra(EXTRA_COMMAND) != null) {
      promoteToForeground()
    }
    return super.onStartCommand(intent, flags, startId)
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val command = intent?.getStringExtra(EXTRA_COMMAND) ?: return null
    val data = Arguments.createMap().apply {
      putString("command", command)
      intent.getBundleExtra(EXTRA_MEDIA)?.let { putMap("media", Arguments.fromBundle(it)) }
      if (intent.hasExtra(EXTRA_QUERY)) putString("query", intent.getStringExtra(EXTRA_QUERY))
      if (intent.hasExtra(EXTRA_FOCUS)) putString("focus", intent.getStringExtra(EXTRA_FOCUS))
      if (intent.hasExtra(EXTRA_TITLE)) putString("title", intent.getStringExtra(EXTRA_TITLE))
      if (intent.hasExtra(EXTRA_ARTIST)) putString("artist", intent.getStringExtra(EXTRA_ARTIST))
      if (intent.hasExtra(EXTRA_ALBUM)) putString("album", intent.getStringExtra(EXTRA_ALBUM))
      if (intent.hasExtra(EXTRA_PLAYLIST)) putString("playlist", intent.getStringExtra(EXTRA_PLAYLIST))
      if (intent.hasExtra(EXTRA_POSITION)) putDouble("position", intent.getDoubleExtra(EXTRA_POSITION, 0.0))
    }
    return HeadlessJsTaskConfig("AstraCarCommand", data, 30_000, true)
  }

  override fun onHeadlessJsTaskFinish(taskId: Int) {
    super.onHeadlessJsTaskFinish(taskId)
    // The base impl stops the service when the last task finishes; drop the FGS notification.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
  }

  private fun promoteToForeground() {
    val promoted = runCatching {
      val notification = buildNotification()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    }.isSuccess
    // If we couldn't promote (e.g. FGS-start not allowed), stop now rather than let the
    // system kill the whole process with "did not call startForeground in time".
    if (!promoted) stopSelf()
  }

  private fun buildNotification(): Notification {
    ensureChannel()
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("Astra")
      .setContentText("Handling car controls")
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOngoing(true)
      .build()
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Car controls", NotificationManager.IMPORTANCE_LOW).apply {
        setShowBadge(false)
      },
    )
  }

  companion object {
    private const val EXTRA_COMMAND = "command"
    private const val EXTRA_MEDIA = "media"
    private const val EXTRA_QUERY = "query"
    private const val EXTRA_FOCUS = "focus"
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_ARTIST = "artist"
    private const val EXTRA_ALBUM = "album"
    private const val EXTRA_PLAYLIST = "playlist"
    private const val EXTRA_POSITION = "position"

    private const val CHANNEL_ID = "astra_car_commands"
    private const val NOTIFICATION_ID = 0xACAB

    fun startTransport(context: Context, command: String) {
      start(context, Intent(context, AstraCarCommandService::class.java).putExtra(EXTRA_COMMAND, command))
    }

    fun startSeek(context: Context, positionMs: Long) {
      start(
        context,
        Intent(context, AstraCarCommandService::class.java)
          .putExtra(EXTRA_COMMAND, "seek")
          .putExtra(EXTRA_POSITION, positionMs / 1000.0),
      )
    }

    fun startFavoriteAction(context: Context) {
      start(context, Intent(context, AstraCarCommandService::class.java).putExtra(EXTRA_COMMAND, AstraCarFavoriteAction.COMMAND))
    }

    fun startPlayFromMediaId(context: Context, mediaId: String?) {
      val media = AstraCarMediaIds.decode(mediaId) ?: return
      start(
        context,
        Intent(context, AstraCarCommandService::class.java)
          .putExtra(EXTRA_COMMAND, "playMediaId")
          .putExtra(EXTRA_MEDIA, AstraCarMediaIds.toBundle(media)),
      )
    }

    fun startPlayFromSearch(context: Context, query: String?, extras: Bundle?) {
      val focus = extras?.getString(MediaStore.EXTRA_MEDIA_FOCUS)?.let(::normalizeFocus)
      start(
        context,
        Intent(context, AstraCarCommandService::class.java)
          .putExtra(EXTRA_COMMAND, "playSearch")
          .putExtra(EXTRA_QUERY, query)
          .putExtra(EXTRA_FOCUS, focus)
          .putExtra(EXTRA_TITLE, extras?.getString(MediaStore.EXTRA_MEDIA_TITLE))
          .putExtra(EXTRA_ARTIST, extras?.getString(MediaStore.EXTRA_MEDIA_ARTIST))
          .putExtra(EXTRA_ALBUM, extras?.getString(MediaStore.EXTRA_MEDIA_ALBUM))
          .putExtra(EXTRA_PLAYLIST, extras?.getString(MediaStore.EXTRA_MEDIA_PLAYLIST)),
      )
    }

    private fun start(context: Context, intent: Intent) {
      HeadlessJsTaskService.acquireWakeLockNow(context)
      runCatching { ContextCompat.startForegroundService(context.applicationContext, intent) }
    }

    private fun normalizeFocus(value: String): String =
      when {
        value.contains("artist", ignoreCase = true) -> "artist"
        value.contains("album", ignoreCase = true) -> "album"
        value.contains("playlist", ignoreCase = true) -> "playlist"
        value.contains("genre", ignoreCase = true) -> "genre"
        else -> value
      }
  }
}
