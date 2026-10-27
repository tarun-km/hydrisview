package ai.hydris.field.data

import android.graphics.Bitmap
import android.util.Base64
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlin.coroutines.coroutineContext

/** Body of POST /device/live (latest-snapshot live view for the control room). */
@Serializable
data class LiveSnapshot(
  val screen: String,
  val title: String,
  val summary: List<String> = emptyList(),
  val camera: String? = null,
  val cameraActive: Boolean = false,
)

/**
 * Live view over the device-token channel: while the glasses are registered as a Hydris device, send
 * the current tab every few seconds and, while the scan camera is framing, the latest glasses camera
 * frame (downscaled JPEG, at most ~1 fps). No screen image is sent from the native app. Failures back
 * off silently; nothing here can affect the UI.
 */
class LiveShare(private val api: HydrisApi) {
  /** [enabled] is the "Share live view with the control room" preference; while off nothing is sent. */
  suspend fun run(route: () -> String?, frames: StateFlow<Bitmap?>, enabled: () -> Boolean = { true }) {
    var failures = 0
    while (coroutineContext.isActive) {
      if (!api.hasDevice() || !enabled()) { delay(2_000); continue }
      val frame = frames.value
      val tab = route()?.substringBefore('/') ?: "home"
      val body = LiveSnapshot(screen = tab, title = TITLES[tab] ?: tab.replaceFirstChar { it.uppercase() }, summary = listOf("Hydris Android app · ${TITLES[tab] ?: tab}"),
        camera = frame?.let { runCatching { jpegDataUrl(it) }.getOrNull() }, cameraActive = frame != null)
      failures = try {
        api.deviceCall("/device/live", "POST", api.json.encodeToString(LiveSnapshot.serializer(), body), kotlinx.serialization.json.JsonElement.serializer())
        0
      } catch (e: kotlinx.coroutines.CancellationException) {
        throw e
      } catch (_: Exception) {
        failures + 1
      }
      delay(if (failures > 0) minOf(60_000L, 2_500L shl minOf(failures, 5)) else if (frame != null) 1_100L else 2_500L)
    }
  }

  private suspend fun jpegDataUrl(src: Bitmap): String? = withContext(Dispatchers.Default) {
    val w = minOf(480, src.width)
    val h = (src.height * (w.toFloat() / src.width)).toInt().coerceAtLeast(1)
    val scaled = if (w == src.width) src else Bitmap.createScaledBitmap(src, w, h, true)
    for (q in intArrayOf(60, 40)) {
      val out = ByteArrayOutputStream()
      scaled.compress(Bitmap.CompressFormat.JPEG, q, out)
      if (out.size() <= MAX_BYTES) return@withContext "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }
    null
  }

  private companion object {
    const val MAX_BYTES = 115 * 1024
    val TITLES = mapOf("home" to "Home", "work" to "Work", "scan" to "Scan", "ask" to "Ask Hydris", "glasses" to "Glasses", "alarm" to "Alarm", "sensor" to "Sensor")
  }
}
