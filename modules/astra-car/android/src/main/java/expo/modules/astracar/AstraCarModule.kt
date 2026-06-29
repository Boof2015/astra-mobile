package expo.modules.astracar

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class AstraCarNowPlayingRecord : Record {
  @Field
  val title: String? = null

  @Field
  val artist: String? = null

  @Field
  val album: String? = null

  @Field
  val artworkHash: String? = null

  @Field
  val artworkSourceId: String? = null

  @Field
  val artworkSourceKey: Double? = null

  @Field
  val playbackState: String = "stopped"

  @Field
  val hasTrack: Boolean = false

  @Field
  val duration: Double? = null

  @Field
  val position: Double? = null

  @Field
  val trackPath: String? = null

  @Field
  val isFavorite: Boolean = false
}

class AstraCarModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AstraCar")

    Function("setNowPlaying") { state: AstraCarNowPlayingRecord ->
      val context = requireContext()
      AstraCarNowPlayingStore.saveAndApply(
        context,
        AstraCarNowPlayingState(
          title = state.title,
          artist = state.artist,
          album = state.album,
          artworkUri = resolveArtworkUri(context, state),
          playbackState = state.playbackState,
          hasTrack = state.hasTrack,
          durationSeconds = state.duration,
          positionSeconds = state.position,
          trackPath = state.trackPath,
          isFavorite = state.isFavorite,
        ),
      )
    }
  }

  /** Build the content:// art URI Android Auto can load (local hash wins; else remote ref). */
  private fun resolveArtworkUri(context: Context, state: AstraCarNowPlayingRecord): String? {
    val hash = state.artworkHash?.trim()
    if (!hash.isNullOrEmpty()) return AstraCarArtwork.localUri(context, hash, full = true).toString()
    val sourceId = state.artworkSourceKey?.toLong()
    val artId = state.artworkSourceId?.trim()
    if (sourceId != null && !artId.isNullOrEmpty()) {
      return AstraCarArtwork.remoteUri(context, sourceId, artId).toString()
    }
    return null
  }

  private fun requireContext(): Context =
    appContext.reactContext ?: throw Exceptions.ReactContextLost()
}
