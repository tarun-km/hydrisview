package ai.hydris.glassesbridge

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.os.Bundle
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import com.meta.wearable.dat.camera.addCamera
import com.meta.wearable.dat.camera.types.PhotoData
import com.meta.wearable.dat.camera.types.StreamConfiguration
import com.meta.wearable.dat.camera.types.VideoQuality
import com.meta.wearable.dat.core.Wearables
import com.meta.wearable.dat.core.selectors.AutoDeviceSelector
import com.meta.wearable.dat.core.session.DeviceSessionState
import com.meta.wearable.dat.core.types.Permission
import com.meta.wearable.dat.core.types.RegistrationState
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * Hydris glasses bridge.
 *
 * Hosts the Hydris glasses web app (/glasses) in a WebView and bridges the Ray-Ban Meta camera
 * into it with Meta's Wearables Device Access Toolkit (DAT):
 *   - registers with the Meta AI app and requests the glasses CAMERA permission;
 *   - opens a device session, adds the camera and streams frames to the page
 *     (window.__hydrisCameraFrame) for live A4 detection;
 *   - on capture, calls camera.stream.capturePhoto() and returns the still
 *     (window.__hydrisCameraPhoto).
 * The page side of this contract lives in apps/web/src/glasses/camera.ts.
 */
class MainActivity : ComponentActivity() {
  private lateinit var web: WebView
  private var camera: Any? = null // DAT camera handle (typed via addCamera's result)
  private var previewJob: Job? = null
  private var previewOn = false
  private var lastFrameAt = 0L

  private val permissionLauncher = registerForActivityResult(Wearables.RequestPermissionContract()) { result ->
    js("console.log('Hydris bridge: camera permission ' + ${quote(result.toString())})")
  }

  @SuppressLint("SetJavaScriptEnabled")
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    Wearables.initialize(this).onFailure { error, _ -> toastJs("Wearables init failed: $error") }

    web = WebView(this)
    web.settings.javaScriptEnabled = true
    web.settings.domStorageEnabled = true
    web.settings.mediaPlaybackRequiresUserGesture = false
    // Phone-camera fallback inside the web app still works (getUserMedia).
    web.webChromeClient = object : WebChromeClient() {
      override fun onPermissionRequest(request: PermissionRequest) = request.grant(request.resources)
    }
    web.addJavascriptInterface(Bridge(), "HydrisNative")
    setContentView(web)
    web.loadUrl(BuildConfig.HYDRIS_URL + "/glasses")

    lifecycleScope.launch {
      Wearables.registrationState.collect { state ->
        if (state == RegistrationState.REGISTERED) permissionLauncher.launch(Permission.CAMERA)
      }
    }
    Wearables.startRegistration(this)
  }

  /** Open a session and start the glasses camera stream (idempotent). */
  private fun ensureCamera(onReady: () -> Unit) {
    if (camera != null) return onReady()
    Wearables.createSession(AutoDeviceSelector()).fold(
      { session ->
        lifecycleScope.launch {
          session.state.collect { state ->
            if (state == DeviceSessionState.STARTED && camera == null) {
              session.addCamera(StreamConfiguration(videoQuality = VideoQuality.MEDIUM, frameRate = 24)).fold(
                { cam ->
                  camera = cam
                  cam.stream.start().onFailure { error, _ -> toastJs("Camera stream failed: $error") }
                  onReady()
                },
                { error -> toastJs("Camera unavailable: $error") },
              )
            }
          }
        }
        session.start()
      },
      { error -> toastJs("No glasses session: $error") },
    )
  }

  private fun startFrames() {
    val cam = camera as? com.meta.wearable.dat.camera.Camera ?: return
    previewJob?.cancel()
    previewJob = lifecycleScope.launch {
      cam.stream.videoStream.collect { frame ->
        if (!previewOn) return@collect
        val now = System.currentTimeMillis()
        if (now - lastFrameAt < 120) return@collect // ~8 fps is enough for page detection
        lastFrameAt = now
        // DAT decodes on the phone; VideoFrame.buffer holds YUV pixel data.
        val jpeg = yuvToJpeg(frame.buffer, frame.width, frame.height, 70) ?: return@collect
        js("window.__hydrisCameraFrame && window.__hydrisCameraFrame('${b64(jpeg)}', ${frame.width}, ${frame.height})")
      }
    }
  }

  private fun capture(requestId: String) {
    val cam = camera as? com.meta.wearable.dat.camera.Camera ?: return js("window.__hydrisCameraError('$requestId', 'Glasses camera not ready')")
    lifecycleScope.launch {
      cam.stream.capturePhoto().fold(
        { photo ->
          val bytes = when (photo) {
            is PhotoData.Bitmap -> ByteArrayOutputStream().also { photo.bitmap.compress(Bitmap.CompressFormat.JPEG, 92, it) }.toByteArray()
            is PhotoData.HEIC -> heicToJpeg(photo.data)
          }
          js("window.__hydrisCameraPhoto('$requestId', '${b64(bytes)}')")
        },
        { error -> js("window.__hydrisCameraError('$requestId', ${quote(error.toString())})") },
      )
    }
  }

  inner class Bridge {
    @JavascriptInterface fun startPreview() = runOnUiThread { previewOn = true; ensureCamera { startFrames() } }
    @JavascriptInterface fun stopPreview() { previewOn = false }
    @JavascriptInterface fun capturePhoto(requestId: String) = runOnUiThread { ensureCamera { capture(requestId) } }
    @JavascriptInterface fun deviceName(): String = "Ray-Ban Meta"
  }

  // ---- helpers
  private fun js(code: String) = runOnUiThread { web.evaluateJavascript(code, null) }
  private fun toastJs(msg: String) = js("console.warn(${quote(msg)})")
  private fun quote(s: String) = "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"
  private fun b64(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.NO_WRAP)

  /** I420/NV21 → JPEG via YuvImage (converts planar I420 to NV21 first). */
  private fun yuvToJpeg(buffer: java.nio.ByteBuffer, w: Int, h: Int, quality: Int): ByteArray? = try {
    val src = ByteArray(buffer.remaining()).also { buffer.duplicate().get(it) }
    val ySize = w * h
    val nv21 = if (src.size >= ySize * 3 / 2) {
      val out = ByteArray(ySize * 3 / 2)
      System.arraycopy(src, 0, out, 0, ySize)
      val q = ySize / 4
      for (i in 0 until q) { out[ySize + 2 * i] = src[ySize + q + i]; out[ySize + 2 * i + 1] = src[ySize + i] }
      out
    } else src
    ByteArrayOutputStream().also { YuvImage(nv21, ImageFormat.NV21, w, h, null).compressToJpeg(Rect(0, 0, w, h), quality, it) }.toByteArray()
  } catch (e: Exception) { null }

  private fun heicToJpeg(data: ByteArray): ByteArray {
    val bmp = android.graphics.BitmapFactory.decodeByteArray(data, 0, data.size)
    return ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.JPEG, 92, it) }.toByteArray()
  }
}
