package expo.modules.astrawidget

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.SizeF
import android.widget.FrameLayout
import android.widget.RemoteViews
import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * The long-press Customize sheet: a Material 3 bottom sheet over the home
 * screen, editing one placed widget. On API 31+ the widget is added without it
 * (configuration_optional) and it opens only from the launcher's Customize;
 * below that it opens on add, and backing out cancels the add.
 */
class AstraWidgetConfigureActivity : ComponentActivity() {
  private var appWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    appWidgetId = intent?.extras?.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
      ?: AppWidgetManager.INVALID_APPWIDGET_ID
    setResult(Activity.RESULT_CANCELED, resultIntent())
    if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
      finish()
      return
    }
    WindowCompat.setDecorFitsSystemWindows(window, false)

    val initial = AstraWidgetConfigStore.load(this, appWidgetId)
    val size = AstraWidgetUpdater.currentSize(AppWidgetManager.getInstance(this).getAppWidgetOptions(appWidgetId))
    setContentView(
      ComposeView(this).apply {
        setContent {
          CustomizeSheet(initial = initial, widgetSize = size, onSave = ::save, onDismiss = ::finish)
        }
      },
    )
  }

  private fun resultIntent() = Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)

  private fun save(config: AstraWidgetConfig) {
    AstraWidgetConfigStore.save(this, appWidgetId, config)
    AstraWidgetUpdater.requestUpdate(this, appWidgetId)
    setResult(Activity.RESULT_OK, resultIntent())
    finish()
  }
}

// ── Look: Astra's sheet colors, Inter, no outlines ───────────

private class SheetColors(
  val sheet: Color,
  val card: Color,
  val ink: Color,
  val inkMuted: Color,
  val accent: Color,
  val onAccent: Color,
  val selected: Color,
  val track: Color,
)

private val DarkSheet = SheetColors(
  sheet = Color(0xFF0C0F18),
  card = Color(0xFF141A2E),
  ink = Color(0xFFE2E8F4),
  inkMuted = Color(0xFF8A98B8),
  accent = Color(0xFF5B8AFF),
  onAccent = Color(0xFF080A0F),
  selected = Color(0x335B8AFF),
  track = Color(0x387C92C4),
)

private val LightSheet = SheetColors(
  sheet = Color(0xFFFFFFFF),
  card = Color(0xFFEEF1F8),
  ink = Color(0xFF171D2E),
  inkMuted = Color(0xFF4D5A78),
  accent = Color(0xFF3F6FE8),
  onAccent = Color(0xFFFFFFFF),
  selected = Color(0x243F6FE8),
  track = Color(0x2E344A82),
)

private val Inter = FontFamily(
  Font(R.font.inter_regular, FontWeight.Normal),
  Font(R.font.inter_semibold, FontWeight.SemiBold),
)

private val TitleStyle = TextStyle(fontFamily = Inter, fontWeight = FontWeight.SemiBold, fontSize = 20.sp, lineHeight = 26.sp)
private val HeadingStyle = TextStyle(fontFamily = Inter, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, lineHeight = 18.sp)
private val BodyStyle = TextStyle(fontFamily = Inter, fontWeight = FontWeight.Normal, fontSize = 12.sp, lineHeight = 16.sp)
private val LabelStyle = TextStyle(fontFamily = Inter, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, lineHeight = 18.sp)
private val CardTitleStyle = TextStyle(fontFamily = Inter, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, lineHeight = 18.sp)

private class StyleOption(val style: WidgetStyle, val name: String, val description: String)

private val STYLE_OPTIONS = listOf(
  StyleOption(WidgetStyle.COVER_ART, "Cover art", "Colors from the song playing"),
  StyleOption(WidgetStyle.MATERIAL_YOU, "Material You", "Colors from your wallpaper"),
  StyleOption(WidgetStyle.APP, "Astra", "Matches your app theme"),
  StyleOption(WidgetStyle.CLASSIC, "Astra classic", "Midnight navy, always"),
)

// ── Sheet ────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CustomizeSheet(
  initial: AstraWidgetConfig,
  widgetSize: SizeF,
  onSave: (AstraWidgetConfig) -> Unit,
  onDismiss: () -> Unit,
) {
  val colors = if (isSystemInDarkTheme()) DarkSheet else LightSheet
  var config by remember { mutableStateOf(initial) }
  val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
  val scope = rememberCoroutineScope()
  fun close(then: () -> Unit) {
    scope.launch { sheetState.hide() }.invokeOnCompletion { then() }
  }

  ModalBottomSheet(
    onDismissRequest = onDismiss,
    sheetState = sheetState,
    containerColor = colors.sheet,
    contentColor = colors.ink,
    dragHandle = { BottomSheetDefaults.DragHandle(color = colors.inkMuted.copy(alpha = 0.4f)) },
  ) {
    Column(
      modifier = Modifier
        .verticalScroll(rememberScrollState())
        .padding(start = 20.dp, end = 20.dp, bottom = 20.dp),
      verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
      Text("Customize widget", style = TitleStyle, color = colors.ink)

      WidgetPreview(config, widgetSize, colors)

      Section("Style", colors) {
        StyleCards(config, colors) { config = config.copy(style = it) }
        StyleSettings(config, colors) { config = it }
      }

      Section("Play button", colors) {
        Segmented(
          options = listOf(PlayButtonShape.CIRCLE to "Circle", PlayButtonShape.MORPH to "Morph"),
          selected = config.playButtonShape,
          colors = colors,
        ) { config = config.copy(playButtonShape = it) }
        Hint("Morph turns into a rounded square while music plays.", colors)
      }

      Section("Appearance", colors) {
        Segmented(
          options = listOf(
            WidgetAppearance.SYSTEM to "System",
            WidgetAppearance.LIGHT to "Light",
            WidgetAppearance.DARK to "Dark",
          ),
          selected = config.appearance,
          colors = colors,
        ) { config = config.copy(appearance = it) }
      }

      Section("Background", colors) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
          Slider(
            value = config.opacity.toFloat(),
            onValueChange = { config = config.copy(opacity = ((it / 5).roundToInt() * 5).coerceIn(0, 100)) },
            valueRange = 0f..100f,
            steps = 19,
            colors = SliderDefaults.colors(
              thumbColor = colors.accent,
              activeTrackColor = colors.accent,
              inactiveTrackColor = colors.track,
              activeTickColor = colors.onAccent.copy(alpha = 0.5f),
              inactiveTickColor = colors.inkMuted.copy(alpha = 0.5f),
            ),
            modifier = Modifier.weight(1f),
          )
          Text("${config.opacity}%", style = LabelStyle, color = colors.ink, modifier = Modifier.width(44.dp))
        }
      }

      Row(
        modifier = Modifier
          .fillMaxWidth()
          .toggleable(value = config.showRecents, role = Role.Switch) { config = config.copy(showRecents = it) },
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
          Text("Recently played", style = HeadingStyle, color = colors.inkMuted)
          Hint("Shows on 4×3 and larger", colors)
        }
        Switch(
          checked = config.showRecents,
          onCheckedChange = null,
          colors = SwitchDefaults.colors(
            checkedThumbColor = colors.onAccent,
            checkedTrackColor = colors.accent,
            checkedBorderColor = Color.Transparent,
            uncheckedThumbColor = colors.inkMuted,
            uncheckedTrackColor = colors.track,
            uncheckedBorderColor = Color.Transparent,
          ),
        )
      }

      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        TextButton(onClick = { close(onDismiss) }) {
          Text("Cancel", style = LabelStyle, color = colors.accent)
        }
        Spacer(Modifier.width(8.dp))
        Button(
          onClick = { close { onSave(config) } },
          colors = ButtonDefaults.buttonColors(containerColor = colors.accent, contentColor = colors.onAccent),
        ) {
          Text("Save", style = LabelStyle)
        }
      }
    }
  }
}

@Composable
private fun Section(title: String, colors: SheetColors, content: @Composable () -> Unit) {
  Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
    Text(title, style = HeadingStyle, color = colors.inkMuted)
    content()
  }
}

@Composable
private fun Hint(text: String, colors: SheetColors) {
  Text(text, style = BodyStyle, color = colors.inkMuted)
}

/** Pill segments; the selection is a fill, not an outline. */
@Composable
private fun <T> Segmented(
  options: List<Pair<T, String>>,
  selected: T,
  colors: SheetColors,
  enabled: (T) -> Boolean = { true },
  onSelect: (T) -> Unit,
) {
  Row(
    modifier = Modifier
      .fillMaxWidth()
      .clip(CircleShape)
      .background(colors.card)
      .padding(3.dp),
    horizontalArrangement = Arrangement.spacedBy(2.dp),
  ) {
    options.forEach { (value, label) ->
      val on = value == selected
      Box(
        modifier = Modifier
          .weight(1f)
          .clip(CircleShape)
          .background(if (on) colors.accent else Color.Transparent)
          .selectable(selected = on, enabled = enabled(value), role = Role.RadioButton) { onSelect(value) }
          .padding(vertical = 9.dp),
        contentAlignment = Alignment.Center,
      ) {
        Text(
          label,
          style = LabelStyle,
          color = when {
            on -> colors.onAccent
            enabled(value) -> colors.inkMuted
            else -> colors.inkMuted.copy(alpha = 0.4f)
          },
        )
      }
    }
  }
}

@Composable
private fun StyleCards(config: AstraWidgetConfig, colors: SheetColors, onPick: (WidgetStyle) -> Unit) {
  val context = LocalContext.current
  val dark = isSystemInDarkTheme()
  // Each style's colors for what's playing now, in the widget's own appearance.
  val swatches by produceState<Map<WidgetStyle, List<Color>>>(emptyMap(), config) {
    value = withContext(Dispatchers.Default) {
      // A style that can't resolve keeps a blank swatch; it must never take the sheet down.
      STYLE_OPTIONS.mapNotNull { option ->
        val paint = runCatching {
          AstraWidgetUpdater.paintFor(context, config.copy(style = option.style))
        }.getOrNull() ?: return@mapNotNull null
        val roles = when (config.appearance) {
          WidgetAppearance.SYSTEM -> paint.forNight(dark)
          WidgetAppearance.LIGHT -> paint.day
          WidgetAppearance.DARK -> paint.night
        }
        option.style to listOf(
          roles.field?.getOrNull(0) ?: roles.surface,
          roles.field?.getOrNull(1) ?: roles.tile,
          roles.accent,
          roles.subtitle,
        ).map { Color(roles.argb(it)) }
      }.toMap()
    }
  }

  Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
    STYLE_OPTIONS.chunked(2).forEach { row ->
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        row.forEach { option ->
          val available = option.style != WidgetStyle.MATERIAL_YOU || WidgetPalettes.materialYouAvailable
          val on = config.style == option.style
          Column(
            modifier = Modifier
              .weight(1f)
              .heightIn(min = 112.dp)
              .clip(RoundedCornerShape(18.dp))
              .background(if (on) colors.selected else colors.card)
              .selectable(selected = on, enabled = available, role = Role.RadioButton) { onPick(option.style) }
              .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
          ) {
            Row(
              Modifier
                .fillMaxWidth()
                .height(22.dp)
                .clip(RoundedCornerShape(8.dp)),
            ) {
              (swatches[option.style] ?: List(4) { colors.track }).forEach {
                Box(Modifier.weight(1f).fillMaxHeight().background(it))
              }
            }
            Text(option.name, style = CardTitleStyle, color = if (available) colors.ink else colors.inkMuted)
            Text(
              if (available) option.description else "Needs Android 12 or newer",
              style = BodyStyle,
              color = colors.inkMuted,
            )
          }
        }
      }
    }
  }
}

/** Each style's own setting, shown under the cards for the selected style. */
@Composable
private fun StyleSettings(config: AstraWidgetConfig, colors: SheetColors, onChange: (AstraWidgetConfig) -> Unit) {
  Column(
    modifier = Modifier
      .fillMaxWidth()
      .clip(RoundedCornerShape(18.dp))
      .background(colors.card)
      .padding(12.dp),
    verticalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    when (config.style) {
      WidgetStyle.COVER_ART -> {
        Hint("Background", colors)
        Segmented(
          options = listOf(CoverTreatment.GRADIENT to "Gradient", CoverTreatment.FLAT to "Flat tone"),
          selected = config.coverTreatment,
          colors = colors.onCard(),
          enabled = { it == CoverTreatment.FLAT || Build.VERSION.SDK_INT >= Build.VERSION_CODES.S },
        ) { onChange(config.copy(coverTreatment = it)) }
        Hint("Gradient is now playing's color field. Flat is one calm tone from the cover.", colors)
      }
      WidgetStyle.MATERIAL_YOU -> {
        Hint("Colors", colors)
        Segmented(
          options = listOf(
            MaterialYouMapping.NEUTRAL to "Neutral",
            MaterialYouMapping.TINTED to "Tinted",
            MaterialYouMapping.BOLD to "Bold",
          ),
          selected = config.materialYouMapping,
          colors = colors.onCard(),
        ) { onChange(config.copy(materialYouMapping = it)) }
        Hint("Follows your wallpaper, even while Astra is closed.", colors)
      }
      WidgetStyle.APP -> Hint("Uses the theme and accent from Settings › Appearance in Astra.", colors)
      WidgetStyle.CLASSIC -> {
        Hint("Accent", colors)
        Segmented(
          options = listOf(ClassicAccent.INDIGO to "Indigo", ClassicAccent.CYAN to "Astra Cyan"),
          selected = config.classicAccent,
          colors = colors.onCard(),
        ) { onChange(config.copy(classicAccent = it)) }
      }
    }
  }
}

/** Segments sitting on a card use the sheet color as their track. */
private fun SheetColors.onCard() = SheetColors(sheet, sheet, ink, inkMuted, accent, onAccent, selected, track)

/**
 * The widget itself at its real size: the same RemoteViews the launcher gets,
 * applied here, scaled down only if the sheet is narrower.
 */
@Composable
private fun WidgetPreview(config: AstraWidgetConfig, widgetSize: SizeF, colors: SheetColors) {
  val context = LocalContext.current
  val views by produceState<RemoteViews?>(null, config) {
    value = withContext(Dispatchers.Default) {
      runCatching { AstraWidgetUpdater.buildPreview(context, config, widgetSize) }.getOrNull()
    }
  }
  BoxWithConstraints(
    modifier = Modifier
      .fillMaxWidth()
      .clip(RoundedCornerShape(20.dp))
      .background(colors.card)
      .padding(16.dp),
    contentAlignment = Alignment.Center,
  ) {
    val width = widgetSize.width.dp
    val height = widgetSize.height.dp
    val scale = min(1f, maxWidth / width)
    Box(Modifier.size(width * scale, height * scale)) {
      AndroidView(
        factory = { FrameLayout(it) },
        modifier = Modifier
          .wrapContentSize(Alignment.TopStart, unbounded = true)
          .requiredSize(width, height)
          .graphicsLayer {
            scaleX = scale
            scaleY = scale
            transformOrigin = TransformOrigin(0f, 0f)
          },
        update = { frame ->
          val remote = views ?: return@AndroidView
          frame.removeAllViews()
          runCatching { frame.addView(remote.apply(frame.context, frame)) }
        },
      )
    }
  }
}
