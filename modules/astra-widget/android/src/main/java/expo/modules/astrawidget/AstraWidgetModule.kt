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

class AstraWidgetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AstraWidget")

    Function("setNowPlaying") { state: AstraWidgetNowPlayingState ->
      val context = requireContext()
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
      AstraWidgetStateStore.save(
        context,
        AstraWidgetState(
          title = state.title,
          artist = state.artist,
          artworkUri = if (state.hasTrack) state.artworkUri else null,
          playbackState = state.playbackState,
          hasTrack = state.hasTrack,
          recentlyPlayed = recentlyPlayed,
        ),
      )
      AstraWidgetUpdater.updateAll(context)
    }
  }

  private fun requireContext(): Context =
    appContext.reactContext ?: throw Exceptions.ReactContextLost()
}
