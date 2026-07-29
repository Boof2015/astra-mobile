package expo.modules.astralibraryscanner

import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.view.WindowManager
import android.content.pm.ApplicationInfo
import android.os.Trace
import android.util.Log
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.metrics.performance.JankStats
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.google.android.material.bottomsheet.BottomSheetDialog
import expo.modules.astralibraryscanner.queue.AstraQueueView
import expo.modules.astralibraryscanner.queue.NativeQueueSnapshot
import expo.modules.astralibraryscanner.queue.QueueContentView
import expo.modules.astralibraryscanner.queue.QueueCoordinator
import expo.modules.astralibraryscanner.queue.QueuePalette
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class AstraQueueModule : Module() {
  private var dialog: BottomSheetDialog? = null
  private var dialogContent: QueueContentView? = null
  private var lastRevision = Long.MIN_VALUE
  private var coordinator: QueueCoordinator? = null
  private var jankStats: JankStats? = null

  private val coordinatorListener: (NativeQueueSnapshot) -> Unit = { snapshot ->
    if (snapshot.revision != lastRevision) {
      lastRevision = snapshot.revision
      sendEvent(
        "onQueueRevision",
        mapOf(
          "sessionId" to snapshot.sessionId,
          "queueRevision" to snapshot.revision.toDouble(),
          "activePosition" to snapshot.activePosition.toDouble(),
          "totalCount" to snapshot.totalCount,
        ),
      )
    }
  }

  override fun definition() = ModuleDefinition {
    Name("AstraQueue")

    Events(
      "onDismissed",
      "onPlaybackRequest",
      "onQueueRevision",
    )

    OnCreate {
      val context = appContext.reactContext ?: return@OnCreate
      QueueCoordinator.get(context).also {
        coordinator = it
        it.addListener(coordinatorListener)
        it.start()
      }
    }

    OnDestroy {
      coordinator?.removeListener(coordinatorListener)
      coordinator = null
      appContext.mainQueue.launch {
        jankStats?.isTrackingEnabled = false
        jankStats = null
        dialog?.dismiss()
        dialog = null
        dialogContent = null
      }
    }

    AsyncFunction("present") Coroutine { options: Map<String, Any?> ->
      withContext(Dispatchers.Main) {
        presentDialog(options)
      }
    }

    Function("dismiss") {
      appContext.mainQueue.launch {
        dialog?.dismiss()
      }
    }

    Function("resolvePlaybackRequest") {
        requestId: String,
        success: Boolean,
        message: String?,
      ->
      requestId.length
      appContext.mainQueue.launch {
        dialogContent?.showPlaybackResult(success, message)
      }
    }

    AsyncFunction("resolveEntryPosition") Coroutine {
        entryId: Double,
        expectedRevision: Double,
      ->
      coordinator?.positionForEntry(entryId.toLong(), expectedRevision.toLong())?.toDouble()
    }

    View(AstraQueueView::class) {
      Prop("active") { view, active: Boolean ->
        view.active = active
      }
      Prop("palette") { view, values: Map<String, Any?>? ->
        view.palette = QueuePalette.from(values)
      }
      OnViewDidUpdateProps { view ->
        view.setPlaybackRequestListener { entryId, revision ->
          emitPlaybackRequest(entryId, revision)
        }
      }
    }
  }

  private fun presentDialog(options: Map<String, Any?>) {
    Trace.beginSection("AstraQueue.present")
    try {
    val activity = appContext.currentActivity
      ?: error("AstraQueue requires a foreground Activity")
    dialog?.dismiss()

    @Suppress("UNCHECKED_CAST")
    val paletteValues = options["palette"] as? Map<String, Any?>
    val content = QueueContentView(activity).apply {
      sheetMode = true
      palette = QueuePalette.from(paletteValues)
      playbackRequestListener = QueueContentView.PlaybackRequestListener { entryId, revision ->
        emitPlaybackRequest(entryId, revision)
      }
      attach()
    }
    val next = BottomSheetDialog(activity).apply {
      setContentView(content)
      setCanceledOnTouchOutside(true)
      setOnShowListener {
        val displayHeight = activity.resources.displayMetrics.heightPixels
        findViewById<FrameLayout>(
          com.google.android.material.R.id.design_bottom_sheet,
        )?.apply {
          layoutParams = layoutParams.apply {
            height = ViewGroup.LayoutParams.MATCH_PARENT
          }
          background = ColorDrawable(Color.TRANSPARENT)
        }
        content.layoutParams = content.layoutParams.apply {
          width = ViewGroup.LayoutParams.MATCH_PARENT
          height = ViewGroup.LayoutParams.MATCH_PARENT
        }
        behavior.peekHeight = (displayHeight * 0.58f).toInt()
        behavior.state = BottomSheetBehavior.STATE_COLLAPSED
        behavior.isFitToContents = false
        behavior.expandedOffset = 0
        behavior.isHideable = true
        behavior.skipCollapsed = false
        window?.apply {
          addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
          attributes = attributes.apply { dimAmount = 0.58f }
          setLayout(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
          )
        }
        val debuggable =
          activity.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
        if (debuggable) {
          window?.let { queueWindow ->
            jankStats?.isTrackingEnabled = false
            jankStats = JankStats.createAndTrack(queueWindow) { frame ->
              if (frame.isJank) {
                Log.d(
                  "AstraQueueJank",
                  "frameMs=${frame.frameDurationUiNanos / 1_000_000.0}",
                )
              }
            }
          }
        }
      }
      setOnDismissListener {
        jankStats?.isTrackingEnabled = false
        jankStats = null
        content.detach()
        if (dialog === this) {
          dialog = null
          dialogContent = null
          sendEvent("onDismissed", emptyMap<String, Any?>())
        }
      }
    }
    dialog = next
    dialogContent = content
    next.show()
    } finally {
      Trace.endSection()
    }
  }

  private fun emitPlaybackRequest(entryId: Long, revision: Long) {
    sendEvent(
      "onPlaybackRequest",
      mapOf(
        "requestId" to UUID.randomUUID().toString(),
        "kind" to "playEntry",
        "entryId" to entryId.toDouble(),
        "queueRevision" to revision.toDouble(),
      ),
    )
  }
}
