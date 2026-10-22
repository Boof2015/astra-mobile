package expo.modules.astrawidget

import android.content.Context
import org.json.JSONObject

/** The app palette tokens the widget's "Astra" style uses, as #rrggbb. */
internal data class AppThemeTokens(
  val bgPrimary: String,
  val bgSecondary: String,
  val bgTertiary: String,
  val textPrimary: String,
  val accent: String,
  val accentText: String,
)

/**
 * The app's theme for the "Astra" style: both versions, so the widget's own
 * Light/Dark/System choice can pick one. `materialYou` hands the style to the
 * system's dynamic colors instead, which re-tint live on wallpaper changes.
 */
internal data class AstraWidgetAppTheme(
  val dark: AppThemeTokens,
  val light: AppThemeTokens,
  val materialYou: Boolean,
)

/**
 * Pushed from JS whenever the theme changes and persisted here, so headless
 * updates (a skip from Bluetooth with the UI never started) still have it.
 */
internal object AstraWidgetThemeStore {
  private const val PREFS_NAME = "astra_widget_theme"
  private const val KEY_THEME = "theme"

  private fun prefs(context: Context) =
    context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  fun load(context: Context): AstraWidgetAppTheme? {
    val raw = prefs(context).getString(KEY_THEME, null) ?: return null
    return runCatching {
      val json = JSONObject(raw)
      AstraWidgetAppTheme(
        dark = decodeTokens(json.getJSONObject("dark")),
        light = decodeTokens(json.getJSONObject("light")),
        materialYou = json.optBoolean("materialYou", false),
      )
    }.getOrNull()
  }

  /** Returns whether anything changed. */
  fun save(context: Context, theme: AstraWidgetAppTheme): Boolean {
    if (load(context) == theme) return false
    val json = JSONObject()
      .put("dark", encodeTokens(theme.dark))
      .put("light", encodeTokens(theme.light))
      .put("materialYou", theme.materialYou)
    prefs(context).edit().putString(KEY_THEME, json.toString()).apply()
    return true
  }

  private fun encodeTokens(tokens: AppThemeTokens) = JSONObject()
    .put("bgPrimary", tokens.bgPrimary)
    .put("bgSecondary", tokens.bgSecondary)
    .put("bgTertiary", tokens.bgTertiary)
    .put("textPrimary", tokens.textPrimary)
    .put("accent", tokens.accent)
    .put("accentText", tokens.accentText)

  private fun decodeTokens(json: JSONObject) = AppThemeTokens(
    bgPrimary = json.getString("bgPrimary"),
    bgSecondary = json.getString("bgSecondary"),
    bgTertiary = json.getString("bgTertiary"),
    textPrimary = json.getString("textPrimary"),
    accent = json.getString("accent"),
    accentText = json.getString("accentText"),
  )
}
