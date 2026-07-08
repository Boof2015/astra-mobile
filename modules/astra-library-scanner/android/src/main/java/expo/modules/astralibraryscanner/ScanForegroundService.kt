package expo.modules.astralibraryscanner

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/**
 * Keeps the process alive + the CPU awake while a (JS-orchestrated) library scan
 * runs, so a big scan finishes even when the user backgrounds Astra or the screen
 * sleeps — and shows a progress notification. Started from JS while the app is
 * foregrounded, then survives backgrounding as a `dataSync` foreground service.
 *
 * The scan loop itself lives on the app's JS thread (see src/library/scanner.ts);
 * this service just provides the wakelock + FGS keepalive + the visible progress.
 */
class ScanForegroundService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        // A start may still be racing us; the OS requires startForeground() to have
        // been called before we can tear down, so promote-then-stop if needed.
        if (instance == null) promote(DEFAULT_TITLE, DEFAULT_TEXT, null, 0, 0, true)
        stopSelfSafely()
      }
      else -> {
        val title = intent?.getStringExtra(EXTRA_TITLE) ?: DEFAULT_TITLE
        val text = intent?.getStringExtra(EXTRA_TEXT) ?: DEFAULT_TEXT
        promote(title, text, null, 0, 0, true)
        acquireWakeLock()
      }
    }
    // Never auto-restart: the scan lives in JS, so a killed process has no scan to resume.
    return START_NOT_STICKY
  }

  /** Refresh the ongoing notification. NotificationManager.notify is thread-safe. */
  fun update(title: String, text: String, subText: String?, current: Int, total: Int, indeterminate: Boolean) {
    notificationManager().notify(
      NOTIFICATION_ID,
      buildNotification(title, text, subText, current, total, indeterminate)
    )
  }

  private fun promote(
    title: String,
    text: String,
    subText: String?,
    current: Int,
    total: Int,
    indeterminate: Boolean
  ) {
    val ok = runCatching {
      val notification = buildNotification(title, text, subText, current, total, indeterminate)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
      instance = this
    }.isSuccess
    // If promotion was refused (e.g. FGS-start not allowed), bail rather than let the
    // system kill the whole process with "did not call startForeground in time".
    if (!ok) stopSelfSafely()
  }

  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) return
    val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKELOCK_TAG).apply {
      setReferenceCounted(false)
      runCatching { acquire(MAX_WAKELOCK_MS) }
    }
  }

  private fun releaseWakeLock() {
    runCatching { if (wakeLock?.isHeld == true) wakeLock?.release() }
    wakeLock = null
  }

  private fun stopSelfSafely() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    stopSelf()
  }

  override fun onDestroy() {
    if (instance === this) instance = null
    releaseWakeLock()
    super.onDestroy()
  }

  private fun buildNotification(
    title: String,
    text: String,
    subText: String?,
    current: Int,
    total: Int,
    indeterminate: Boolean
  ): Notification {
    ensureChannel()
    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.stat_notify_sync)
      .setContentTitle(title)
      .setContentText(text)
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(launchIntent())
    if (!subText.isNullOrBlank()) builder.setSubText(subText)
    if (indeterminate || total <= 0) {
      builder.setProgress(0, 0, true)
    } else {
      builder.setProgress(total, current.coerceIn(0, total), false)
    }
    return builder.build()
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = notificationManager()
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    // DEFAULT (not LOW) so the scan announces itself once when it starts; the ongoing
    // progress updates stay quiet via setOnlyAlertOnce.
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Library scan", NotificationManager.IMPORTANCE_DEFAULT).apply {
        description = "Progress while Astra scans your music folders"
        setShowBadge(false)
      }
    )
  }

  private fun launchIntent(): PendingIntent? {
    val intent = packageManager.getLaunchIntentForPackage(packageName) ?: return null
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    return PendingIntent.getActivity(this, 0, intent, flags)
  }

  private fun notificationManager(): NotificationManager =
    getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  companion object {
    @Volatile
    private var instance: ScanForegroundService? = null

    private const val CHANNEL_ID = "astra_library_scan"
    private const val NOTIFICATION_ID = 0x5CA4
    private const val WAKELOCK_TAG = "astra:library-scan"
    private const val MAX_WAKELOCK_MS = 60L * 60L * 1000L // 1h safety cap
    private const val DEFAULT_TITLE = "Scanning your library"
    private const val DEFAULT_TEXT = "Preparing…"
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_TEXT = "text"
    private const val ACTION_STOP = "expo.modules.astralibraryscanner.action.STOP_SCAN"

    fun start(context: Context, title: String, text: String) {
      val intent = Intent(context, ScanForegroundService::class.java)
        .putExtra(EXTRA_TITLE, title)
        .putExtra(EXTRA_TEXT, text)
      runCatching { ContextCompat.startForegroundService(context.applicationContext, intent) }
    }

    fun update(
      title: String,
      text: String,
      subText: String?,
      current: Int,
      total: Int,
      indeterminate: Boolean
    ) {
      instance?.update(title, text, subText, current, total, indeterminate)
    }

    fun stop(context: Context) {
      // Route through onStartCommand (main thread) so teardown never races the promote.
      val intent = Intent(context, ScanForegroundService::class.java).setAction(ACTION_STOP)
      runCatching { ContextCompat.startForegroundService(context.applicationContext, intent) }
    }
  }
}
