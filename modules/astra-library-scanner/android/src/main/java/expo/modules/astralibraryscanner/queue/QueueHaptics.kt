package expo.modules.astralibraryscanner.queue

import android.content.Context
import android.media.AudioAttributes
import android.os.Build
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.view.HapticFeedbackConstants
import android.view.View

/**
 * Native equivalents of Astra's selected queue recipes. Keeping these in the
 * queue renderer avoids a JS round-trip at the exact moment a gesture arms,
 * crosses a row boundary, or lands.
 */
class QueueHaptics(context: Context) {
  private val applicationContext = context.applicationContext
  private val vibrator: Vibrator =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      (
        applicationContext.getSystemService(Context.VIBRATOR_MANAGER_SERVICE)
          as VibratorManager
      ).defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      applicationContext.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
    }

  fun lift(view: View) {
    if (!compose(
        Primitive(VibrationEffect.Composition.PRIMITIVE_QUICK_RISE, 0.7f),
        Primitive(VibrationEffect.Composition.PRIMITIVE_CLICK, 0.5f, 45),
      )
    ) {
      view.performHapticFeedback(HapticFeedbackConstants.DRAG_START)
    }
  }

  fun drop(view: View) {
    if (!compose(
        Primitive(VibrationEffect.Composition.PRIMITIVE_CLICK, 0.7f),
        Primitive(VibrationEffect.Composition.PRIMITIVE_THUD, 0.5f, 30),
      )
    ) {
      view.performHapticFeedback(HapticFeedbackConstants.GESTURE_END)
    }
  }

  fun step(view: View) {
    if (!compose(Primitive(VibrationEffect.Composition.PRIMITIVE_TICK, 0.35f))) {
      view.performHapticFeedback(HapticFeedbackConstants.SEGMENT_FREQUENT_TICK)
    }
  }

  fun threshold(view: View, armed: Boolean) {
    view.performHapticFeedback(
      if (armed) {
        HapticFeedbackConstants.GESTURE_START
      } else {
        HapticFeedbackConstants.GESTURE_END
      },
    )
  }

  fun selection(view: View) {
    if (!compose(Primitive(VibrationEffect.Composition.PRIMITIVE_TICK, 0.55f))) {
      view.performHapticFeedback(HapticFeedbackConstants.SEGMENT_TICK)
    }
  }

  fun confirm(view: View) {
    if (!compose(
        Primitive(VibrationEffect.Composition.PRIMITIVE_QUICK_RISE, 0.45f),
        Primitive(VibrationEffect.Composition.PRIMITIVE_CLICK, 0.75f, 45),
      )
    ) {
      view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
    }
  }

  fun reject(view: View) {
    if (!compose(
        Primitive(VibrationEffect.Composition.PRIMITIVE_CLICK, 0.75f),
        Primitive(VibrationEffect.Composition.PRIMITIVE_LOW_TICK, 0.7f, 45),
      )
    ) {
      view.performHapticFeedback(HapticFeedbackConstants.REJECT)
    }
  }

  private fun compose(vararg primitives: Primitive): Boolean {
    if (
      Build.VERSION.SDK_INT < Build.VERSION_CODES.R ||
      primitives.isEmpty() ||
      !vibrator.hasVibrator() ||
      !touchFeedbackEnabled()
    ) {
      return false
    }
    val ids = primitives.map(Primitive::id).toIntArray()
    if (!vibrator.areAllPrimitivesSupported(*ids)) return false
    return runCatching {
      val composition = VibrationEffect.startComposition()
      primitives.forEach { primitive ->
        composition.addPrimitive(primitive.id, primitive.scale, primitive.delayMs)
      }
      vibrate(composition.compose())
      true
    }.getOrDefault(false)
  }

  private fun vibrate(effect: VibrationEffect) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      vibrator.vibrate(
        effect,
        VibrationAttributes.createForUsage(VibrationAttributes.USAGE_TOUCH),
      )
    } else {
      vibrator.vibrate(
        effect,
        AudioAttributes.Builder()
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
          .build(),
      )
    }
  }

  private fun touchFeedbackEnabled(): Boolean =
    Settings.System.getInt(
      applicationContext.contentResolver,
      Settings.System.HAPTIC_FEEDBACK_ENABLED,
      1,
    ) != 0

  private data class Primitive(
    val id: Int,
    val scale: Float,
    val delayMs: Int = 0,
  )
}
