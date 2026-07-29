package expo.modules.astralibraryscanner.queue

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.recyclerview.widget.DefaultItemAnimator
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ItemTouchHelper
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.google.android.material.snackbar.Snackbar
import java.io.File
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

private val NON_INTER_CHARACTER =
  Regex("[^\\u0000-\\u024F\\u0370-\\u03FF\\u0400-\\u04FF\\u2000-\\u206F\\u20A0-\\u20CF\\u2100-\\u214F]")
private const val MAX_ANIMATED_REORDER_ROWS = 48

class QueueContentView(
  context: Context,
) : LinearLayout(context) {
  fun interface PlaybackRequestListener {
    fun onPlaybackRequest(entryId: Long, queueRevision: Long)
  }

  private val coordinator = QueueCoordinator.get(context)
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private val selectedIds = linkedSetOf<Long>()
  private val haptics = QueueHaptics(context)
  var palette: QueuePalette = QueuePalette()
    set(value) {
      field = value
      applyPalette()
    }
  private val regularTypeface = loadTypeface("Inter_400Regular.ttf", Typeface.NORMAL)
  private val mediumTypeface = loadTypeface("Inter_500Medium.ttf", Typeface.NORMAL)
  private val semiboldTypeface = loadTypeface("Inter_600SemiBold.ttf", Typeface.BOLD)
  private val adapter = QueueAdapter()
  private val recycler = RecyclerView(context)
  private val layoutManager = LinearLayoutManager(context)
  private val sheetHandle = View(context)
  private val titleView = label("Queue", 20f, semiboldTypeface)
  private val countView = label("No songs next", 12f, mediumTypeface)
  private val editButton = label("Edit", 12f, mediumTypeface)
  private val playingNowLabel = label("PLAYING NOW", 11f, regularTypeface)
  private val upNextLabel = label("UP NEXT", 11f, regularTypeface)
  private val nowArtwork = ImageView(context)
  private val nowTitle = label("Nothing playing", 15f, regularTypeface)
  private val nowArtist = label("", 12f, mediumTypeface)
  private val nowIndicator = ImageView(context)
  private val nowCard = LinearLayout(context)
  private val actionBar = LinearLayout(context)
  private val playNextButton = label("Play next", 12f, mediumTypeface)
  private val removeButton = label("Remove", 12f, mediumTypeface)
  private val emptyView = label("Nothing queued", 14f, regularTypeface)
  private val swipePaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val swipeIconPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val swipeIconPath = Path()
  private var latestSnapshot = NativeQueueSnapshot.Empty
  private var coordinatorAttached = false
  private var editMode = false
  private var dragFromId: Long? = null
  private var dragTargetId: Long? = null
  private var swipeEntryId: Long? = null
  private var swipeArmed = false

  var playbackRequestListener: PlaybackRequestListener? = null

  var sheetMode: Boolean = false
    set(value) {
      field = value
      sheetHandle.visibility = if (value) VISIBLE else GONE
      applyPalette()
    }

  var active: Boolean = true
    set(value) {
      field = value
      if (value) attach() else detach()
    }

  private val coordinatorListener: (NativeQueueSnapshot) -> Unit = { snapshot ->
    post { render(snapshot) }
  }

  private val touchHelper: ItemTouchHelper = ItemTouchHelper(
    object : ItemTouchHelper.SimpleCallback(
      ItemTouchHelper.UP or ItemTouchHelper.DOWN,
      ItemTouchHelper.LEFT or ItemTouchHelper.RIGHT,
    ) {
      override fun isLongPressDragEnabled(): Boolean = false

      override fun getSwipeThreshold(viewHolder: RecyclerView.ViewHolder): Float =
        (dp(84).toFloat() / max(1, viewHolder.itemView.width))
          .coerceIn(0.16f, 0.42f)

      override fun getSwipeEscapeVelocity(defaultValue: Float): Float =
        defaultValue * 0.62f

      override fun getSwipeVelocityThreshold(defaultValue: Float): Float =
        defaultValue * 0.72f

      override fun getMovementFlags(
        recyclerView: RecyclerView,
        viewHolder: RecyclerView.ViewHolder,
      ): Int {
        val drag = if (editMode) 0 else ItemTouchHelper.UP or ItemTouchHelper.DOWN
        val swipe = if (editMode) 0 else ItemTouchHelper.LEFT or ItemTouchHelper.RIGHT
        return makeMovementFlags(drag, swipe)
      }

      override fun onSelectedChanged(viewHolder: RecyclerView.ViewHolder?, actionState: Int) {
        super.onSelectedChanged(viewHolder, actionState)
        if (actionState == ItemTouchHelper.ACTION_STATE_DRAG && viewHolder != null) {
          recycler.itemAnimator = createDragItemAnimator()
          adapter.rowAt(viewHolder.bindingAdapterPosition)?.let { row ->
            dragFromId = row.entryId
            dragTargetId = row.entryId
          }
          haptics.lift(viewHolder.itemView)
          viewHolder.itemView.alpha = 0.96f
          viewHolder.itemView.scaleX = 1.02f
          viewHolder.itemView.scaleY = 1.02f
        }
      }

      override fun onMove(
        recyclerView: RecyclerView,
        viewHolder: RecyclerView.ViewHolder,
        target: RecyclerView.ViewHolder,
      ): Boolean {
        val from = viewHolder.bindingAdapterPosition
        val to = target.bindingAdapterPosition
        val targetId = adapter.rowAt(to)?.entryId ?: return false
        if (!adapter.move(from, to)) return false
        dragTargetId = targetId
        haptics.step(target.itemView)
        return true
      }

      override fun clearView(
        recyclerView: RecyclerView,
        viewHolder: RecyclerView.ViewHolder,
      ) {
        super.clearView(recyclerView, viewHolder)
        viewHolder.itemView.alpha = 1f
        viewHolder.itemView.scaleX = 1f
        viewHolder.itemView.scaleY = 1f
        swipeEntryId = null
        swipeArmed = false
        val from = dragFromId
        val to = dragTargetId
        dragFromId = null
        dragTargetId = null
        if (from != null) {
          // Animation is useful while neighboring rows make room for the
          // dragged holder. End it at drop so later Room reconciliation and
          // swipe recovery stay visually exact.
          recycler.itemAnimator = null
        }
        if (from == null || to == null || from == to) return
        haptics.drop(viewHolder.itemView)
        launchMutation("Could not reorder the queue") {
          coordinator.move(from, to)
        }
      }

      override fun onSwiped(viewHolder: RecyclerView.ViewHolder, direction: Int) {
        val entryId = viewHolder.itemId
        val position = adapter.positionOf(entryId)
        if (position < 0) {
          adapter.notifyDataSetChanged()
          return
        }
        if (direction == ItemTouchHelper.RIGHT) {
          // A successful swipe remains in ItemTouchHelper's pending-cleanup
          // set until its holder is detached. This row is moved rather than
          // removed, so reset the helper to run clearView before RecyclerView
          // reuses the same stable holder at position zero.
          recycler.post {
            touchHelper.attachToRecyclerView(null)
            ItemTouchHelper.Callback.getDefaultUIUtil().clearView(viewHolder.itemView)
            adapter.moveSwipedToFront(position)
            touchHelper.attachToRecyclerView(recycler)
            launchMutation("Could not move the song") {
              coordinator.moveAfterActive(setOf(entryId))
            }
          }
        } else {
          adapter.removeAt(position)
          launchMutation("Could not remove the song") {
            coordinator.remove(setOf(entryId))
          }
        }
        haptics.confirm(viewHolder.itemView)
        swipeEntryId = null
        swipeArmed = false
      }

      override fun onChildDraw(
        canvas: Canvas,
        recyclerView: RecyclerView,
        viewHolder: RecyclerView.ViewHolder,
        dX: Float,
        dY: Float,
        actionState: Int,
        isCurrentlyActive: Boolean,
      ) {
        if (actionState == ItemTouchHelper.ACTION_STATE_SWIPE) {
          drawSwipeLane(canvas, viewHolder.itemView, dX)
          val entryId = viewHolder.itemId
          val armedNow = abs(dX) >= dp(84)
          if (swipeEntryId != entryId) {
            swipeEntryId = entryId
            swipeArmed = false
          }
          if (armedNow != swipeArmed) {
            swipeArmed = armedNow
            haptics.threshold(viewHolder.itemView, armedNow)
          }
        }
        super.onChildDraw(
          canvas,
          recyclerView,
          viewHolder,
          dX,
          dY,
          actionState,
          isCurrentlyActive,
        )
      }
    },
  )

  init {
    orientation = VERTICAL
    clipToPadding = false

    sheetHandle.visibility = GONE
    addView(
      sheetHandle,
      LayoutParams(dp(38), dp(4)).apply {
        gravity = Gravity.CENTER_HORIZONTAL
        topMargin = dp(8)
        bottomMargin = dp(8)
      },
    )

    val header = LinearLayout(context).apply {
      orientation = HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(16), 0, dp(8), dp(12))
    }
    val headerText = LinearLayout(context).apply {
      orientation = VERTICAL
      addView(titleView)
      addView(countView)
    }
    header.addView(headerText, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
    editButton.apply {
      gravity = Gravity.CENTER
      setPadding(dp(16), dp(8), dp(16), dp(8))
      isClickable = true
      isFocusable = true
      contentDescription = "Edit queue"
      setOnClickListener { setEditMode(!editMode) }
    }
    header.addView(editButton)
    addView(header)

    addView(playingNowLabel.apply {
      setPadding(dp(16), 0, dp(16), dp(4))
    })

    nowCard.apply {
      orientation = HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(12), dp(7), dp(12), dp(7))
    }
    nowArtwork.scaleType = ImageView.ScaleType.CENTER_CROP
    prepareArtwork(nowArtwork)
    nowCard.addView(nowArtwork, LayoutParams(dp(42), dp(42)))
    val nowText = LinearLayout(context).apply {
      orientation = VERTICAL
      setPadding(dp(12), 0, dp(8), 0)
      addView(nowTitle)
      addView(nowArtist)
    }
    nowCard.addView(nowText, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
    nowIndicator.setImageResource(android.R.drawable.ic_lock_silent_mode_off)
    nowIndicator.contentDescription = "Playing now"
    nowCard.addView(nowIndicator, LayoutParams(dp(22), dp(22)))
    addView(
      nowCard,
      LayoutParams(LayoutParams.MATCH_PARENT, dp(64)).apply {
        marginStart = dp(16)
        marginEnd = dp(16)
      },
    )

    addView(upNextLabel.apply {
      setPadding(dp(16), dp(12), dp(16), dp(4))
    })

    recycler.layoutManager = layoutManager
    recycler.adapter = adapter
    recycler.setHasFixedSize(true)
    recycler.itemAnimator = null
    recycler.setItemViewCacheSize(12)
    recycler.clipToPadding = false
    recycler.setPadding(0, 0, 0, dp(30))
    touchHelper.attachToRecyclerView(recycler)
    addView(recycler, LayoutParams(LayoutParams.MATCH_PARENT, 0, 1f))

    emptyView.gravity = Gravity.CENTER
    emptyView.visibility = GONE
    addView(emptyView, LayoutParams(LayoutParams.MATCH_PARENT, 0, 1f))

    actionBar.orientation = HORIZONTAL
    actionBar.gravity = Gravity.CENTER
    actionBar.setPadding(dp(12), dp(8), dp(12), dp(12))
    playNextButton.gravity = Gravity.CENTER
    removeButton.gravity = Gravity.CENTER
    actionBar.addView(playNextButton, LayoutParams(0, dp(48), 1f))
    actionBar.addView(removeButton, LayoutParams(0, dp(48), 1f))
    actionBar.visibility = GONE
    addView(actionBar)
    ViewCompat.setOnApplyWindowInsetsListener(this) { _, insets ->
      val bottomInset =
        insets.getInsets(WindowInsetsCompat.Type.systemBars()).bottom
      recycler.setPadding(0, 0, 0, dp(30) + bottomInset)
      actionBar.setPadding(dp(12), dp(8), dp(12), dp(12) + bottomInset)
      insets
    }

    playNextButton.setOnClickListener {
      val selected = selectedIds.toSet()
      if (selected.isEmpty()) return@setOnClickListener
      adapter.moveIdsToFront(selected)
      clearSelection()
      haptics.confirm(playNextButton)
      launchMutation("Could not move the selected songs") {
        coordinator.moveAfterActive(selected)
      }
    }
    removeButton.setOnClickListener {
      val selected = selectedIds.toSet()
      if (selected.isEmpty()) return@setOnClickListener
      adapter.removeIds(selected)
      clearSelection()
      haptics.confirm(removeButton)
      launchMutation("Could not remove the selected songs") {
        coordinator.remove(selected)
      }
    }

    adapter.onRowClick = { row ->
      if (editMode) {
        toggleSelected(row.entryId)
      } else {
        haptics.selection(this)
        playbackRequestListener?.onPlaybackRequest(row.entryId, latestSnapshot.revision)
      }
    }
    adapter.onSelectionClick = { row -> toggleSelected(row.entryId) }
    adapter.onDragTouch = { holder, event ->
      if (!editMode && event.actionMasked == MotionEvent.ACTION_DOWN) {
        touchHelper.startDrag(holder)
      }
    }
    applyPalette()
  }

  fun attach() {
    if (!active || coordinatorAttached) return
    coordinatorAttached = true
    coordinator.addListener(coordinatorListener)
    coordinator.start()
  }

  fun detach() {
    if (!coordinatorAttached) return
    coordinatorAttached = false
    coordinator.removeListener(coordinatorListener)
  }

  fun showPlaybackResult(success: Boolean, message: String?) {
    if (!success) {
      Snackbar.make(
        this,
        message ?: "Could not play that song",
        Snackbar.LENGTH_SHORT,
      ).show()
      coordinator.refresh()
    }
  }

  private fun render(snapshot: NativeQueueSnapshot) {
    latestSnapshot = snapshot
    val activeIndex = snapshot.activePosition.toInt()
    val current = snapshot.rows.firstOrNull {
      it.position == snapshot.activePosition
    }
    val upcoming = snapshot.rows.filter {
      it.position > snapshot.activePosition
    }

    countView.text = when (val count = maxOf(0, snapshot.totalCount - activeIndex - 1)) {
      0 -> "No songs next"
      1 -> "1 song next"
      else -> "$count songs next"
    }
    nowTitle.text = current?.title ?: "Nothing playing"
    nowArtist.text = current?.artist.orEmpty()
    loadArtwork(nowArtwork, current?.artworkThumbPath)

    val firstVisible = layoutManager.findFirstVisibleItemPosition()
    val anchorId = adapter.rowAt(firstVisible)?.entryId
    val anchorOffset = if (firstVisible >= 0) {
      layoutManager.findViewByPosition(firstVisible)?.top ?: 0
    } else {
      0
    }
    selectedIds.retainAll(upcoming.mapTo(hashSetOf(), QueueRowModel::entryId))
    adapter.submit(upcoming, selectedIds, editMode) {
      val anchorPosition = anchorId?.let { id ->
        upcoming.indexOfFirst { it.entryId == id }.takeIf { it >= 0 }
      }
      if (anchorPosition != null) {
        layoutManager.scrollToPositionWithOffset(anchorPosition, anchorOffset)
      }
    }
    recycler.visibility = if (upcoming.isEmpty()) GONE else VISIBLE
    emptyView.visibility = if (upcoming.isEmpty()) VISIBLE else GONE
    updateActionBar()
  }

  private fun setEditMode(enabled: Boolean) {
    editMode = enabled
    if (!enabled) selectedIds.clear()
    haptics.selection(editButton)
    editButton.text = if (enabled) "Cancel" else "Edit"
    editButton.contentDescription = if (enabled) "Cancel queue editing" else "Edit queue"
    adapter.submit(adapter.rows(), selectedIds, editMode)
    updateActionBar()
  }

  private fun toggleSelected(entryId: Long) {
    if (!selectedIds.add(entryId)) selectedIds.remove(entryId)
    haptics.selection(recycler)
    adapter.updateSelection(selectedIds)
    updateActionBar()
  }

  private fun clearSelection() {
    selectedIds.clear()
    adapter.updateSelection(selectedIds)
    updateActionBar()
  }

  private fun updateActionBar() {
    val count = selectedIds.size
    actionBar.visibility = if (editMode && count > 0) VISIBLE else GONE
    playNextButton.text = "Play next ($count)"
    removeButton.text = "Remove ($count)"
  }

  private fun launchMutation(errorMessage: String, block: suspend () -> Boolean): Job =
    scope.launch {
      val success = runCatching {
        kotlinx.coroutines.withContext(Dispatchers.IO) { block() }
      }.getOrDefault(false)
      if (!success) {
        haptics.reject(this@QueueContentView)
        Snackbar.make(this@QueueContentView, errorMessage, Snackbar.LENGTH_SHORT).show()
        coordinator.refresh()
      }
    }

  private fun applyPalette() {
    background = if (sheetMode) {
      topRounded(palette.background, 16f)
    } else {
      ColorDrawable(palette.background)
    }
    sheetHandle.background = rounded(palette.divider, 999f)
    titleView.setTextColor(palette.text)
    countView.setTextColor(palette.textTertiary)
    editButton.setTextColor(palette.accent)
    playingNowLabel.setTextColor(palette.textTertiary)
    upNextLabel.setTextColor(palette.textTertiary)
    nowTitle.setTextColor(palette.accentTextStrong)
    nowArtist.setTextColor(palette.accentText)
    nowIndicator.imageTintList = ColorStateList.valueOf(palette.accent)
    emptyView.setTextColor(palette.textSecondary)
    playNextButton.setTextColor(palette.accent)
    removeButton.setTextColor(palette.warning)
    nowCard.background = roundedWithBorder(
      palette.nowPlayingSurface,
      palette.divider,
      6f,
    )
    actionBar.setBackgroundColor(palette.elevatedSurface)
    adapter.palette = palette
  }

  private fun label(text: String, sizeSp: Float, font: Typeface): TextView =
    TextView(context).apply {
      this.text = text
      textSize = sizeSp
      maxLines = 1
      ellipsize = android.text.TextUtils.TruncateAt.END
      setTextColor(palette.text)
      typeface = font
      includeFontPadding = false
    }

  private fun rounded(color: Int, radiusDp: Float): GradientDrawable =
    GradientDrawable().apply {
      setColor(color)
      cornerRadius = dp(radiusDp.toInt()).toFloat()
    }

  private fun roundedWithBorder(
    color: Int,
    borderColor: Int,
    radiusDp: Float,
  ): GradientDrawable =
    rounded(color, radiusDp).apply {
      setStroke(max(1, dp(1) / 2), borderColor)
    }

  private fun topRounded(color: Int, radiusDp: Float): GradientDrawable =
    GradientDrawable().apply {
      setColor(color)
      val radius = dp(radiusDp.toInt()).toFloat()
      cornerRadii = floatArrayOf(radius, radius, radius, radius, 0f, 0f, 0f, 0f)
    }

  private fun createDragItemAnimator(): DefaultItemAnimator =
    DefaultItemAnimator().apply {
      // ItemTouchHelper moves the held row itself. This short animation lets
      // the surrounding rows glide into their slots as each boundary is
      // crossed without adding cross-fades to later data reconciliation.
      moveDuration = 140
      addDuration = 0
      removeDuration = 0
      changeDuration = 0
      supportsChangeAnimations = false
    }

  private fun dp(value: Int): Int =
    (value * resources.displayMetrics.density).toInt()

  private fun prepareArtwork(view: ImageView) {
    view.background = rounded(palette.elevatedSurface, 6f)
    view.clipToOutline = true
    view.outlineProvider = ViewOutlineProvider.BACKGROUND
  }

  private fun loadArtwork(view: ImageView, path: String?) {
    if (path != null && File(path).isFile) {
      Glide.with(view).load(File(path)).centerCrop().into(view)
    } else {
      Glide.with(view).clear(view)
      view.setImageDrawable(null)
      view.background = rounded(palette.elevatedSurface, 6f)
    }
  }

  private fun loadTypeface(assetName: String, fallbackStyle: Int): Typeface =
    runCatching { Typeface.createFromAsset(context.assets, assetName) }
      .getOrElse { Typeface.create("sans-serif", fallbackStyle) }

  private fun typefaceFor(
    text: String,
    latinTypeface: Typeface,
    fallbackStyle: Int,
  ): Typeface =
    if (NON_INTER_CHARACTER.containsMatchIn(text)) {
      Typeface.create("sans-serif", fallbackStyle)
    } else {
      latinTypeface
    }

  private fun drawSwipeLane(canvas: Canvas, row: View, dX: Float) {
    if (dX == 0f) return
    val swipingRight = dX > 0
    swipePaint.color = if (swipingRight) palette.accent else palette.warning
    val left = if (swipingRight) row.left.toFloat() else row.right + dX
    val right = if (swipingRight) row.left + dX else row.right.toFloat()
    canvas.drawRect(left, row.top.toFloat(), right, row.bottom.toFloat(), swipePaint)

    swipeIconPaint.apply {
      color = palette.background
      style = Paint.Style.FILL
      strokeWidth = dp(2).toFloat()
      strokeCap = Paint.Cap.ROUND
      strokeJoin = Paint.Join.ROUND
    }
    val centerY = (row.top + row.bottom) / 2f
    if (swipingRight) {
      val centerX = row.left + dp(27).toFloat()
      val half = dp(7).toFloat()
      swipeIconPath.reset()
      swipeIconPath.moveTo(centerX - half, centerY - half)
      swipeIconPath.lineTo(centerX + dp(3), centerY)
      swipeIconPath.lineTo(centerX - half, centerY + half)
      swipeIconPath.close()
      canvas.drawPath(swipeIconPath, swipeIconPaint)
      canvas.drawRect(
        centerX + dp(5),
        centerY - half,
        centerX + dp(7),
        centerY + half,
        swipeIconPaint,
      )
    } else {
      val centerX = row.right - dp(27).toFloat()
      val halfWidth = dp(6).toFloat()
      val top = centerY - dp(6)
      swipeIconPaint.style = Paint.Style.STROKE
      canvas.drawRoundRect(
        centerX - halfWidth,
        top,
        centerX + halfWidth,
        centerY + dp(8),
        dp(1).toFloat(),
        dp(1).toFloat(),
        swipeIconPaint,
      )
      canvas.drawLine(
        centerX - dp(8),
        centerY - dp(9),
        centerX + dp(8),
        centerY - dp(9),
        swipeIconPaint,
      )
      canvas.drawLine(
        centerX - dp(3),
        centerY - dp(11),
        centerX + dp(3),
        centerY - dp(11),
        swipeIconPaint,
      )
      swipeIconPaint.style = Paint.Style.FILL
    }
  }

  private inner class QueueAdapter : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
    private val items = mutableListOf<QueueRowModel>()
    private var selected = emptySet<Long>()
    private var editing = false
    private var submitGeneration = 0L

    var palette: QueuePalette = this@QueueContentView.palette
      set(value) {
        field = value
        notifyItemRangeChanged(0, itemCount)
      }
    var onRowClick: ((QueueRowModel) -> Unit)? = null
    var onSelectionClick: ((QueueRowModel) -> Unit)? = null
    var onDragTouch: ((RecyclerView.ViewHolder, MotionEvent) -> Unit)? = null

    init {
      setHasStableIds(true)
    }

    override fun getItemId(position: Int): Long = items[position].entryId
    override fun getItemCount(): Int = items.size

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder =
      QueueRowHolder(QueueRowView(parent.context))

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
      holder.itemView.translationX = 0f
      holder.itemView.translationY = 0f
      holder.itemView.alpha = 1f
      holder.itemView.scaleX = 1f
      holder.itemView.scaleY = 1f
      (holder as QueueRowHolder).bind(items[position])
    }

    override fun onViewRecycled(holder: RecyclerView.ViewHolder) {
      val rowHolder = holder as QueueRowHolder
      Glide.with(rowHolder.row.artwork).clear(rowHolder.row.artwork)
      super.onViewRecycled(holder)
    }

    fun submit(
      rows: List<QueueRowModel>,
      selectedIds: Set<Long>,
      editMode: Boolean,
      onCommitted: () -> Unit = {},
    ) {
      val structureChanged =
        rows.size != items.size || rows.indices.any { items[it].entryId != rows[it].entryId }
      val selectionChanged = selected != selectedIds
      val editModeChanged = editing != editMode
      selected = selectedIds.toSet()
      editing = editMode
      if (!structureChanged) {
        submitGeneration += 1
        var firstChanged = -1
        var lastChanged = -1
        rows.indices.forEach { index ->
          if (items[index] != rows[index]) {
            items[index] = rows[index]
            if (firstChanged < 0) firstChanged = index
            lastChanged = index
          }
        }
        if (selectionChanged || editModeChanged) {
          notifyItemRangeChanged(0, items.size)
        } else if (firstChanged >= 0) {
          notifyItemRangeChanged(firstChanged, lastChanged - firstChanged + 1)
        }
        onCommitted()
        return
      }

      val previous = items.toList()
      val next = rows.toList()
      val generation = ++submitGeneration
      if (previous.isEmpty() || next.isEmpty()) {
        items.clear()
        items.addAll(next)
        notifyDataSetChanged()
        onCommitted()
        return
      }
      // A shuffle can relocate nearly every stable ID. Dispatching thousands of
      // individual DiffUtil move callbacks makes RecyclerView spend several
      // frames bookkeeping animations even though only the visible holders need
      // to be rebound. Stable IDs let a single invalidation preserve the visible
      // rows while keeping the mutation cost bounded.
      if (
        previous.size == next.size &&
        previous.indices.count {
          previous[it].entryId != next[it].entryId
        } > MAX_ANIMATED_REORDER_ROWS
      ) {
        items.clear()
        items.addAll(next)
        notifyDataSetChanged()
        onCommitted()
        return
      }
      scope.launch(Dispatchers.Default) {
        val diff = DiffUtil.calculateDiff(
          object : DiffUtil.Callback() {
            override fun getOldListSize(): Int = previous.size
            override fun getNewListSize(): Int = next.size
            override fun areItemsTheSame(oldItemPosition: Int, newItemPosition: Int): Boolean =
              previous[oldItemPosition].entryId == next[newItemPosition].entryId

            override fun areContentsTheSame(oldItemPosition: Int, newItemPosition: Int): Boolean =
              previous[oldItemPosition] == next[newItemPosition]
          },
          true,
        )
        kotlinx.coroutines.withContext(Dispatchers.Main.immediate) {
          if (generation != submitGeneration) return@withContext
          items.clear()
          items.addAll(next)
          diff.dispatchUpdatesTo(this@QueueAdapter)
          onCommitted()
        }
      }
    }

    fun updateSelection(selectedIds: Set<Long>) {
      selected = selectedIds.toSet()
      notifyItemRangeChanged(0, itemCount)
    }

    fun rows(): List<QueueRowModel> = items.toList()
    fun rowAt(position: Int): QueueRowModel? = items.getOrNull(position)
    fun positionOf(entryId: Long): Int =
      items.indexOfFirst { it.entryId == entryId }

    fun move(from: Int, to: Int): Boolean {
      if (from !in items.indices || to !in items.indices || from == to) return false
      submitGeneration += 1
      val moved = items.removeAt(from)
      items.add(to, moved)
      notifyItemMoved(from, to)
      return true
    }

    fun moveSwipedToFront(from: Int) {
      if (from !in items.indices) {
        notifyDataSetChanged()
        return
      }
      if (from == 0) {
        notifyItemChanged(0)
        return
      }
      submitGeneration += 1
      val moved = items.removeAt(from)
      items.add(0, moved)
      // ItemTouchHelper has just completed a removal-shaped gesture. A move
      // notification in the same layout cycle makes RecyclerView preserve its
      // swipe pre-layout holders, including the offscreen transform. Stable
      // IDs plus one invalidation rebind only attached/prefetched rows and keep
      // the complete queue data resident without that transient blank state.
      notifyDataSetChanged()
    }

    fun removeAt(position: Int) {
      if (position !in items.indices) return
      submitGeneration += 1
      items.removeAt(position)
      notifyItemRemoved(position)
    }

    fun removeIds(ids: Set<Long>) {
      submitGeneration += 1
      items.removeAll { it.entryId in ids }
      notifyDataSetChanged()
    }

    fun moveIdsToFront(ids: Set<Long>) {
      val selectedRows = items.filter { it.entryId in ids }
      if (selectedRows.isEmpty()) return
      submitGeneration += 1
      items.removeAll { it.entryId in ids }
      items.addAll(0, selectedRows)
      notifyDataSetChanged()
    }

    private inner class QueueRowHolder(
      val row: QueueRowView,
    ) : RecyclerView.ViewHolder(row) {
      fun bind(item: QueueRowModel) {
        row.title.text = item.title
        row.artist.text = item.artist
        row.title.setTextColor(palette.text)
        row.artist.setTextColor(palette.textSecondary)
        row.title.typeface = typefaceFor(item.title, regularTypeface, Typeface.NORMAL)
        row.artist.typeface = typefaceFor(item.artist, mediumTypeface, Typeface.NORMAL)
        row.handle.tint = palette.textTertiary
        row.checkbox.tint = palette.accent
        row.checkbox.uncheckedTint = palette.textTertiary
        row.checkbox.checkColor = palette.background
        row.checkbox.checked = item.entryId in selected
        row.checkbox.visibility = if (editing) VISIBLE else GONE
        row.artwork.visibility = if (editing) GONE else VISIBLE
        row.handle.visibility = if (editing) GONE else VISIBLE
        row.setSurfaceColor(
          if (item.entryId in selected) palette.selectedSurface else palette.surface,
        )
        loadArtwork(row.artwork, item.artworkThumbPath)
        row.setOnClickListener { onRowClick?.invoke(item) }
        row.checkbox.setOnClickListener { onSelectionClick?.invoke(item) }
        row.handle.setOnTouchListener { _, event ->
          onDragTouch?.invoke(this, event)
          false
        }
        row.contentDescription = if (editing) {
          "${if (item.entryId in selected) "Selected" else "Not selected"}, ${item.title}, ${item.artist}"
        } else {
          "Play ${item.title} by ${item.artist}"
        }
      }
    }
  }

  private inner class QueueRowView(context: Context) : FrameLayout(context) {
    val artwork = ImageView(context)
    val title = label("", 15f, regularTypeface)
    val artist = label("", 12f, mediumTypeface)
    val checkbox = QueueSelectionView(context)
    val handle = QueueHandleView(context)
    private var dividerColor = palette.divider

    init {
      isClickable = true
      isFocusable = true
      layoutParams = RecyclerView.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        dp(64),
      )
      setPadding(dp(12), dp(7), dp(10), dp(7))

      artwork.scaleType = ImageView.ScaleType.CENTER_CROP
      prepareArtwork(artwork)
      addView(
        artwork,
        LayoutParams(dp(42), dp(42), Gravity.CENTER_VERTICAL).apply {
          marginStart = dp(2)
        },
      )
      addView(
        checkbox,
        LayoutParams(dp(34), LayoutParams.MATCH_PARENT, Gravity.START or Gravity.CENTER_VERTICAL),
      )
      val textColumn = LinearLayout(context).apply {
        orientation = VERTICAL
        gravity = Gravity.CENTER_VERTICAL
        addView(title)
        addView(artist)
      }
      addView(
        textColumn,
        LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT).apply {
          marginStart = dp(62)
          marginEnd = dp(42)
        },
      )
      handle.contentDescription = "Reorder"
      addView(
        handle,
        LayoutParams(dp(42), LayoutParams.MATCH_PARENT, Gravity.END or Gravity.CENTER_VERTICAL),
      )
    }

    fun setSurfaceColor(color: Int) {
      dividerColor = palette.divider
      background = RippleDrawable(
        ColorStateList.valueOf(palette.ripple),
        ColorDrawable(color),
        null,
      )
    }

    override fun dispatchDraw(canvas: Canvas) {
      super.dispatchDraw(canvas)
      swipePaint.color = dividerColor
      canvas.drawRect(
        paddingLeft.toFloat(),
        (height - max(1, dp(1) / 2)).toFloat(),
        width.toFloat(),
        height.toFloat(),
        swipePaint,
      )
    }
  }

  private inner class QueueHandleView(context: Context) : View(context) {
    var tint: Int = palette.textTertiary
      set(value) {
        field = value
        invalidate()
      }

    override fun onDraw(canvas: Canvas) {
      super.onDraw(canvas)
      swipeIconPaint.apply {
        color = tint
        strokeWidth = dp(2).toFloat()
        strokeCap = Paint.Cap.ROUND
      }
      val center = width / 2f
      val half = dp(8).toFloat()
      for (offset in intArrayOf(-5, 0, 5)) {
        val y = height / 2f + dp(offset).toFloat()
        canvas.drawLine(center - half, y, center + half, y, swipeIconPaint)
      }
    }
  }

  private inner class QueueSelectionView(context: Context) : View(context) {
    var checked: Boolean = false
      set(value) {
        field = value
        invalidate()
      }
    var tint: Int = palette.accent
      set(value) {
        field = value
        invalidate()
      }
    var uncheckedTint: Int = palette.textTertiary
      set(value) {
        field = value
        invalidate()
      }
    var checkColor: Int = palette.background
      set(value) {
        field = value
        invalidate()
      }

    override fun onDraw(canvas: Canvas) {
      super.onDraw(canvas)
      val radius = dp(9).toFloat()
      val centerX = width / 2f
      val centerY = height / 2f
      swipeIconPaint.style = if (checked) Paint.Style.FILL else Paint.Style.STROKE
      swipeIconPaint.strokeWidth = dp(1).coerceAtLeast(1).toFloat()
      swipeIconPaint.color = if (checked) tint else uncheckedTint
      canvas.drawCircle(centerX, centerY, radius, swipeIconPaint)
      if (!checked) return
      swipeIconPaint.apply {
        style = Paint.Style.STROKE
        strokeWidth = dp(2).toFloat()
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        color = checkColor
      }
      swipeIconPath.reset()
      swipeIconPath.moveTo(centerX - dp(4), centerY)
      swipeIconPath.lineTo(centerX - dp(1), centerY + dp(3))
      swipeIconPath.lineTo(centerX + dp(5), centerY - dp(4))
      canvas.drawPath(swipeIconPath, swipeIconPaint)
      swipeIconPaint.style = Paint.Style.FILL
    }
  }
}
