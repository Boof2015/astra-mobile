package expo.modules.astratv

import android.app.UiModeManager
import android.content.Context
import android.content.Intent
import android.content.ContentUris
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Build
import android.provider.MediaStore
import android.view.inputmethod.InputMethodManager
import android.view.KeyEvent
import android.view.View
import android.widget.EditText
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** ReactEditText.focus() only shows the IME in touch mode. TV entry flows
 * explicitly ask for it while retaining native D-pad / IME ownership. */
class AstraTvModule : Module() {
  private var holdStart = -1L
  private var lastJump = -1L
  private var lastCapturedMove = -1L

  override fun definition() = ModuleDefinition {
    Name("AstraTv")
    Events("onVerticalHold", "onVerticalCapture", "onDirectionCapture")
    // Bounded developer probe, not the production library discovery adapter.
    // MediaStore supplies locations only: Astra's scanner reads the actual tags.
    AsyncFunction("probeLocalAudio") {
      val context = requireNotNull(appContext.reactContext)
      val mode = context.getSystemService(Context.UI_MODE_SERVICE) as UiModeManager
      check(mode.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION) { "TV only" }
      check(context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) { "Debug builds only" }
      if (Build.VERSION.SDK_INT < 33) return@AsyncFunction mapOf("status" to "unsupported", "files" to emptyList<Any>(), "total" to 0, "volumes" to emptyList<String>())
      if (context.checkSelfPermission(android.Manifest.permission.READ_MEDIA_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        return@AsyncFunction mapOf("status" to "denied", "files" to emptyList<Any>(), "total" to 0, "volumes" to emptyList<String>())
      }
      val volumes = MediaStore.getExternalVolumeNames(context).sorted()
      val collection = MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
      val columns = arrayOf(MediaStore.Audio.Media._ID, MediaStore.Audio.Media.DISPLAY_NAME,
        MediaStore.Audio.Media.RELATIVE_PATH, MediaStore.Audio.Media.VOLUME_NAME,
        MediaStore.Audio.Media.SIZE, MediaStore.Audio.Media.DATE_MODIFIED, MediaStore.Audio.Media.MIME_TYPE)
      val files = mutableListOf<Map<String, Any?>>()
      var total = 0
      context.contentResolver.query(collection, columns, null, null,
        "${MediaStore.Audio.Media.RELATIVE_PATH} ASC, ${MediaStore.Audio.Media.DISPLAY_NAME} ASC")?.use { cursor ->
        total = cursor.count
        while (files.size < 200 && cursor.moveToNext()) {
          val volume = cursor.getString(3) ?: continue
          files.add(mapOf(
            "uri" to ContentUris.withAppendedId(MediaStore.Audio.Media.getContentUri(volume), cursor.getLong(0)).toString(),
            "name" to cursor.getString(1), "relativePath" to cursor.getString(2), "volume" to volume,
            "size" to cursor.getLong(4), "lastModified" to cursor.getLong(5) * 1000, "mimeType" to cursor.getString(6)))
        }
      }
      mapOf("status" to "granted", "files" to files, "total" to total, "volumes" to volumes)
    }
    // Some TV images omit DocumentsUI or resolve to a stub that just cancels.
    // Check before invoking Expo's picker; ActivityNotFound can also leave its
    // request pending, preventing subsequent attempts.
    AsyncFunction("canPickDocuments") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      val mode = context.getSystemService(Context.UI_MODE_SERVICE) as UiModeManager
      if (mode.currentModeType != Configuration.UI_MODE_TYPE_TELEVISION) return@AsyncFunction false
      val picker = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "*/*"
      }.resolveActivity(context.packageManager)
      picker != null && picker.packageName != "com.android.tv.frameworkpackagestubs"
    }
    // Grabbed EQ controls own arrows. OK/Back retain their native dispatch.
    AsyncFunction("setDirectionCapture") { viewTag: Int, enabled: Boolean ->
      val context = appContext.reactContext ?: return@AsyncFunction
      val mode = context.getSystemService(Context.UI_MODE_SERVICE) as UiModeManager
      if (mode.currentModeType != Configuration.UI_MODE_TYPE_TELEVISION) return@AsyncFunction
      val view = appContext.findView<View>(viewTag) ?: return@AsyncFunction
      var lastMove = -1L
      view.setOnKeyListener(if (!enabled) null else View.OnKeyListener { _, key, event ->
        val direction = when (key) {
          KeyEvent.KEYCODE_DPAD_UP -> "up"
          KeyEvent.KEYCODE_DPAD_DOWN -> "down"
          KeyEvent.KEYCODE_DPAD_LEFT -> "left"
          KeyEvent.KEYCODE_DPAD_RIGHT -> "right"
          else -> null
        }
        if (direction == null) false else {
          if (event.action == KeyEvent.ACTION_DOWN && (event.repeatCount == 0 || event.eventTime - lastMove >= 100)) {
            lastMove = event.eventTime
            sendEvent("onDirectionCapture", mapOf("viewTag" to viewTag, "direction" to direction))
          }
          true
        }
      })
    }.runOnQueue(Queues.MAIN)
    // Editing owns Up/Down navigation and keeps focus on a picked-up row while
    // its position changes. Left/Right stay inside the editing mode.
    // OK and Back retain their normal React Native dispatch paths.
    AsyncFunction("setVerticalCapture") { viewTag: Int, enabled: Boolean ->
      val context = appContext.reactContext ?: return@AsyncFunction
      val mode = context.getSystemService(Context.UI_MODE_SERVICE) as UiModeManager
      if (mode.currentModeType != Configuration.UI_MODE_TYPE_TELEVISION) return@AsyncFunction
      val view = appContext.findView<View>(viewTag) ?: return@AsyncFunction
      view.setOnKeyListener(if (!enabled) null else View.OnKeyListener { _, key, event ->
        when (key) {
          KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN -> {
            if (event.action == KeyEvent.ACTION_DOWN && (event.repeatCount == 0 || event.eventTime - lastCapturedMove >= 100)) {
              lastCapturedMove = event.eventTime
              sendEvent("onVerticalCapture", mapOf("viewTag" to viewTag, "direction" to if (key == KeyEvent.KEYCODE_DPAD_UP) "up" else "down"))
            }
            true
          }
          KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT -> true
          else -> false
        }
      })
    }.runOnQueue(Queues.MAIN)
    // Installed only on controls inside an active TV collection. Returning false
    // before the threshold retains Android's ordinary D-pad focus movement.
    AsyncFunction("setVerticalHold") { viewTag: Int, enabled: Boolean ->
      val context = appContext.reactContext ?: return@AsyncFunction
      val mode = context.getSystemService(Context.UI_MODE_SERVICE) as UiModeManager
      if (mode.currentModeType != Configuration.UI_MODE_TYPE_TELEVISION) return@AsyncFunction
      val view = appContext.findView<View>(viewTag) ?: return@AsyncFunction
      view.setOnKeyListener(if (!enabled) null else View.OnKeyListener { _, key, event ->
        if (key != KeyEvent.KEYCODE_DPAD_UP && key != KeyEvent.KEYCODE_DPAD_DOWN) {
          holdStart = -1L
          lastJump = -1L
          sendEvent("onVerticalHold", mapOf("phase" to "cancel", "direction" to "down"))
          false
        } else {
          val direction = if (key == KeyEvent.KEYCODE_DPAD_UP) "up" else "down"
          if (event.action == KeyEvent.ACTION_UP) {
            val consumed = lastJump >= 0
            holdStart = -1L
            lastJump = -1L
            sendEvent("onVerticalHold", mapOf("phase" to "release", "direction" to direction))
            consumed
          } else if (event.action == KeyEvent.ACTION_DOWN) {
            if (holdStart != event.downTime) {
              holdStart = event.downTime
              lastJump = -1L
            }
            if (event.eventTime - holdStart >= 900 && event.repeatCount > 0) {
              if (lastJump < 0 || event.eventTime - lastJump >= 260) {
                lastJump = event.eventTime
                sendEvent("onVerticalHold", mapOf("phase" to "jump", "direction" to direction))
              }
              true
            } else {
              sendEvent("onVerticalHold", mapOf("phase" to if (event.repeatCount > 0) "repeat" else "start", "direction" to direction))
              false
            }
          } else false
        }
      })
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("showKeyboard") { viewTag: Int ->
      val context = appContext.reactContext ?: return@AsyncFunction
      val mode = context.getSystemService(Context.UI_MODE_SERVICE) as UiModeManager
      if (mode.currentModeType != Configuration.UI_MODE_TYPE_TELEVISION) return@AsyncFunction
      val view = appContext.findView<EditText>(viewTag) ?: return@AsyncFunction
      view.post {
        if (view.isAttachedToWindow && view.hasFocus()) {
          val ime = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
          ime.showSoftInput(view, InputMethodManager.SHOW_IMPLICIT)
        }
      }
    }.runOnQueue(Queues.MAIN)
  }
}
