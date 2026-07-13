package expo.modules.astrahaptics

import android.content.Context
import android.media.AudioAttributes
import android.os.Build
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class HapticCompositionStepRecord : Record {
  @Field
  val primitive: String = ""

  @Field
  val scale: Float = 1f

  @Field
  val delayMs: Int = 0
}

private data class PrimitiveSpec(
  val id: Int,
  val minApi: Int,
)

class AstraHapticsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val vibrator: Vibrator
    get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
    }

  override fun definition() = ModuleDefinition {
    Name("AstraHaptics")

    Function("getCapabilities") {
      capabilities()
    }

    Function("isTouchFeedbackEnabled") {
      touchFeedbackEnabled()
    }

    Function("playComposition") { steps: List<HapticCompositionStepRecord> ->
      playComposition(steps)
    }
  }

  private fun capabilities(): Map<String, Any> {
    val currentVibrator = vibrator
    val canCompose = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && currentVibrator.hasVibrator()

    val primitiveCapabilities = linkedMapOf<String, Map<String, Any>>()
    PRIMITIVES.entries.forEach { entry ->
      val availableOnApi = Build.VERSION.SDK_INT >= entry.value.minApi
      val supported = canCompose && availableOnApi &&
        currentVibrator.areAllPrimitivesSupported(entry.value.id)
      val duration = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && supported) {
        currentVibrator.getPrimitiveDurations(entry.value.id).firstOrNull() ?: 0
      } else {
        0
      }
      primitiveCapabilities[entry.key] = mapOf(
        "supported" to supported,
        "durationMs" to duration,
      )
    }

    return mapOf(
      "apiLevel" to Build.VERSION.SDK_INT,
      "hasVibrator" to currentVibrator.hasVibrator(),
      "hasAmplitudeControl" to (
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && currentVibrator.hasAmplitudeControl()
      ),
      "touchFeedbackEnabled" to touchFeedbackEnabled(),
      "primitives" to primitiveCapabilities,
    )
  }

  private fun playComposition(steps: List<HapticCompositionStepRecord>): Boolean {
    if (
      Build.VERSION.SDK_INT < Build.VERSION_CODES.R ||
      steps.isEmpty() ||
      steps.size > MAX_STEPS ||
      !vibrator.hasVibrator() ||
      !touchFeedbackEnabled()
    ) {
      return false
    }

    val specs = steps.map { step ->
      if (!step.scale.isFinite() || step.scale <= 0f || step.scale > 1f) return false
      if (step.delayMs < 0 || step.delayMs > MAX_DELAY_MS) return false
      val spec = PRIMITIVES[step.primitive] ?: return false
      if (Build.VERSION.SDK_INT < spec.minApi) return false
      spec
    }

    if (!vibrator.areAllPrimitivesSupported(*specs.map { it.id }.toIntArray())) return false

    return try {
      val composition = VibrationEffect.startComposition()
      steps.forEachIndexed { index, step ->
        composition.addPrimitive(specs[index].id, step.scale, step.delayMs)
      }
      vibrateForTouch(composition.compose())
      true
    } catch (_: Exception) {
      false
    }
  }

  private fun vibrateForTouch(effect: VibrationEffect) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      vibrator.vibrate(
        effect,
        VibrationAttributes.createForUsage(VibrationAttributes.USAGE_TOUCH),
      )
      return
    }

    val attributes = AudioAttributes.Builder()
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
      .build()
    vibrator.vibrate(effect, attributes)
  }

  private fun touchFeedbackEnabled(): Boolean =
    Settings.System.getInt(
      context.contentResolver,
      Settings.System.HAPTIC_FEEDBACK_ENABLED,
      1,
    ) != 0

  companion object {
    private const val MAX_STEPS = 8
    private const val MAX_DELAY_MS = 1_000

    private val PRIMITIVES = linkedMapOf(
      "click" to PrimitiveSpec(VibrationEffect.Composition.PRIMITIVE_CLICK, 30),
      "thud" to PrimitiveSpec(VibrationEffect.Composition.PRIMITIVE_THUD, 31),
      "spin" to PrimitiveSpec(VibrationEffect.Composition.PRIMITIVE_SPIN, 31),
      "quickRise" to PrimitiveSpec(VibrationEffect.Composition.PRIMITIVE_QUICK_RISE, 30),
      "slowRise" to PrimitiveSpec(VibrationEffect.Composition.PRIMITIVE_SLOW_RISE, 30),
      "quickFall" to PrimitiveSpec(VibrationEffect.Composition.PRIMITIVE_QUICK_FALL, 30),
      "tick" to PrimitiveSpec(VibrationEffect.Composition.PRIMITIVE_TICK, 30),
      "lowTick" to PrimitiveSpec(VibrationEffect.Composition.PRIMITIVE_LOW_TICK, 31),
    )
  }
}
