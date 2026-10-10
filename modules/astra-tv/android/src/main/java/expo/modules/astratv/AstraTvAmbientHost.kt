package expo.modules.astratv

import android.content.Context
import android.view.KeyEvent
import android.view.MotionEvent
import android.widget.EditText
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/** Observe input before focused descendants. Waking consumes a complete key
 * gesture, including repeats and key-up, without moving the page's focus. */
class AstraTvAmbientHost(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  val onIdle by EventDispatcher()
  val onActivity by EventDispatcher()
  val onDismiss by EventDispatcher()
  private var requested = false
  private var waking = false
  private var consumedTouch = false
  private val consumedKeys = mutableSetOf<Int>()
  var idleEnabled = false
    set(value) { if (field != value) { field = value; resetIdle(); updateWakeFlag() } }
  var timeoutMs = 120_000L
    set(value) { if (field != value) { field = value.coerceAtLeast(1000); resetIdle() } }
  var resetToken = 0
    set(value) { if (field != value) { field = value; resetIdle() } }
  var ambientVisible = false
    set(value) {
      if (field == value) return
      field = value
      if (!value) { waking = false; resetIdle() } else removeCallbacks(idleTask)
      updateWakeFlag()
    }
  private val idleTask = Runnable {
    if (idleEnabled && !ambientVisible && isAttachedToWindow && hasWindowFocus()) {
      if (findFocus() is EditText) resetIdle() else {
        requested = true
        onIdle(emptyMap<String, Any>())
      }
    }
  }

  init { clipChildren = false; isFocusable = false }

  private fun updateWakeFlag() {
    keepScreenOn = idleEnabled && ambientVisible && !waking && hasWindowFocus()
  }

  private fun resetIdle() {
    removeCallbacks(idleTask)
    requested = false
    if (idleEnabled && !ambientVisible && isAttachedToWindow && hasWindowFocus()) postDelayed(idleTask, timeoutMs)
  }

  private fun activity() {
    if (requested) onActivity(emptyMap<String, Any>())
    resetIdle()
  }

  private fun dismiss() {
    if (!waking) {
      waking = true
      keepScreenOn = false
      onDismiss(emptyMap<String, Any>())
    }
  }

  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    val key = event.keyCode
    if (key in consumedKeys) {
      if (event.action == KeyEvent.ACTION_UP) consumedKeys.remove(key)
      return true
    }
    val navigation = key in intArrayOf(KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN,
      KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT, KeyEvent.KEYCODE_DPAD_CENTER,
      KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER, KeyEvent.KEYCODE_BACK,
      KeyEvent.KEYCODE_ESCAPE, KeyEvent.KEYCODE_BUTTON_A, KeyEvent.KEYCODE_BUTTON_B)
    if (ambientVisible && navigation) {
      if (event.action == KeyEvent.ACTION_DOWN) { consumedKeys.add(key); dismiss() }
      return true
    }
    if (event.action == KeyEvent.ACTION_DOWN) activity()
    // Dedicated media keys retain the session's normal actions.
    return super.dispatchKeyEvent(event)
  }

  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    if (ambientVisible && event.action == MotionEvent.ACTION_DOWN) { consumedTouch = true; dismiss() }
    if (consumedTouch) {
      if (event.action == MotionEvent.ACTION_UP || event.action == MotionEvent.ACTION_CANCEL) consumedTouch = false
      return true
    }
    if (event.action == MotionEvent.ACTION_DOWN) activity()
    return super.dispatchTouchEvent(event)
  }

  override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
    super.onWindowFocusChanged(hasWindowFocus)
    if (!hasWindowFocus) {
      if (ambientVisible) dismiss()
      consumedKeys.clear()
      consumedTouch = false
      if (requested) onActivity(emptyMap<String, Any>())
    }
    resetIdle()
    updateWakeFlag()
  }

  override fun onAttachedToWindow() { super.onAttachedToWindow(); resetIdle() }
  override fun onDetachedFromWindow() {
    removeCallbacks(idleTask); keepScreenOn = false; consumedKeys.clear()
    super.onDetachedFromWindow()
  }
  // Fabric/Yoga lays out React children.
  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) = Unit
}
