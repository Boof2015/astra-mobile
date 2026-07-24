package expo.modules.astralibraryscanner

import android.content.Context
import expo.modules.astralibraryscanner.data.AstraLibraryRepository
import expo.modules.astralibraryscanner.data.LibraryStatusSnapshot
import expo.modules.astralibraryscanner.data.StaleRevisionException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AstraLibraryDataModule : Module() {
  private var repository: AstraLibraryRepository? = null
  private val statusListener: (LibraryStatusSnapshot) -> Unit = { status ->
    sendEvent("onLibraryStatus", status.toMap())
  }
  private val catalogListener: (Long) -> Unit = { revision ->
    sendEvent("onCatalogChanged", mapOf("catalogRevision" to revision.toString()))
  }

  override fun definition() = ModuleDefinition {
    Name("AstraLibraryData")

    Events(
      "onLibraryStatus",
      "onScanProgress",
      "onCatalogChanged",
    )

    OnCreate {
      val instance = repository()
      instance.addStatusListener(statusListener)
      instance.addCatalogListener(catalogListener)
    }

    OnDestroy {
      repository?.removeStatusListener(statusListener)
      repository?.removeCatalogListener(catalogListener)
    }

    AsyncFunction("initialize").Coroutine<Map<String, Any?>> {
      repository().initialize().toMap()
    }

    Function("getCurrentStatus") {
      repository().status().toMap()
    }

    AsyncFunction("getSettings") Coroutine { keys: List<String> ->
      repositoryCall { getSettings(keys) }
    }

    AsyncFunction("setSettings") Coroutine { values: Map<String, String?> ->
      repositoryCall { setSettings(values) }
    }

    AsyncFunction("listFolders").Coroutine<List<Map<String, Any?>>> {
      repositoryCall { listFolders() }
    }

    AsyncFunction("getFolderNodes") Coroutine { parentNodeId: String? ->
      repositoryCall { getFolderNodes(parentNodeId) }
    }

    AsyncFunction("getFolderTracks") Coroutine {
        nodeId: String,
        offset: Int,
        limit: Int,
      ->
      repositoryCall { getFolderTracks(nodeId, offset, limit) }
    }

    AsyncFunction("registerFolder") Coroutine { treeUri: String, displayName: String ->
      repositoryCall { registerFolder(treeUri, displayName) }
    }

    AsyncFunction("removeFolder") Coroutine { folderId: Double ->
      repositoryCall { removeFolder(folderId.toLong()) }
    }

    AsyncFunction("getTrackPage") Coroutine {
        sort: String,
        cursor: String?,
        limit: Int,
      ->
      try {
        repository().getTrackPage(sort, cursor, limit)
      } catch (_: StaleRevisionException) {
        mapOf("error" to "STALE_REVISION")
      }
    }

    AsyncFunction("getTrack") Coroutine { path: String ->
      repository().getTrack(path)
    }

    AsyncFunction("getTrackLoudness") Coroutine { paths: List<String> ->
      repository().getTrackLoudness(paths)
    }

    AsyncFunction("setTrackLoudness") Coroutine { path: String, lufs: Double?, samplePeak: Double? ->
      repository().setTrackLoudness(path, lufs, samplePeak)
    }

    AsyncFunction("setTrackReplayGain") Coroutine {
        path: String,
        trackGainDb: Double?,
        albumGainDb: Double?,
        trackPeak: Double?,
        albumPeak: Double?,
      ->
      repository().setTrackReplayGain(path, trackGainDb, albumGainDb, trackPeak, albumPeak)
    }

    AsyncFunction("getLibraryLoudnessStats").Coroutine<Map<String, Any?>> {
      repository().getLibraryLoudnessStats()
    }

    AsyncFunction("getWaveform") Coroutine { path: String ->
      repository().getWaveform(path)
    }

    AsyncFunction("putWaveform") Coroutine { path: String, peaks: List<Double> ->
      repository().putWaveform(path, peaks)
    }

    AsyncFunction("countWaveforms").Coroutine<Double> {
      repository().countWaveforms().toDouble()
    }

    AsyncFunction("clearWaveforms").Coroutine<Unit> {
      repository().clearWaveforms()
    }

    AsyncFunction("getLyrics") Coroutine { path: String, metadataSignature: String ->
      repository().getLyrics(path, metadataSignature)
    }

    AsyncFunction("putLyrics") Coroutine { path: String, values: Map<String, Any?> ->
      repository().putLyrics(path, values)
    }

    AsyncFunction("deleteLyrics") Coroutine { path: String ->
      repository().deleteLyrics(path)
    }

    AsyncFunction("countLyrics").Coroutine<Double> {
      repository().countLyrics().toDouble()
    }

    AsyncFunction("clearLyrics").Coroutine<Unit> {
      repository().clearLyrics()
    }

    AsyncFunction("readMobileSession").Coroutine<String?> {
      repositoryCall { readMobileSession() }
    }

    AsyncFunction("writeMobileSession") Coroutine { snapshotJson: String ->
      repositoryCall { writeMobileSession(snapshotJson) }
    }

    AsyncFunction("createPlaybackContext") Coroutine {
        context: Map<String, Any?>,
        anchorPath: String?,
        shuffle: Boolean,
        seed: Double?,
      ->
      repositoryCall { createPlaybackContext(context, anchorPath, shuffle, seed?.toLong()) }
    }

    AsyncFunction("getPlaybackWindow") Coroutine { sessionId: String, start: Double, limit: Int ->
      repositoryCall { getPlaybackWindow(sessionId, start.toLong(), limit) }
    }

    AsyncFunction("updatePlaybackPosition") Coroutine { sessionId: String, activePosition: Double ->
      repositoryCall { updatePlaybackPosition(sessionId, activePosition.toLong()) }
    }

    AsyncFunction("restorePlaybackContext").Coroutine<Map<String, Any?>?> {
      repositoryCall { restorePlaybackContext() }
    }

    AsyncFunction("mutatePlaybackContext") Coroutine {
        operation: String,
        values: Map<String, Any?>,
      ->
      repositoryCall { mutatePlaybackContext(operation, values) }
    }

    AsyncFunction("recordTrackPlayed") Coroutine { path: String ->
      repositoryCall { recordTrackPlayed(path) }
    }

    AsyncFunction("getRecentlyPlayed") Coroutine { limit: Int ->
      repositoryCall { getRecentlyPlayed(limit) }
    }

    AsyncFunction("listRemoteSources").Coroutine<List<Map<String, Any?>>> {
      repositoryCall { listRemoteSources() }
    }

    AsyncFunction("getRemoteSource") Coroutine { sourceId: Double ->
      repositoryCall { getRemoteSource(sourceId.toLong()) }
    }

    AsyncFunction("createRemoteSource") Coroutine {
        type: String,
        name: String,
        baseUrl: String,
        username: String,
        enabled: Boolean,
      ->
      repositoryCall { createRemoteSource(type, name, baseUrl, username, enabled) }
    }

    AsyncFunction("updateRemoteSource") Coroutine { sourceId: Double, fields: Map<String, Any?> ->
      repositoryCall { updateRemoteSource(sourceId.toLong(), fields) }
    }

    AsyncFunction("setRemoteSourceStatus") Coroutine {
        sourceId: Double,
        status: String,
        error: String?,
      ->
      repositoryCall { setRemoteSourceStatus(sourceId.toLong(), status, error) }
    }

    AsyncFunction("deleteRemoteSource") Coroutine { sourceId: Double, purgeCatalog: Boolean ->
      repositoryCall { deleteRemoteSource(sourceId.toLong(), purgeCatalog) }
    }

    AsyncFunction("replaceRemoteUserState") Coroutine {
        sourceId: Double,
        sourceType: String,
        favoritePaths: List<String>,
        playlists: List<Map<String, Any?>>,
      ->
      repositoryCall { replaceRemoteUserState(
        sourceId.toLong(),
        sourceType,
        favoritePaths,
        playlists,
      ) }
    }

    AsyncFunction("beginRemoteSync") Coroutine { sourceId: Double, sourceType: String ->
      repository().beginRemoteSync(sourceId.toLong(), sourceType)
    }

    AsyncFunction("appendRemoteTracks") Coroutine {
        syncId: String,
        rows: List<Map<String, Any?>>,
      ->
      repository().appendRemoteTracks(syncId, rows)
    }

    AsyncFunction("commitRemoteSync") Coroutine { syncId: String ->
      repository().commitRemoteSync(syncId)
    }

    AsyncFunction("abortRemoteSync") Coroutine { syncId: String ->
      repository().abortRemoteSync(syncId)
    }

    AsyncFunction("listPlaylists").Coroutine<List<Map<String, Any?>>> {
      repositoryCall { listPlaylists() }
    }

    AsyncFunction("createPlaylist") Coroutine { name: String, kind: String, rulesJson: String? ->
      repositoryCall { createPlaylist(name, kind, rulesJson) }
    }

    AsyncFunction("getDynamicPlaylistRules") Coroutine { playlistId: Double ->
      repositoryCall { getDynamicPlaylistRules(playlistId.toLong()) }
    }

    AsyncFunction("updateDynamicPlaylistRules") Coroutine { playlistId: Double, rulesJson: String ->
      repositoryCall { updateDynamicPlaylistRules(playlistId.toLong(), rulesJson) }
    }

    AsyncFunction("previewDynamicPlaylist") Coroutine { rulesJson: String ->
      repository().previewDynamicPlaylist(rulesJson)
    }

    AsyncFunction("renamePlaylist") Coroutine { playlistId: Double, name: String ->
      repositoryCall { renamePlaylist(playlistId.toLong(), name) }
    }

    AsyncFunction("deletePlaylist") Coroutine { playlistId: Double ->
      repositoryCall { deletePlaylist(playlistId.toLong()) }
    }

    AsyncFunction("markPlaylistPlayed") Coroutine { playlistId: Double ->
      repositoryCall { markPlaylistPlayed(playlistId.toLong()) }
    }

    AsyncFunction("addPlaylistEntries") Coroutine {
        playlistId: Double,
        entries: List<Map<String, Any?>>,
      ->
      repositoryCall { addPlaylistEntries(playlistId.toLong(), entries) }
    }

    AsyncFunction("removePlaylistEntry") Coroutine { playlistId: Double, path: String ->
      repositoryCall { removePlaylistEntry(playlistId.toLong(), path) }
    }

    AsyncFunction("movePlaylistEntry") Coroutine {
        playlistId: Double,
        path: String,
        direction: Int,
      ->
      repositoryCall { movePlaylistEntry(playlistId.toLong(), path, direction) }
    }

    AsyncFunction("getPlaylistEntries") Coroutine {
        playlistId: Double,
        offset: Int,
        limit: Int,
      ->
      repositoryCall { getPlaylistEntries(playlistId.toLong(), offset, limit) }
    }

    AsyncFunction("getFavoritePaths").Coroutine<List<String>> {
      repositoryCall { getFavoritePaths() }
    }

    AsyncFunction("getFavoriteTracks") Coroutine { limit: Int ->
      repositoryCall { getFavoriteTracks(limit) }
    }

    AsyncFunction("setFavorite") Coroutine { path: String, favorite: Boolean ->
      repositoryCall { setFavorite(path, favorite) }
    }

    AsyncFunction("getDesktopSyncState").Coroutine<Map<String, Any?>> {
      repositoryCall { getDesktopSyncState() }
    }

    AsyncFunction("applyDesktopSyncPlan") Coroutine { plan: Map<String, Any?> ->
      repositoryCall { applyDesktopSyncPlan(plan) }
    }

    AsyncFunction("resolveDesktopSyncConflict") Coroutine {
        conflict: Map<String, Any?>,
        resolution: String,
        mergedPlaylist: Map<String, Any?>?,
      ->
      repositoryCall { resolveDesktopSyncConflict(conflict, resolution, mergedPlaylist) }
    }

    AsyncFunction("clearDesktopSyncBaselines").Coroutine<Unit> {
      repositoryCall { clearDesktopSyncBaselines() }
    }

    AsyncFunction("getAlbumPage") Coroutine {
        sort: String,
        includeSingles: Boolean,
        cursor: String?,
        limit: Int,
      ->
      try {
        repository().getAlbumPage(sort, includeSingles, cursor, limit)
      } catch (_: StaleRevisionException) {
        mapOf("error" to "STALE_REVISION")
      }
    }

    AsyncFunction("getArtistPage") Coroutine {
        sort: String,
        groupingMode: String,
        includeCollaborations: Boolean,
        cursor: String?,
        limit: Int,
      ->
      try {
        repository().getArtistPage(sort, groupingMode, includeCollaborations, cursor, limit)
      } catch (_: StaleRevisionException) {
        mapOf("error" to "STALE_REVISION")
      }
    }

    AsyncFunction("getAlbumDetail") Coroutine { albumKey: String, cursor: String?, limit: Int ->
      try {
        repository().getAlbumDetail(albumKey, cursor, limit)
      } catch (_: StaleRevisionException) {
        mapOf("error" to "STALE_REVISION")
      }
    }

    AsyncFunction("getArtistDetail") Coroutine {
        artistKey: String,
        groupingMode: String,
        section: String,
        cursor: String?,
        limit: Int,
      ->
      try {
        repository().getArtistDetail(artistKey, groupingMode, section, cursor, limit)
      } catch (_: StaleRevisionException) {
        mapOf("error" to "STALE_REVISION")
      }
    }

    AsyncFunction("getArtistAlbums") Coroutine {
        artistKey: String,
        groupingMode: String,
        offset: Int,
        limit: Int,
      ->
      repository().getArtistAlbums(artistKey, groupingMode, offset, limit)
    }

    AsyncFunction("searchTracks") Coroutine { query: String, limit: Int ->
      repository().searchTracks(query, limit)
    }

    AsyncFunction("searchLibrary") Coroutine {
        query: String,
        limit: Int,
        includeSingles: Boolean,
        groupingMode: String,
        includeCollaborations: Boolean,
      ->
      repository().searchLibrary(
        query,
        limit,
        includeSingles,
        groupingMode,
        includeCollaborations,
      )
    }

    AsyncFunction("matchSignal") Coroutine { title: String, artist: String, durationSeconds: Double? ->
      repository().matchSignal(title, artist, durationSeconds)
    }

    AsyncFunction("getSectionAnchors") Coroutine {
        kind: String,
        sort: String,
        includeSingles: Boolean,
        groupingMode: String,
        includeCollaborations: Boolean,
      ->
      repository().getSectionAnchors(
        kind,
        sort,
        includeSingles,
        groupingMode,
        includeCollaborations,
      )
    }

    AsyncFunction("flushUserSnapshot").Coroutine<Unit> {
      repositoryCall { flushSnapshot() }
    }
  }

  private fun repository(): AstraLibraryRepository {
    val existing = repository
    if (existing != null) return existing
    return AstraLibraryRepository.get(requireContext()).also { repository = it }
  }

  private suspend fun <T> repositoryCall(
    block: suspend AstraLibraryRepository.() -> T,
  ): T = repository().withUserRecovery(block)

  private fun requireContext(): Context =
    appContext.reactContext ?: throw Exceptions.ReactContextLost()
}
