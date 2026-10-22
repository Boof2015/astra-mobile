package expo.modules.astrawidget

import android.content.Context
import android.graphics.Color
import android.os.Build
import androidx.annotation.ColorRes

/** One theme's resolved widget colors, as #rrggbb. */
internal data class WidgetRoles(
  val isDark: Boolean,
  val surface: String,
  /** The empty-art tile behind the Astra mark. */
  val tile: String,
  val title: String,
  val subtitle: String,
  val icon: String,
  val accent: String,
  /** The play glyph on the accent fill. */
  val onAccent: String,
  /** Cover gradient: field colors drawn over [surface] at [fieldStrength]. */
  val field: List<String>? = null,
  val fieldStrength: Double = 0.0,
) {
  fun argb(hex: String): Int = Color.parseColor(hex)

  /** Labels and the eyebrow: the title color, quieter. */
  val mutedArgb: Int get() = (argb(title) and 0x00ffffff) or (MUTED_ALPHA shl 24)

  companion object {
    private const val MUTED_ALPHA = 0xa3 // 0.64
  }
}

/**
 * Material You's colors as resources rather than values: the launcher resolves
 * them itself, so wallpaper and dark-mode changes re-tint the widget without
 * Astra running.
 */
internal class MaterialYouColors(
  @ColorRes val surface: Int,
  @ColorRes val title: Int,
  @ColorRes val subtitle: Int,
  @ColorRes val muted: Int,
  @ColorRes val icon: Int,
  @ColorRes val accent: Int,
  @ColorRes val onAccent: Int,
)

/** A widget's colors: day and night roles (equal when the appearance is forced). */
internal class WidgetPaint(
  val day: WidgetRoles,
  val night: WidgetRoles,
  val materialYou: MaterialYouColors?,
) {
  fun forNight(night: Boolean) = if (night) this.night else day
}

internal object WidgetPalettes {
  private class Base(val bgPrimary: String, val bgSecondary: String, val bgTertiary: String, val textPrimary: String)

  // src/theme/palettes.ts
  private val MIDNIGHT = Base("#080a0f", "#0c0f18", "#11162a", "#e2e8f4")
  private val LIGHT = Base("#f4f6fb", "#eaeef7", "#dde4f2", "#171d2e")

  // src/theme/accents.ts. Indigo's dark text is the hand-tuned override.
  private const val INDIGO = "#5b8aff"
  private const val INDIGO_DARK_TEXT = "#a9c0ff"
  private const val CYAN = "#00b3ff"

  val ON_ACCENT_DARK: String = MIDNIGHT.bgPrimary
  val ON_ACCENT_LIGHT: String = LIGHT.bgPrimary

  val materialYouAvailable: Boolean get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S

  /** accents.ts deriveAccentBase: accentText sits at HSL L 83 (dark) / 36 (light). */
  private fun accentText(base: String, isDark: Boolean): String {
    if (isDark && base == INDIGO) return INDIGO_DARK_TEXT
    val hsl = ArtworkColorMath.hexToHsl(base)
    return ArtworkColorMath.hslToHex(hsl[0], hsl[1], if (isDark) 83.0 else 36.0)
  }

  private fun tokens(isDark: Boolean, accent: String): AppThemeTokens {
    val base = if (isDark) MIDNIGHT else LIGHT
    return AppThemeTokens(base.bgPrimary, base.bgSecondary, base.bgTertiary, base.textPrimary, accent, accentText(accent, isDark))
  }

  private fun fromTokens(t: AppThemeTokens, isDark: Boolean) = WidgetRoles(
    isDark = isDark,
    surface = if (isDark) t.bgSecondary else t.bgPrimary,
    tile = t.bgTertiary,
    title = t.textPrimary,
    subtitle = t.accentText,
    icon = t.textPrimary,
    accent = t.accent,
    onAccent = t.bgPrimary,
  )

  private fun classic(isDark: Boolean, accent: ClassicAccent) =
    fromTokens(tokens(isDark, if (accent == ClassicAccent.CYAN) CYAN else INDIGO), isDark)

  /**
   * Now playing's colors for this cover: its field over Midnight/Light and its
   * adaptive accent, with the subtitle lifted to stay readable over the field's
   * brightest point (fieldContrast.ts).
   */
  private fun coverArt(
    isDark: Boolean,
    colors: ArtworkColorMath.CoverColors?,
    treatment: CoverTreatment,
  ): WidgetRoles {
    val p = tokens(isDark, INDIGO)
    val field = colors?.let { if (isDark) it.fieldDark else it.fieldLight }
      ?: return fromTokens(p, isDark)
    val accent = (if (isDark) colors.accentDark else colors.accentLight) ?: p.accent
    val strength = ArtworkColorMath.fieldStrength(isDark, field.neutral)
    // Below API 31 the card can't clip a bitmap to its corners, so it gets the flat tone.
    val gradient = treatment == CoverTreatment.GRADIENT && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    val surface = if (gradient) p.bgPrimary else ArtworkColorMath.mixHex(p.bgPrimary, field.colors[0], strength)
    val worst = if (gradient) {
      ArtworkColorMath.worstFieldSurface(p.bgPrimary, field.colors, strength, isDark)
    } else {
      surface
    }
    return WidgetRoles(
      isDark = isDark,
      surface = surface,
      tile = ArtworkColorMath.mixHex(p.bgPrimary, field.colors[1], 0.5),
      title = p.textPrimary,
      subtitle = ArtworkColorMath.liftToContrast(accentText(accent, isDark), p.textPrimary, worst, 4.5),
      icon = p.textPrimary,
      accent = accent,
      onAccent = p.bgPrimary,
      field = if (gradient) field.colors else null,
      fieldStrength = if (gradient) strength else 0.0,
    )
  }

  /**
   * astra_widget_material_you.xml (values, values-v31, values-night-v31) by
   * mapping and appearance, in role order surface, tile, title, subtitle,
   * muted, icon, accent, on_accent.
   * Referenced through R, never looked up by name: release builds shrink
   * resources, and a name-only lookup lets the shrinker delete them all.
   */
  private val MATERIAL_YOU_COLORS: Map<Pair<MaterialYouMapping, WidgetAppearance>, IntArray> = mapOf(
    (MaterialYouMapping.NEUTRAL to WidgetAppearance.SYSTEM) to intArrayOf(
      R.color.astra_widget_my_neutral_surface,
      R.color.astra_widget_my_neutral_tile,
      R.color.astra_widget_my_neutral_title,
      R.color.astra_widget_my_neutral_subtitle,
      R.color.astra_widget_my_neutral_muted,
      R.color.astra_widget_my_neutral_icon,
      R.color.astra_widget_my_neutral_accent,
      R.color.astra_widget_my_neutral_on_accent,
    ),
    (MaterialYouMapping.NEUTRAL to WidgetAppearance.LIGHT) to intArrayOf(
      R.color.astra_widget_my_neutral_surface_light,
      R.color.astra_widget_my_neutral_tile_light,
      R.color.astra_widget_my_neutral_title_light,
      R.color.astra_widget_my_neutral_subtitle_light,
      R.color.astra_widget_my_neutral_muted_light,
      R.color.astra_widget_my_neutral_icon_light,
      R.color.astra_widget_my_neutral_accent_light,
      R.color.astra_widget_my_neutral_on_accent_light,
    ),
    (MaterialYouMapping.NEUTRAL to WidgetAppearance.DARK) to intArrayOf(
      R.color.astra_widget_my_neutral_surface_dark,
      R.color.astra_widget_my_neutral_tile_dark,
      R.color.astra_widget_my_neutral_title_dark,
      R.color.astra_widget_my_neutral_subtitle_dark,
      R.color.astra_widget_my_neutral_muted_dark,
      R.color.astra_widget_my_neutral_icon_dark,
      R.color.astra_widget_my_neutral_accent_dark,
      R.color.astra_widget_my_neutral_on_accent_dark,
    ),
    (MaterialYouMapping.TINTED to WidgetAppearance.SYSTEM) to intArrayOf(
      R.color.astra_widget_my_tinted_surface,
      R.color.astra_widget_my_tinted_tile,
      R.color.astra_widget_my_tinted_title,
      R.color.astra_widget_my_tinted_subtitle,
      R.color.astra_widget_my_tinted_muted,
      R.color.astra_widget_my_tinted_icon,
      R.color.astra_widget_my_tinted_accent,
      R.color.astra_widget_my_tinted_on_accent,
    ),
    (MaterialYouMapping.TINTED to WidgetAppearance.LIGHT) to intArrayOf(
      R.color.astra_widget_my_tinted_surface_light,
      R.color.astra_widget_my_tinted_tile_light,
      R.color.astra_widget_my_tinted_title_light,
      R.color.astra_widget_my_tinted_subtitle_light,
      R.color.astra_widget_my_tinted_muted_light,
      R.color.astra_widget_my_tinted_icon_light,
      R.color.astra_widget_my_tinted_accent_light,
      R.color.astra_widget_my_tinted_on_accent_light,
    ),
    (MaterialYouMapping.TINTED to WidgetAppearance.DARK) to intArrayOf(
      R.color.astra_widget_my_tinted_surface_dark,
      R.color.astra_widget_my_tinted_tile_dark,
      R.color.astra_widget_my_tinted_title_dark,
      R.color.astra_widget_my_tinted_subtitle_dark,
      R.color.astra_widget_my_tinted_muted_dark,
      R.color.astra_widget_my_tinted_icon_dark,
      R.color.astra_widget_my_tinted_accent_dark,
      R.color.astra_widget_my_tinted_on_accent_dark,
    ),
    (MaterialYouMapping.BOLD to WidgetAppearance.SYSTEM) to intArrayOf(
      R.color.astra_widget_my_bold_surface,
      R.color.astra_widget_my_bold_tile,
      R.color.astra_widget_my_bold_title,
      R.color.astra_widget_my_bold_subtitle,
      R.color.astra_widget_my_bold_muted,
      R.color.astra_widget_my_bold_icon,
      R.color.astra_widget_my_bold_accent,
      R.color.astra_widget_my_bold_on_accent,
    ),
    (MaterialYouMapping.BOLD to WidgetAppearance.LIGHT) to intArrayOf(
      R.color.astra_widget_my_bold_surface_light,
      R.color.astra_widget_my_bold_tile_light,
      R.color.astra_widget_my_bold_title_light,
      R.color.astra_widget_my_bold_subtitle_light,
      R.color.astra_widget_my_bold_muted_light,
      R.color.astra_widget_my_bold_icon_light,
      R.color.astra_widget_my_bold_accent_light,
      R.color.astra_widget_my_bold_on_accent_light,
    ),
    (MaterialYouMapping.BOLD to WidgetAppearance.DARK) to intArrayOf(
      R.color.astra_widget_my_bold_surface_dark,
      R.color.astra_widget_my_bold_tile_dark,
      R.color.astra_widget_my_bold_title_dark,
      R.color.astra_widget_my_bold_subtitle_dark,
      R.color.astra_widget_my_bold_muted_dark,
      R.color.astra_widget_my_bold_icon_dark,
      R.color.astra_widget_my_bold_accent_dark,
      R.color.astra_widget_my_bold_on_accent_dark,
    ),
  )

  private fun materialYouIds(mapping: MaterialYouMapping, appearance: WidgetAppearance): IntArray =
    MATERIAL_YOU_COLORS.getValue(mapping to appearance)

  /** Resolved values for bitmaps and swatches; the forced variants don't depend on the configuration. */
  private fun materialYou(context: Context, mapping: MaterialYouMapping, isDark: Boolean): WidgetRoles {
    val ids = materialYouIds(mapping, if (isDark) WidgetAppearance.DARK else WidgetAppearance.LIGHT)
    fun hex(index: Int): String = String.format("#%06x", context.getColor(ids[index]) and 0xffffff)
    return WidgetRoles(
      isDark = isDark,
      surface = hex(0),
      tile = hex(1),
      title = hex(2),
      subtitle = hex(3),
      icon = hex(5),
      accent = hex(6),
      onAccent = hex(7),
    )
  }

  private fun materialYouColors(mapping: MaterialYouMapping, appearance: WidgetAppearance): MaterialYouColors {
    val ids = materialYouIds(mapping, appearance)
    return MaterialYouColors(
      surface = ids[0],
      title = ids[2],
      subtitle = ids[3],
      muted = ids[4],
      icon = ids[5],
      accent = ids[6],
      onAccent = ids[7],
    )
  }

  fun resolve(
    context: Context,
    config: AstraWidgetConfig,
    cover: ArtworkColorMath.CoverColors?,
    appTheme: AstraWidgetAppTheme?,
  ): WidgetPaint {
    val (dayDark, nightDark) = when (config.appearance) {
      WidgetAppearance.SYSTEM -> false to true
      WidgetAppearance.LIGHT -> false to false
      WidgetAppearance.DARK -> true to true
    }

    val materialYouMapping: MaterialYouMapping? = when {
      !materialYouAvailable -> null
      config.style == WidgetStyle.MATERIAL_YOU -> config.materialYouMapping
      config.style == WidgetStyle.APP && appTheme?.materialYou == true -> MaterialYouMapping.TINTED
      else -> null
    }
    if (materialYouMapping != null) {
      return WidgetPaint(
        day = materialYou(context, materialYouMapping, dayDark),
        night = materialYou(context, materialYouMapping, nightDark),
        materialYou = materialYouColors(materialYouMapping, config.appearance),
      )
    }

    fun roles(isDark: Boolean): WidgetRoles = when (config.style) {
      WidgetStyle.COVER_ART -> coverArt(isDark, cover, config.coverTreatment)
      WidgetStyle.CLASSIC -> classic(isDark, config.classicAccent)
      // Material You below API 31 falls back to the app theme.
      WidgetStyle.APP, WidgetStyle.MATERIAL_YOU -> appTheme
        ?.let { fromTokens(if (isDark) it.dark else it.light, isDark) }
        ?: classic(isDark, ClassicAccent.INDIGO)
    }
    return WidgetPaint(day = roles(dayDark), night = roles(nightDark), materialYou = null)
  }
}
