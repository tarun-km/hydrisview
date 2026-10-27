package ai.hydris.field.glasses

import ai.hydris.field.scan.Guide
import ai.hydris.field.scan.Pt
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.util.Log
import com.meta.wearable.dat.core.session.DeviceSession
import com.meta.wearable.dat.display.Display
import com.meta.wearable.dat.display.addDisplay
import com.meta.wearable.dat.display.types.DisplayConfiguration
import com.meta.wearable.dat.display.types.DisplayState
import com.meta.wearable.dat.display.views.Alignment
import com.meta.wearable.dat.display.views.CornerRadius
import com.meta.wearable.dat.display.views.Direction
import com.meta.wearable.dat.display.views.IconName
import com.meta.wearable.dat.display.views.IconStyle
import com.meta.wearable.dat.display.views.ImageSize
import com.meta.wearable.dat.display.views.TextColor
import com.meta.wearable.dat.display.views.TextStyle
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Output to the Meta Ray-Ban Display's own screen (DAT `mwdat-display`).
 *
 * The capability is added to the existing glasses session; on glasses without a display (Ray-Ban Meta)
 * adding it fails once and every call here becomes a no-op. Each `sendContent` replaces the whole view and
 * travels over Bluetooth, so updates are conflated: guidance changes go out immediately, the camera preview
 * image at most [IMAGE_INTERVAL_MS]. Video is not used - DAT 1.0 plays MP4 from https URLs only, not
 * pushed frames - so the preview is a small phone-composited bitmap (luma frame + page outline + progress).
 */
class GlassesDisplay(private val scope: CoroutineScope, private val log: (String) -> Unit) {
  companion object {
    private const val TAG = "HydrisDisplay"
    private const val IMAGE_INTERVAL_MS = 200L // ~5 fps
    private const val PREVIEW_PX = 600 // full lens resolution (600x600)
  }

  private sealed interface View {
    data class Scan(val guide: Guide, val preview: Bitmap?, val progress: Float) : View
    data class Status(val title: String, val subtitle: String?, val icon: IconName?) : View
    data object Blank : View
  }

  private val _state = MutableStateFlow("none")
  /** Display capability state for the Glasses screen ("none" / "unsupported" / DisplayState). */
  val state: StateFlow<String> = _state.asStateFlow()

  private var display: Display? = null
  private var unsupported = false
  private var pump: Job? = null
  private val wanted = MutableStateFlow<View?>(null)

  /** Adds the display to a started session (once). Unsupported devices are remembered and skipped. */
  fun attach(session: DeviceSession) {
    if (display != null || unsupported) return
    session.addDisplay(DisplayConfiguration())
      .onSuccess { d ->
        display = d
        Log.i(TAG, "Display capability added")
        scope.launch { d.state.collect { st -> Log.i(TAG, "DisplayState $st"); _state.value = st.toString() } }
        pump = scope.launch { pumpContent(d) }
        if (wanted.value == null) showStatus("Hydris", "Ready to scan · press capture", IconName.FOUR_CORNER_FRAME)
      }
      .onFailure { e, _ ->
        unsupported = true
        _state.value = "unsupported"
        Log.i(TAG, "No display on these glasses: ${e.description}")
        log("Glasses display not available (${e.description})")
      }
  }

  /** Session ended: the capability is gone with it; a new session attaches again. */
  fun detach() {
    pump?.cancel(); pump = null
    display = null
    _state.value = "none"
  }

  val available: Boolean get() = display != null

  // ------------------------------------------------------------------ public API
  /** Live scan view: [quadPreview] is a frame already composited with [renderPreview] (or null for text only). */
  fun showScan(guide: Guide, quadPreview: Bitmap?, progress: Float) { if (!unsupported) wanted.value = View.Scan(guide, quadPreview, progress) }

  fun showStatus(title: String, subtitle: String? = null, icon: IconName? = null) { if (!unsupported) wanted.value = View.Status(title, subtitle, icon) }

  fun clear() { if (!unsupported) wanted.value = View.Blank }

  /** Idle card shown between scans. */
  fun showIdle() = showStatus("Hydris", "Ready to scan · press capture", IconName.FOUR_CORNER_FRAME)

  // ------------------------------------------------------------------ sending
  private suspend fun pumpContent(d: Display) {
    var lastSent: View? = null
    var lastImageAt = 0L
    // StateFlow is conflated: while a send is in flight only the newest view is kept.
    wanted.filter { it != null }.collect { v ->
      v!!
      if (d.state.value != DisplayState.STARTED) {
        withTimeoutOrNull(10_000) { d.state.first { it == DisplayState.STARTED } } ?: return@collect
      }
      if (v is View.Scan && lastSent is View.Scan) {
        val prev = lastSent as View.Scan
        val textSame = prev.guide == v.guide && bucket(prev.progress) == bucket(v.progress)
        val wait = IMAGE_INTERVAL_MS - (System.currentTimeMillis() - lastImageAt)
        if (textSame && wait > 0) delay(wait)
      }
      val now = System.currentTimeMillis()
      val res = when (v) {
        is View.Scan -> d.sendContent {
          flexBox(direction = Direction.COLUMN, gap = 8, crossAlignment = Alignment.CENTER, paddingTop = 12, paddingBottom = 12, paddingStart = 12, paddingEnd = 12) {
            v.preview?.let { image(bitmap = it, sizePreset = ImageSize.FILL, cornerRadius = CornerRadius.MEDIUM) }
            flexBox(direction = Direction.ROW, gap = 8, crossAlignment = Alignment.CENTER) {
              icon(name = if (v.guide.ok) IconName.CHECKMARK_CIRCLE else IconName.FOUR_CORNER_FRAME, style = IconStyle.FILLED)
              text(v.guide.message, style = TextStyle.BODY)
            }
            text(progressLabel(v.guide, v.progress), style = TextStyle.META, color = TextColor.SECONDARY)
          }
        }
        is View.Status -> d.sendContent {
          flexBox(direction = Direction.COLUMN, gap = 10, crossAlignment = Alignment.CENTER, paddingTop = 16, paddingBottom = 16, paddingStart = 16, paddingEnd = 16) {
            v.icon?.let { icon(name = it, style = IconStyle.FILLED) }
            text(v.title, style = TextStyle.HEADING)
            v.subtitle?.let { text(it, style = TextStyle.BODY, color = TextColor.SECONDARY) }
          }
        }
        View.Blank -> d.clearDisplay()
      }
      res.onSuccess { if (v !is View.Scan || lastSent !is View.Scan) Log.i(TAG, "Sent ${describe(v)}") }
        .onFailure { e, _ -> Log.w(TAG, "Send failed (${describe(v)}): $e") }
      lastSent = v
      if (v is View.Scan) lastImageAt = now
    }
  }

  private fun bucket(p: Float) = (p * 5).toInt()
  private fun progressLabel(g: Guide, p: Float): String = when {
    g.ok -> "Ready " + "■".repeat(1 + bucket(p).coerceAtMost(4)) + "□".repeat(4 - bucket(p).coerceAtMost(4))
    g == Guide.NoDocument -> "Looking for the page"
    else -> "Adjusting"
  }
  private fun describe(v: View) = when (v) {
    is View.Scan -> "scan '${v.guide.name}'"
    is View.Status -> "status '${v.title}'"
    View.Blank -> "clear"
  }

  // ------------------------------------------------------------------ preview compositing
  /** Full-resolution (600 px) colour copy of the camera frame with the detected page outline and ready bar drawn on it. */
  fun renderPreview(frame: Bitmap, quad: List<Pt>?, guide: Guide, progress: Float): Bitmap {
    val s = PREVIEW_PX.toFloat() / maxOf(frame.width, frame.height)
    val w = (frame.width * s).toInt().coerceAtLeast(1); val h = (frame.height * s).toInt().coerceAtLeast(1)
    val out = Bitmap.createScaledBitmap(frame, w, h, true).copy(Bitmap.Config.ARGB_8888, true)
    val c = Canvas(out)
    quad?.let { q ->
      val col = when {
        guide.ok -> Color.rgb(64, 220, 120)
        guide == Guide.MoveBack || guide == Guide.Straighten || guide == Guide.Level -> Color.rgb(255, 170, 40)
        else -> Color.rgb(80, 170, 255)
      }
      val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = col; style = Paint.Style.STROKE; strokeWidth = 6f; strokeJoin = Paint.Join.ROUND }
      val path = Path().apply { q.forEachIndexed { i, pt -> if (i == 0) moveTo(pt.x * w, pt.y * h) else lineTo(pt.x * w, pt.y * h) }; close() }
      c.drawPath(path, p)
      val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = col }
      q.forEach { pt -> c.drawCircle(pt.x * w, pt.y * h, 10f, dot) }
    }
    if (progress > 0f) {
      val bg = Paint().apply { color = Color.argb(140, 0, 0, 0) }
      val fg = Paint().apply { color = Color.rgb(64, 220, 120) }
      val r = RectF(w * 0.15f, h - 16f, w * 0.85f, h - 8f)
      c.drawRect(r, bg)
      c.drawRect(r.left, r.top, r.left + r.width() * progress.coerceIn(0f, 1f), r.bottom, fg)
    }
    return out
  }
}
