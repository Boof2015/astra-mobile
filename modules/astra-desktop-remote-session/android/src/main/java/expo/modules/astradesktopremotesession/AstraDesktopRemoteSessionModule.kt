package expo.modules.astradesktopremotesession

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.SystemClock
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.util.Base64
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat.MediaStyle
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlin.math.max
import kotlin.math.roundToLong

private const val CHANNEL_ID = "astra_desktop_remote"
private const val NOTIFICATION_ID = 384021
private const val ACTION_PREFIX = "expo.modules.astradesktopremotesession.action."
private const val ACTION_PLAY = ACTION_PREFIX + "PLAY"
private const val ACTION_PAUSE = ACTION_PREFIX + "PAUSE"
private const val ACTION_TOGGLE_PLAY = ACTION_PREFIX + "TOGGLE_PLAY"
private const val ACTION_PREVIOUS = ACTION_PREFIX + "PREVIOUS"
private const val ACTION_NEXT = ACTION_PREFIX + "NEXT"
private const val ACTION_TOGGLE_FAVORITE = ACTION_PREFIX + "TOGGLE_FAVORITE"
private const val ACTION_STOP = ACTION_PREFIX + "STOP"
private const val MAX_ART_EDGE = 512

class AstraDesktopRemoteSessionState : Record {
  @Field
  val title: String? = null

  @Field
  val artist: String? = null

  @Field
  val album: String? = null

  @Field
  val desktopName: String? = null

  @Field
  val artworkDataUrl: String? = null

  @Field
  val playbackState: String = "stopped"

  @Field
  val hasTrack: Boolean = false

  @Field
  val duration: Double? = null

  @Field
  val position: Double? = null

  @Field
  val updatedAt: Double? = null

  @Field
  val isFavorite: Boolean = false
}

class AstraDesktopRemoteSessionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AstraDesktopRemoteSession")

    Events("onDesktopRemoteCommand")

    OnCreate {
      AstraDesktopRemoteSessionController.bind(this@AstraDesktopRemoteSessionModule)
    }

    OnDestroy {
      AstraDesktopRemoteSessionController.unbind(this@AstraDesktopRemoteSessionModule)
    }

    Function("setNowPlaying") { state: AstraDesktopRemoteSessionState ->
      AstraDesktopRemoteSessionController.setNowPlaying(requireContext(), state)
    }

    Function("clear") {
      AstraDesktopRemoteSessionController.clear(requireContext())
    }
  }

  fun emitCommand(payload: Map<String, Any>) {
    sendEvent("onDesktopRemoteCommand", payload)
  }

  private fun requireContext(): Context =
    appContext.reactContext ?: throw Exceptions.ReactContextLost()
}

class AstraDesktopRemoteSessionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      ACTION_PLAY -> AstraDesktopRemoteSessionController.emitCommand("play")
      ACTION_PAUSE -> AstraDesktopRemoteSessionController.emitCommand("pause")
      ACTION_TOGGLE_PLAY -> AstraDesktopRemoteSessionController.emitCommand("toggle-play")
      ACTION_PREVIOUS -> AstraDesktopRemoteSessionController.emitCommand("previous")
      ACTION_NEXT -> AstraDesktopRemoteSessionController.emitCommand("next")
      ACTION_TOGGLE_FAVORITE -> AstraDesktopRemoteSessionController.emitCommand("toggle-favorite")
      ACTION_STOP -> {
        AstraDesktopRemoteSessionController.emitCommand("pause")
        AstraDesktopRemoteSessionController.clear(context)
      }
    }
  }
}

object AstraDesktopRemoteSessionController {
  private var module: AstraDesktopRemoteSessionModule? = null
  private var mediaSession: MediaSessionCompat? = null
  private var lastState: AstraDesktopRemoteSessionState? = null

  fun bind(module: AstraDesktopRemoteSessionModule) {
    this.module = module
  }

  fun unbind(module: AstraDesktopRemoteSessionModule) {
    if (this.module === module) this.module = null
  }

  fun setNowPlaying(context: Context, state: AstraDesktopRemoteSessionState) {
    if (!state.hasTrack) {
      clear(context)
      return
    }
    lastState = state
    val session = ensureSession(context)
    session.setMetadata(buildMetadata(state))
    session.setPlaybackState(buildPlaybackState(state))
    session.isActive = true
    showNotification(context, session, state)
  }

  fun clear(context: Context) {
    lastState = null
    mediaSession?.apply {
      isActive = false
      setPlaybackState(
        PlaybackStateCompat.Builder()
          .setState(PlaybackStateCompat.STATE_STOPPED, 0L, 0f)
          .build()
      )
    }
    notificationManager(context).cancel(NOTIFICATION_ID)
  }

  fun emitCommand(command: String, position: Double? = null) {
    val payload = mutableMapOf<String, Any>("command" to command)
    if (position != null) payload["position"] = position
    module?.emitCommand(payload)
  }

  private fun ensureSession(context: Context): MediaSessionCompat {
    mediaSession?.let { return it }
    val session = MediaSessionCompat(context.applicationContext, "AstraDesktopRemote").apply {
      setCallback(object : MediaSessionCompat.Callback() {
        override fun onPlay() = emitCommand("play")
        override fun onPause() = emitCommand("pause")
        override fun onSkipToNext() = emitCommand("next")
        override fun onSkipToPrevious() = emitCommand("previous")
        override fun onStop() {
          emitCommand("pause")
          clear(context)
        }
        override fun onSeekTo(pos: Long) = emitCommand("seek", pos / 1000.0)
      })
    }
    mediaSession = session
    return session
  }

  private fun buildMetadata(state: AstraDesktopRemoteSessionState): MediaMetadataCompat {
    val builder = MediaMetadataCompat.Builder()
      .putString(MediaMetadataCompat.METADATA_KEY_TITLE, state.title?.ifBlank { "Unknown track" } ?: "Unknown track")
      .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, state.artist?.ifBlank { "" } ?: "")
      .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, state.album?.ifBlank { state.desktopName ?: "Astra Desktop" } ?: state.desktopName ?: "Astra Desktop")
      .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, secondsToMs(state.duration))
    decodeDataUrlBitmap(state.artworkDataUrl)?.let { bitmap ->
      builder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, bitmap)
      builder.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, bitmap)
    }
    return builder.build()
  }

  private fun buildPlaybackState(state: AstraDesktopRemoteSessionState): PlaybackStateCompat {
    val playbackState = when (state.playbackState) {
      "playing" -> PlaybackStateCompat.STATE_PLAYING
      "paused" -> PlaybackStateCompat.STATE_PAUSED
      "loading" -> PlaybackStateCompat.STATE_BUFFERING
      else -> PlaybackStateCompat.STATE_STOPPED
    }
    val speed = if (state.playbackState == "playing") 1f else 0f
    return PlaybackStateCompat.Builder()
      .setActions(
        PlaybackStateCompat.ACTION_PLAY or
          PlaybackStateCompat.ACTION_PAUSE or
          PlaybackStateCompat.ACTION_PLAY_PAUSE or
          PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
          PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
          PlaybackStateCompat.ACTION_SEEK_TO or
          PlaybackStateCompat.ACTION_STOP
      )
      .setState(playbackState, currentPositionMs(state), speed, SystemClock.elapsedRealtime())
      .build()
  }

  private fun showNotification(
    context: Context,
    session: MediaSessionCompat,
    state: AstraDesktopRemoteSessionState
  ) {
    createChannel(context)
    val isPlaying = state.playbackState == "playing"
    val playPauseAction = if (isPlaying) {
      NotificationCompat.Action(
        android.R.drawable.ic_media_pause,
        "Pause",
        actionIntent(context, ACTION_PAUSE, 2)
      )
    } else {
      NotificationCompat.Action(
        android.R.drawable.ic_media_play,
        "Play",
        actionIntent(context, ACTION_PLAY, 2)
      )
    }
    val largeIcon = decodeDataUrlBitmap(state.artworkDataUrl)
    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setContentTitle(state.title?.ifBlank { "Unknown track" } ?: "Unknown track")
      .setContentText(state.artist?.ifBlank { state.desktopName } ?: state.desktopName ?: "Astra Desktop")
      .setSubText(state.desktopName ?: "Desktop Remote")
      .setLargeIcon(largeIcon)
      .setContentIntent(launchIntent(context))
      .setDeleteIntent(actionIntent(context, ACTION_STOP, 6))
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(isPlaying)
      .setOnlyAlertOnce(true)
      .addAction(android.R.drawable.ic_media_previous, "Previous", actionIntent(context, ACTION_PREVIOUS, 1))
      .addAction(playPauseAction)
      .addAction(android.R.drawable.ic_media_next, "Next", actionIntent(context, ACTION_NEXT, 3))
      .addAction(
        if (state.isFavorite) android.R.drawable.btn_star_big_on else android.R.drawable.btn_star_big_off,
        "Favorite",
        actionIntent(context, ACTION_TOGGLE_FAVORITE, 4)
      )
      .setStyle(
        MediaStyle()
          .setMediaSession(session.sessionToken)
          .setShowActionsInCompactView(0, 1, 2)
      )
      .build()
    notificationManager(context).notify(NOTIFICATION_ID, notification)
  }

  private fun createChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = notificationManager(context)
    val existing = manager.getNotificationChannel(CHANNEL_ID)
    if (existing != null) return
    manager.createNotificationChannel(
      NotificationChannel(
        CHANNEL_ID,
        "Desktop Remote",
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "Playback controls for a paired Astra Desktop"
      }
    )
  }

  private fun actionIntent(context: Context, action: String, requestCode: Int): PendingIntent {
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    val intent = Intent(context, AstraDesktopRemoteSessionReceiver::class.java).setAction(action)
    return PendingIntent.getBroadcast(context, requestCode, intent, flags)
  }

  private fun launchIntent(context: Context): PendingIntent? {
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    return PendingIntent.getActivity(context, 0, intent, flags)
  }

  private fun notificationManager(context: Context): NotificationManager =
    context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  private fun secondsToMs(seconds: Double?): Long =
    max(0.0, seconds ?: 0.0).times(1000.0).roundToLong()

  private fun currentPositionMs(state: AstraDesktopRemoteSessionState): Long {
    val baseMs = secondsToMs(state.position)
    if (state.playbackState != "playing") return baseMs
    val updatedAt = state.updatedAt ?: return baseMs
    val elapsedMs = max(0.0, System.currentTimeMillis().toDouble() - updatedAt).roundToLong()
    return baseMs + elapsedMs
  }

  private fun decodeDataUrlBitmap(value: String?): Bitmap? {
    val raw = value?.trim().orEmpty()
    if (!raw.startsWith("data:image/")) return null
    val comma = raw.indexOf(',')
    if (comma < 0 || comma >= raw.lastIndex) return null
    return try {
      val bytes = Base64.decode(raw.substring(comma + 1), Base64.DEFAULT)
      val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
      resizeBitmap(decoded)
    } catch (_: Throwable) {
      null
    }
  }

  private fun resizeBitmap(bitmap: Bitmap): Bitmap {
    val edge = max(bitmap.width, bitmap.height)
    if (edge <= MAX_ART_EDGE) return bitmap
    val scale = MAX_ART_EDGE.toFloat() / edge.toFloat()
    val width = max(1, (bitmap.width * scale).roundToLong().toInt())
    val height = max(1, (bitmap.height * scale).roundToLong().toInt())
    return Bitmap.createScaledBitmap(bitmap, width, height, true)
  }
}
