package expo.modules.astracar

import android.app.Service
import android.os.PowerManager
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.ComponentName
import android.content.ServiceConnection
import android.os.IBinder
import android.content.pm.ServiceInfo
import android.os.Binder
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import java.lang.ref.WeakReference
import java.util.UUID

/** A bound coordinator can initialize credentials without starting playback or a foreground service. */
class AstraCarCommandService : Service(), HeadlessJsTaskEventListener {
  private val activeTasks = mutableSetOf<Int>()
  private val waitingTasks = mutableListOf<Bundle>()
  private var taskContext: HeadlessJsTaskContext? = null
  private var reactListener: ReactInstanceEventListener? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private val host get() = (application as ReactApplication).reactHost

  private var foreground = false
  private var taskBinding = false
  private val taskConnection = object : ServiceConnection {
    override fun onServiceConnected(name: ComponentName, service: IBinder) = Unit
    override fun onServiceDisconnected(name: ComponentName) = Unit
  }
  inner class LocalBinder : Binder() { val service get() = this@AstraCarCommandService }
  override fun onCreate() { super.onCreate(); instance = WeakReference(this) }
  override fun onBind(intent: Intent) = LocalBinder()

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val data = intent?.getBundleExtra("data") ?: return START_NOT_STICKY
    if (!promote()) {
      complete(data.getString("requestId"), "Unable to start playback. Open Astra on your phone and try again.")
      stopSelf(startId)
      return START_NOT_STICKY
    }
    submit(data)
    finishIfIdle()
    // Enqueue commands must never be replayed after process death.
    return START_NOT_STICKY
  }

  fun initialize() { dispatch(this, Bundle().apply { putString("command", "initialize") }) }

  private fun submit(data: Bundle) {
    if (!isActive(data.getString("requestId"))) return
    // Keep accepted commands alive even if the car unbinds during initialization.
    if (!taskBinding) taskBinding = applicationContext.bindService(
      Intent(this, AstraCarCommandService::class.java), taskConnection, Context.BIND_AUTO_CREATE)
    if (wakeLock == null) wakeLock = getSystemService(PowerManager::class.java)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "$packageName:car-commands").apply { setReferenceCounted(false) }
    wakeLock?.acquire(TIMEOUT_MS + 5_000)
    val reactHost = host ?: run { complete(data.getString("requestId"), "Unable to initialize car controls."); return }
    val context = reactHost.currentReactContext
    if (context != null) launchTask(context, data)
    else {
      waitingTasks.add(data)
      if (reactListener == null) {
        reactListener = object : ReactInstanceEventListener {
          override fun onReactContextInitialized(context: ReactContext) {
            main.post {
              reactListener?.let { reactHost.removeReactInstanceEventListener(it) }
              reactListener = null
              val waiting = waitingTasks.toList()
              waitingTasks.clear()
              waiting.filter { isActive(it.getString("requestId")) }.forEach { launchTask(context, it) }
              finishIfIdle()
            }
          }
        }.also { reactHost.addReactInstanceEventListener(it) }
        reactHost.start()
      }
    }
  }

  private fun launchTask(context: ReactContext, data: Bundle) {
    val tasks = HeadlessJsTaskContext.getInstance(context)
    taskContext = tasks
    tasks.addTaskEventListener(this)
    activeTasks.add(tasks.startTask(HeadlessJsTaskConfig("AstraCarCommand", Arguments.fromBundle(data), TIMEOUT_MS, true)))
  }

  override fun onHeadlessJsTaskStart(taskId: Int) = Unit
  override fun onHeadlessJsTaskFinish(taskId: Int) {
    if (activeTasks.remove(taskId)) finishIfIdle()
  }

  private fun finishIfIdle() {
    waitingTasks.removeAll { !isActive(it.getString("requestId")) }
    if (pending.isNotEmpty() || activeTasks.isNotEmpty() || waitingTasks.isNotEmpty()) return
    if (wakeLock?.isHeld == true) wakeLock?.release()
    removeForeground()
    if (taskBinding) { taskBinding = false; applicationContext.unbindService(taskConnection) }
    stopSelf() // An attached browser keeps the bound coordinator available.
  }

  override fun onDestroy() {
    if (instance?.get() === this) {
      instance = null
      pending.keys.toList().forEach { complete(it, "Car controls disconnected. Please try again.") }
    }
    if (taskBinding) { taskBinding = false; applicationContext.unbindService(taskConnection) }
    reactListener?.let { host?.removeReactInstanceEventListener(it) }
    reactListener = null
    waitingTasks.clear()
    taskContext?.removeTaskEventListener(this)
    activeTasks.toList().forEach { taskContext?.finishTask(it) }
    activeTasks.clear()
    if (wakeLock?.isHeld == true) wakeLock?.release()
    removeForeground()
    super.onDestroy()
  }

  private fun removeForeground() {
    if (!foreground) return
    stopForeground(STOP_FOREGROUND_REMOVE)
    foreground = false
  }

  private fun promote(): Boolean = runCatching {
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(NotificationChannel(CHANNEL, "Car controls", NotificationManager.IMPORTANCE_LOW))
    val icon = resources.getIdentifier("astra_notification_icon", "drawable", packageName).takeIf { it != 0 }
      ?: android.R.drawable.ic_media_play
    val notification = NotificationCompat.Builder(this, CHANNEL).setContentTitle("Astra")
      .setContentText("Starting playback").setSmallIcon(icon).setOngoing(true).build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    else startForeground(NOTIFICATION_ID, notification)
    foreground = true
  }.isSuccess

  companion object {
    private const val CHANNEL = "astra_car_commands"
    private const val NOTIFICATION_ID = 0xACAB
    private const val TIMEOUT_MS = 120_000L
    private val main = Handler(Looper.getMainLooper())
    private var instance: WeakReference<AstraCarCommandService>? = null
    private data class Pending(val timeout: Runnable, val callback: ((String?) -> Unit)?)
    private val pending = LinkedHashMap<String, Pending>()

    fun isActive(id: String?): Boolean = id != null && pending.containsKey(id)

    fun complete(id: String?, error: String?) {
      if (Looper.myLooper() != Looper.getMainLooper()) { main.post { complete(id, error) }; return }
      val request = pending.remove(id) ?: return
      main.removeCallbacks(request.timeout)
      AstraCarPlaybackBridge.reportError(error)
      request.callback?.invoke(error)
      instance?.get()?.finishIfIdle()
    }

    fun dispatch(context: Context, data: Bundle, callback: ((String?) -> Unit)? = null) {
      check(Looper.myLooper() == Looper.getMainLooper())
      val id = UUID.randomUUID().toString()
      data.putString("requestId", id)
      val timeout = Runnable { complete(id, "Car command timed out. Please try again.") }
      pending[id] = Pending(timeout, callback)
      main.postDelayed(timeout, TIMEOUT_MS)
      val service = instance?.get()
      if (service != null) runCatching { service.submit(data) }.onFailure { complete(id, "Unable to initialize car controls.") }
      else runCatching {
        ContextCompat.startForegroundService(context.applicationContext,
          Intent(context, AstraCarCommandService::class.java).putExtra("data", data))
      }.onFailure { complete(id, "Unable to start car controls. Open Astra on your phone and try again.") }
    }

    fun startTransport(context: Context, command: String) = dispatch(context, Bundle().apply { putString("command", command) })
    fun startSeek(context: Context, positionMs: Long) = dispatch(context, Bundle().apply {
      putString("command", "seek"); putDouble("position", positionMs.coerceAtLeast(0) / 1000.0)
    })
    fun startFavoriteAction(context: Context) = startTransport(context, "toggleFavorite")
    fun startPlayFromMediaId(context: Context, mediaId: String?) {
      val media = AstraCarMediaIds.decode(mediaId)
      if (media == null) { AstraCarPlaybackBridge.reportError("This item is no longer available."); return }
      dispatch(context, Bundle().apply { putString("command", "playMediaId"); putBundle("media", AstraCarMediaIds.toBundle(media)) })
    }
    fun startPlayFromSearch(context: Context, query: String?, extras: Bundle?) = dispatch(context, Bundle().apply {
      putString("command", "playSearch"); putString("query", query)
      putString("focus", extras?.getString(MediaStore.EXTRA_MEDIA_FOCUS)?.let { focus ->
        listOf("artist", "album", "playlist", "genre").firstOrNull { focus.contains(it, true) } ?: "track"
      })
      putString("title", extras?.getString(MediaStore.EXTRA_MEDIA_TITLE))
      putString("artist", extras?.getString(MediaStore.EXTRA_MEDIA_ARTIST))
      putString("album", extras?.getString(MediaStore.EXTRA_MEDIA_ALBUM))
      putString("playlist", extras?.getString(MediaStore.EXTRA_MEDIA_PLAYLIST))
    })
  }
}
