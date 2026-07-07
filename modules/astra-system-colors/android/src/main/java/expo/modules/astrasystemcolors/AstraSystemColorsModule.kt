package expo.modules.astrasystemcolors

import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Exposes Android 12+ monet system palettes (wallpaper-derived) to JS.
 * Each ramp is 13 hex strings ordered by tone [0, 10, 50, 100..1000].
 * Sync Functions on purpose: resource reads are microseconds, and it avoids
 * the zero-arg Coroutine {} overload ambiguity in expo-modules-core.
 */
class AstraSystemColorsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AstraSystemColors")

    Function("isAvailable") { Build.VERSION.SDK_INT >= 31 }

    Function("getSystemPalette") {
      if (Build.VERSION.SDK_INT < 31) return@Function null
      val context = appContext.reactContext ?: return@Function null
      fun ramp(ids: IntArray) = ids.map { String.format("#%06x", context.getColor(it) and 0xFFFFFF) }
      mapOf(
        "accent1" to ramp(ACCENT1),
        "accent2" to ramp(ACCENT2),
        "accent3" to ramp(ACCENT3),
        "neutral1" to ramp(NEUTRAL1),
        "neutral2" to ramp(NEUTRAL2),
      )
    }
  }

  companion object {
    private val ACCENT1 = intArrayOf(
      android.R.color.system_accent1_0,
      android.R.color.system_accent1_10,
      android.R.color.system_accent1_50,
      android.R.color.system_accent1_100,
      android.R.color.system_accent1_200,
      android.R.color.system_accent1_300,
      android.R.color.system_accent1_400,
      android.R.color.system_accent1_500,
      android.R.color.system_accent1_600,
      android.R.color.system_accent1_700,
      android.R.color.system_accent1_800,
      android.R.color.system_accent1_900,
      android.R.color.system_accent1_1000,
    )
    private val ACCENT2 = intArrayOf(
      android.R.color.system_accent2_0,
      android.R.color.system_accent2_10,
      android.R.color.system_accent2_50,
      android.R.color.system_accent2_100,
      android.R.color.system_accent2_200,
      android.R.color.system_accent2_300,
      android.R.color.system_accent2_400,
      android.R.color.system_accent2_500,
      android.R.color.system_accent2_600,
      android.R.color.system_accent2_700,
      android.R.color.system_accent2_800,
      android.R.color.system_accent2_900,
      android.R.color.system_accent2_1000,
    )
    private val ACCENT3 = intArrayOf(
      android.R.color.system_accent3_0,
      android.R.color.system_accent3_10,
      android.R.color.system_accent3_50,
      android.R.color.system_accent3_100,
      android.R.color.system_accent3_200,
      android.R.color.system_accent3_300,
      android.R.color.system_accent3_400,
      android.R.color.system_accent3_500,
      android.R.color.system_accent3_600,
      android.R.color.system_accent3_700,
      android.R.color.system_accent3_800,
      android.R.color.system_accent3_900,
      android.R.color.system_accent3_1000,
    )
    private val NEUTRAL1 = intArrayOf(
      android.R.color.system_neutral1_0,
      android.R.color.system_neutral1_10,
      android.R.color.system_neutral1_50,
      android.R.color.system_neutral1_100,
      android.R.color.system_neutral1_200,
      android.R.color.system_neutral1_300,
      android.R.color.system_neutral1_400,
      android.R.color.system_neutral1_500,
      android.R.color.system_neutral1_600,
      android.R.color.system_neutral1_700,
      android.R.color.system_neutral1_800,
      android.R.color.system_neutral1_900,
      android.R.color.system_neutral1_1000,
    )
    private val NEUTRAL2 = intArrayOf(
      android.R.color.system_neutral2_0,
      android.R.color.system_neutral2_10,
      android.R.color.system_neutral2_50,
      android.R.color.system_neutral2_100,
      android.R.color.system_neutral2_200,
      android.R.color.system_neutral2_300,
      android.R.color.system_neutral2_400,
      android.R.color.system_neutral2_500,
      android.R.color.system_neutral2_600,
      android.R.color.system_neutral2_700,
      android.R.color.system_neutral2_800,
      android.R.color.system_neutral2_900,
      android.R.color.system_neutral2_1000,
    )
  }
}
