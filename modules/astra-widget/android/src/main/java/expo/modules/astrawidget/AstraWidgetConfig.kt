package expo.modules.astrawidget

import android.content.Context
import org.json.JSONObject

internal interface KeyedOption {
  val key: String
}

internal inline fun <reified E> parseOption(key: String?, fallback: E): E
  where E : Enum<E>, E : KeyedOption = enumValues<E>().firstOrNull { it.key == key } ?: fallback

/** Where the widget's colors come from. */
internal enum class WidgetStyle(override val key: String) : KeyedOption {
  /** The song playing: now playing's field and adaptive accent. */
  COVER_ART("cover_art"),
  /** The wallpaper, through the system's dynamic color (API 31+). */
  MATERIAL_YOU("material_you"),
  /** Whatever theme and accent the app is set to. */
  APP("app"),
  /** Midnight navy, whatever the app is set to. */
  CLASSIC("classic"),
}

internal enum class WidgetAppearance(override val key: String) : KeyedOption {
  SYSTEM("system"),
  LIGHT("light"),
  DARK("dark"),
}

internal enum class CoverTreatment(override val key: String) : KeyedOption {
  /** Now playing's living field, frozen. */
  GRADIENT("gradient"),
  /** One calm tone from the cover. */
  FLAT("flat"),
}

internal enum class MaterialYouMapping(override val key: String) : KeyedOption {
  NEUTRAL("neutral"),
  TINTED("tinted"),
  BOLD("bold"),
}

internal enum class ClassicAccent(override val key: String) : KeyedOption {
  INDIGO("indigo"),
  CYAN("cyan"),
}

internal enum class PlayButtonShape(override val key: String) : KeyedOption {
  CIRCLE("circle"),
  /** M3 expressive: a circle while paused, a rounded square while playing. */
  MORPH("morph"),
}

/** One placed widget's settings, from the long-press Customize sheet. */
internal data class AstraWidgetConfig(
  val style: WidgetStyle = WidgetStyle.COVER_ART,
  val appearance: WidgetAppearance = WidgetAppearance.SYSTEM,
  /** Background opacity, 0–100. Text, art and buttons stay solid. */
  val opacity: Int = 100,
  val showRecents: Boolean = true,
  val coverTreatment: CoverTreatment = CoverTreatment.GRADIENT,
  val materialYouMapping: MaterialYouMapping = MaterialYouMapping.TINTED,
  val classicAccent: ClassicAccent = ClassicAccent.INDIGO,
  val playButtonShape: PlayButtonShape = PlayButtonShape.CIRCLE,
)

/**
 * Per-widget settings, keyed by appWidgetId. A widget with nothing saved (placed
 * before this existed, or added silently with configuration_optional) gets the
 * defaults.
 */
internal object AstraWidgetConfigStore {
  private const val PREFS_NAME = "astra_widget_config"

  private fun prefs(context: Context) =
    context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  private fun keyFor(appWidgetId: Int) = "widget_$appWidgetId"

  fun load(context: Context, appWidgetId: Int): AstraWidgetConfig {
    val raw = prefs(context).getString(keyFor(appWidgetId), null) ?: return AstraWidgetConfig()
    return runCatching { decode(JSONObject(raw)) }.getOrDefault(AstraWidgetConfig())
  }

  fun save(context: Context, appWidgetId: Int, config: AstraWidgetConfig) {
    prefs(context).edit().putString(keyFor(appWidgetId), encode(config).toString()).apply()
  }

  fun delete(context: Context, appWidgetIds: IntArray) {
    val editor = prefs(context).edit()
    appWidgetIds.forEach { editor.remove(keyFor(it)) }
    editor.apply()
  }

  /** Backup restore hands placed widgets new ids. */
  fun remap(context: Context, oldIds: IntArray, newIds: IntArray) {
    val prefs = prefs(context)
    val editor = prefs.edit()
    oldIds.zip(newIds).forEach { (old, new) ->
      val raw = prefs.getString(keyFor(old), null) ?: return@forEach
      editor.remove(keyFor(old)).putString(keyFor(new), raw)
    }
    editor.apply()
  }

  private fun encode(config: AstraWidgetConfig) = JSONObject()
    .put("style", config.style.key)
    .put("appearance", config.appearance.key)
    .put("opacity", config.opacity)
    .put("showRecents", config.showRecents)
    .put("coverTreatment", config.coverTreatment.key)
    .put("materialYouMapping", config.materialYouMapping.key)
    .put("classicAccent", config.classicAccent.key)
    .put("playButtonShape", config.playButtonShape.key)

  private fun decode(json: JSONObject): AstraWidgetConfig {
    val defaults = AstraWidgetConfig()
    return AstraWidgetConfig(
      style = parseOption(json.optString("style"), defaults.style),
      appearance = parseOption(json.optString("appearance"), defaults.appearance),
      opacity = json.optInt("opacity", defaults.opacity).coerceIn(0, 100),
      showRecents = json.optBoolean("showRecents", defaults.showRecents),
      coverTreatment = parseOption(json.optString("coverTreatment"), defaults.coverTreatment),
      materialYouMapping = parseOption(json.optString("materialYouMapping"), defaults.materialYouMapping),
      classicAccent = parseOption(json.optString("classicAccent"), defaults.classicAccent),
      playButtonShape = parseOption(json.optString("playButtonShape"), defaults.playButtonShape),
    )
  }
}
