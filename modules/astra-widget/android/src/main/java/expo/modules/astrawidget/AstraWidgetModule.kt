package expo.modules.astrawidget

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class AstraWidgetNowPlayingState : Record {
  @Field
  val title: String? = null

  @Field
  val artist: String? = null

  @Field
  val artworkUri: String? = null

  @Field
  val artworkFullUri: String? = null

  @Field
  val playbackState: String = "stopped"

  @Field
  val hasTrack: Boolean = false

  @Field
  val recentlyPlayed: List<AstraWidgetRecentItemState> = emptyList()

  @Field
  val replaceRecentlyPlayed: Boolean = false
}

class AstraWidgetRecentItemState : Record {
  @Field
  val title: String? = null

  @Field
  val artist: String? = null

  @Field
  val artworkUri: String? = null
}

class AstraWidgetThemeTokensRecord : Record {
  @Field
  val bgPrimary: String = ""

  @Field
  val bgSecondary: String = ""

  @Field
  val bgTertiary: String = ""

  @Field
  val textPrimary: String = ""

  @Field
  val accent: String = ""

  @Field
  val accentText: String = ""

  internal fun toTokens() = AppThemeTokens(bgPrimary, bgSecondary, bgTertiary, textPrimary, accent, accentText)
}

class AstraWidgetAppThemeRecord : Record {
  @Field
  val dark: AstraWidgetThemeTokensRecord = AstraWidgetThemeTokensRecord()

  @Field
  val light: AstraWidgetThemeTokensRecord = AstraWidgetThemeTokensRecord()

  @Field
  val materialYou: Boolean = false
}

class AstraWidgetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AstraWidget")

    // The widget's buttons, delivered here while Astra's JS is running.
    Events("onCommand")

    OnStartObserving("onCommand") {
      AstraWidgetCommands.attach { command -> sendEvent("onCommand", mapOf("command" to command)) }
    }

    OnStopObserving("onCommand") {
      AstraWidgetCommands.detach()
    }

    OnDestroy {
      AstraWidgetCommands.detach()
    }

    Function("setNowPlaying") { state: AstraWidgetNowPlayingState ->
      val context = requireContext()
      val firstPush = !AstraWidgetCommands.jsAlive
      AstraWidgetCommands.jsAlive = true
      val previous = AstraWidgetStateStore.load(context)
      val recentlyPlayed =
        if (state.replaceRecentlyPlayed) {
          state.recentlyPlayed
            .map {
              AstraWidgetRecentItem(
                title = it.title,
                artist = it.artist,
                artworkUri = it.artworkUri,
              )
            }
            .take(8)
        } else {
          previous.recentlyPlayed
        }
      val next = AstraWidgetState(
        title = state.title,
        artist = state.artist,
        artworkUri = if (state.hasTrack) state.artworkUri else null,
        artworkFullUri = if (state.hasTrack) state.artworkFullUri else null,
        playbackState = state.playbackState,
        hasTrack = state.hasTrack,
        recentlyPlayed = recentlyPlayed,
      )
      AstraWidgetStateStore.save(context, next)
      // Built off the JS thread and coalesced; see requestUpdateAll.
      // The first push also replaces whatever a JS-less process last drew.
      if (previous != next || firstPush) AstraWidgetUpdater.requestUpdateAll(context)
    }

    // The app theme for the "Astra" style, pushed whenever it changes.
    Function("setAppTheme") { theme: AstraWidgetAppThemeRecord ->
      val context = requireContext()
      val changed = AstraWidgetThemeStore.save(
        context,
        AstraWidgetAppTheme(theme.dark.toTokens(), theme.light.toTokens(), theme.materialYou),
      )
      if (changed) AstraWidgetUpdater.requestUpdateAll(context)
    }
  }

  private fun requireContext(): Context =
    appContext.reactContext ?: throw Exceptions.ReactContextLost()
}
