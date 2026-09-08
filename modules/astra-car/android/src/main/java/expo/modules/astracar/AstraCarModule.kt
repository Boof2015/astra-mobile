package expo.modules.astracar

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.astralibraryscanner.data.AstraLibraryRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class AstraCarPlaybackContext : Record {
  @Field val shuffle: Boolean = false
  @Field val repeat: String = "none"
  @Field val sessionId: String? = null
}

class AstraCarModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AstraCar")
    Function("setPlaybackContext") { context: AstraCarPlaybackContext ->
      AstraCarPlaybackBridge.setContext(requireContext(), context.shuffle, context.repeat, context.sessionId)
    }
    Function("registerArtworkSource") { sourceId: Double, template: String? ->
      AstraCarArtworkCache.register(requireContext(), sourceId.toLong(), template)
    }
    Function("completeCommand") { requestId: String, error: String? -> AstraCarCommandService.complete(requestId, error) }
    AsyncFunction("isCommandActive") Coroutine { requestId: String ->
      withContext(Dispatchers.Main.immediate) { AstraCarCommandService.isActive(requestId) }
    }
    AsyncFunction("getResumeState") { AstraCarNowPlayingStore.resumeState(requireContext()) }
    AsyncFunction("selectQueueEntry") Coroutine { session: String, entryId: String ->
      withContext(Dispatchers.IO) { AstraCarQueue(requireContext()).select(session, entryId) }
    }
    AsyncFunction("resolveQueueEntry") Coroutine { session: String, entryId: String ->
      withContext(Dispatchers.IO) {
        val context = requireContext()
        AstraLibraryRepository.get(context).initialize()
        AstraCarQueue(context).resolve(session, entryId)
      }
    }
  }
  private fun requireContext() = appContext.reactContext ?: throw Exceptions.ReactContextLost()
}
