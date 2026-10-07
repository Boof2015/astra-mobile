package expo.modules.astratv

import android.app.UiModeManager
import android.content.Context
import android.content.res.Configuration
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
    Events("onVerticalHold", "onVerticalCapture")
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
