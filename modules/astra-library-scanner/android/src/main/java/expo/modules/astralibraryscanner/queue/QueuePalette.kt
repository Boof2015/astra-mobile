package expo.modules.astralibraryscanner.queue

import android.graphics.Color

data class QueuePalette(
  val background: Int = Color.rgb(24, 24, 28),
  val surface: Int = Color.rgb(35, 35, 41),
  val elevatedSurface: Int = Color.rgb(48, 48, 56),
  val selectedSurface: Int = Color.rgb(57, 62, 75),
  val nowPlayingSurface: Int = Color.rgb(31, 34, 43),
  val divider: Int = Color.rgb(72, 72, 82),
  val pressOverlay: Int = Color.argb(20, 140, 162, 208),
  val text: Int = Color.WHITE,
  val textSecondary: Int = Color.rgb(190, 190, 200),
  val textTertiary: Int = Color.rgb(135, 135, 148),
  val accent: Int = Color.rgb(122, 162, 255),
  val accentText: Int = Color.rgb(155, 181, 239),
  val accentTextStrong: Int = Color.rgb(186, 205, 248),
  val warning: Int = Color.rgb(255, 105, 105),
) {
  companion object {
    fun from(values: Map<String, Any?>?): QueuePalette {
      val defaults = QueuePalette()
      fun color(key: String, fallback: Int): Int =
        (values?.get(key) as? Number)?.toInt() ?: fallback
      return QueuePalette(
        background = color("background", defaults.background),
        surface = color("surface", defaults.surface),
        elevatedSurface = color("elevatedSurface", defaults.elevatedSurface),
        selectedSurface = color("selectedSurface", defaults.selectedSurface),
        nowPlayingSurface = color("nowPlayingSurface", defaults.nowPlayingSurface),
        divider = color("divider", defaults.divider),
        pressOverlay = color("pressOverlay", defaults.pressOverlay),
        text = color("text", defaults.text),
        textSecondary = color("textSecondary", defaults.textSecondary),
        textTertiary = color("textTertiary", defaults.textTertiary),
        accent = color("accent", defaults.accent),
        accentText = color("accentText", defaults.accentText),
        accentTextStrong = color("accentTextStrong", defaults.accentTextStrong),
        warning = color("warning", defaults.warning),
      )
    }
  }
}
