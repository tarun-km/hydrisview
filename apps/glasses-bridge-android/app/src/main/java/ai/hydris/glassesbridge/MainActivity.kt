package ai.hydris.glassesbridge

import android.Manifest.permission.BLUETOOTH
import android.Manifest.permission.BLUETOOTH_CONNECT
import android.Manifest.permission.INTERNET
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts.RequestMultiplePermissions
import androidx.lifecycle.lifecycleScope
import com.meta.wearable.dat.camera.Camera
import com.meta.wearable.dat.camera.addCamera
import com.meta.wearable.dat.camera.types.StreamConfiguration
import com.meta.wearable.dat.camera.types.StreamState
import com.meta.wearable.dat.camera.types.VideoQuality
import com.meta.wearable.dat.core.Wearables
import com.meta.wearable.dat.core.selectors.AutoDeviceSelector
import com.meta.wearable.dat.core.session.DeviceSession
import com.meta.wearable.dat.core.session.DeviceSessionState
import com.meta.wearable.dat.core.types.Permission
import com.meta.wearable.dat.core.types.PermissionStatus
import com.meta.wearable.dat.core.types.RegistrationState
import com.meta.wearable.dat.core.voiceinvocations.isVoiceInvocationsIntent
import com.meta.wearable.dat.inputs.Inputs
import com.meta.wearable.dat.inputs.addInputs
import com.meta.wearable.dat.inputs.types.CapturePressType
import com.meta.wearable.dat.inputs.types.InputEvent
import com.meta.wearable.dat.inputs.types.InputSource
import com.meta.wearable.dat.inputs.types.InputsConfiguration
import com.meta.wearable.dat.speech.Speech
import com.meta.wearable.dat.speech.addSpeech
import com.meta.wearable.dat.speech.types.SpeechState
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Hydris glasses bridge: hosts the Hydris glasses web app and connects it to Ray-Ban Meta glasses
 * through Meta's Wearables Device Access Toolkit (DAT 1.0.x).
 *
 * Page contract (apps/web/src/glasses/camera.ts and voice.ts):
 *   HydrisNative.startPreview()/stopPreview()/capturePhoto(id)/deviceName()
 *   HydrisNative.startSpeech()/stopSpeech()/speak(text)/connectGlasses()/status()
 *   → window.__hydrisCameraFrame(jpegB64, w, h), __hydrisCameraPhoto(id, jpegB64), __hydrisCameraError(id, msg)
 *   → window.__hydrisSpeech(text, isFinal), __hydrisSpeechState(state, detail), __hydrisSpoken()
 *   → window dispatches 'hydris:glasses-capture-button' on a short press of the glasses capture button.
 */
class MainActivity : ComponentActivity() {
  companion object {
    private const val TAG = "HydrisBridge"
    private val ANDROID_PERMISSIONS = arrayOf(BLUETOOTH, BLUETOOTH_CONNECT, INTERNET)
    private const val PREVIEW_INTERVAL_MS = 120L // ~8 fps is enough for page detection
  }

  private lateinit var web: WebView
  private var tts: TextToSpeech? = null
  private var initialized = false

  // ---- DAT state
  private var session: DeviceSession? = null
  private var sessionReady: CompletableDeferred<DeviceSession>? = null
  private var camera: Camera? = null
  private var speech: Speech? = null
  private var inputs: Inputs? = null
  private val previewOn = AtomicBoolean(false)
  private val speechWanted = AtomicBoolean(false)
  private var lastFrameAt = 0L
  private var frameJob: Job? = null
  private val cameraMutex = Mutex()

  // ---- permissions
  private val androidPermissions = registerForActivityResult(RequestMultiplePermissions()) { result ->
    if (result.values.all { it }) initWearables() else emitStatus("Bluetooth permission is required to reach the glasses")
  }
  // WebView getUserMedia: the page's request can only be granted once the app itself holds the
  // Android runtime permission; otherwise Chromium reports NotReadableError / NotAllowedError.
  private var pendingWebPermission: PermissionRequest? = null
  private val webMediaPermissions = registerForActivityResult(RequestMultiplePermissions()) { result ->
    val req = pendingWebPermission ?: return@registerForActivityResult
    pendingWebPermission = null
    val allowed = req.resources.filter { r -> androidPermissionFor(r)?.let { result[it] ?: hasPermission(it) } ?: false }
    if (allowed.isEmpty()) req.deny() else req.grant(allowed.toTypedArray())
  }

  private fun hasPermission(p: String) = checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED
  private fun androidPermissionFor(resource: String): String? = when (resource) {
    PermissionRequest.RESOURCE_VIDEO_CAPTURE -> android.Manifest.permission.CAMERA
    PermissionRequest.RESOURCE_AUDIO_CAPTURE -> android.Manifest.permission.RECORD_AUDIO
    else -> null
  }

  /** Grant what the app already holds; ask Android for the rest, then grant / deny the page request. */
  private fun handleWebPermission(request: PermissionRequest) {
    val media = request.resources.filter { androidPermissionFor(it) != null }
    if (media.isEmpty()) { request.deny(); return }
    val missing = media.mapNotNull { androidPermissionFor(it) }.filterNot { hasPermission(it) }
    if (missing.isEmpty()) { request.grant(media.toTypedArray()); return }
    pendingWebPermission?.deny()
    pendingWebPermission = request
    webMediaPermissions.launch(missing.distinct().toTypedArray())
  }

  private var datPermissionContinuation: CancellableContinuation<PermissionStatus>? = null
  private val datPermissionLauncher = registerForActivityResult(Wearables.RequestPermissionContract()) { result ->
    datPermissionContinuation?.resume(result.getOrDefault(PermissionStatus.Denied))
    datPermissionContinuation = null
  }
  private val permissionMutex = Mutex()

  /** Check, and if needed request (opens the Meta AI app), a glasses permission. */
  private suspend fun ensureDatPermission(p: Permission): Boolean {
    var granted = false
    Wearables.checkPermissionStatus(p).onSuccess { granted = it == PermissionStatus.Granted }
    if (granted) return true
    val status = permissionMutex.withLock {
      suspendCancellableCoroutine { cont ->
        datPermissionContinuation = cont
        cont.invokeOnCancellation { datPermissionContinuation = null }
        datPermissionLauncher.launch(p)
      }
    }
    return status == PermissionStatus.Granted
  }

  @SuppressLint("SetJavaScriptEnabled")
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    web = WebView(this)
    web.settings.javaScriptEnabled = true
    web.settings.domStorageEnabled = true
    web.settings.mediaPlaybackRequiresUserGesture = false
    web.webViewClient = WebViewClient()
    web.webChromeClient = object : WebChromeClient() {
      // The page's phone-camera fallback (getUserMedia) still works inside the bridge.
      override fun onPermissionRequest(request: PermissionRequest) = runOnUiThread { handleWebPermission(request) }
      override fun onPermissionRequestCanceled(request: PermissionRequest) { if (pendingWebPermission == request) pendingWebPermission = null }
    }
    web.addJavascriptInterface(Bridge(), "HydrisNative")
    setContentView(web)
    web.loadUrl(BuildConfig.HYDRIS_URL + "/glasses")

    tts = TextToSpeech(this) { status -> if (status == TextToSpeech.SUCCESS) tts?.language = Locale.getDefault() }
    tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(utteranceId: String?) = Unit
      override fun onDone(utteranceId: String?) = js("window.__hydrisSpoken && window.__hydrisSpoken()")
      @Deprecated("Deprecated in Java") override fun onError(utteranceId: String?) = js("window.__hydrisSpoken && window.__hydrisSpoken()")
    })
    handleVoiceInvocation(intent)
  }

  override fun onStart() {
    super.onStart()
    androidPermissions.launch(ANDROID_PERMISSIONS)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleVoiceInvocation(intent)
  }

  /** "Hey Meta, start Hydris" → open the assistant. */
  private fun handleVoiceInvocation(intent: Intent) {
    if (isVoiceInvocationsIntent(intent)) js("window.dispatchEvent(new CustomEvent('hydris:voice-activate', { detail: {} }))")
  }

  private fun initWearables() {
    if (initialized) return
    Wearables.initialize(this)
    initialized = true
    lifecycleScope.launch {
      Wearables.registrationState.collect { state -> emitStatus("registration: $state") }
    }
  }

  /** One device session for camera, speech and inputs; started lazily, reused. */
  private suspend fun ensureSession(): DeviceSession? {
    session?.let { s -> if (s.state.value == DeviceSessionState.STARTED) return s }
    if (Wearables.registrationState.value != RegistrationState.REGISTERED) {
      Wearables.startRegistration(this)
      emitStatus("Connect Hydris in the Meta AI app, then try again")
      return null
    }
    val ready = sessionReady ?: CompletableDeferred<DeviceSession>().also { deferred ->
      sessionReady = deferred
      Wearables.createSession(AutoDeviceSelector())
          .onSuccess { created ->
            session = created
            lifecycleScope.launch {
              created.state.collect { state ->
                if (state == DeviceSessionState.STARTED) { if (!deferred.isCompleted) deferred.complete(created); attachInputs(created) }
                if (state == DeviceSessionState.STOPPED) resetSession()
              }
            }
            lifecycleScope.launch { created.errors.collect { error -> emitStatus("session: ${error.description}") } }
            created.start()
          }
          .onFailure { error, _ ->
            emitStatus("No glasses session: ${error.description}")
            deferred.completeExceptionally(IllegalStateException(error.description))
            sessionReady = null
          }
    }
    return runCatching { ready.await() }.getOrNull()
  }

  private fun resetSession() {
    frameJob?.cancel()
    camera = null
    speech = null
    inputs = null
    session = null
    sessionReady = null
  }

  // ------------------------------------------------------------------ camera
  private suspend fun ensureCamera(): Camera? = cameraMutex.withLock {
    camera?.let { c -> if (c.stream.state.value != StreamState.STOPPED && c.stream.state.value != StreamState.CLOSED) return c }
    val s = ensureSession() ?: return null
    if (!ensureDatPermission(Permission.CAMERA)) { emitStatus("Camera permission denied in Meta AI"); return null }
    var added: Camera? = null
    // Raw (decoded) frames: VideoFrame.buffer holds YUV pixels; photos come from capturePhoto().
    s.addCamera(StreamConfiguration(videoQuality = VideoQuality.MEDIUM, frameRate = 24))
        .onSuccess { c -> added = c }
        .onFailure { error, _ -> emitStatus("Camera unavailable: ${error.description}") }
    val c = added ?: return null
    camera = c
    lifecycleScope.launch { c.stream.errorStream.collect { error -> emitStatus("stream: ${error.description}") } }
    frameJob = lifecycleScope.launch(Dispatchers.Default) {
      c.stream.videoStream.collect { frame ->
        if (!previewOn.get() || frame.isCompressed) return@collect
        val now = System.currentTimeMillis()
        if (now - lastFrameAt < PREVIEW_INTERVAL_MS) return@collect
        lastFrameAt = now
        val jpeg = FrameCodec.lumaToJpeg(frame.buffer, frame.width, frame.height) ?: return@collect
        js("window.__hydrisCameraFrame && window.__hydrisCameraFrame('${FrameCodec.b64(jpeg)}', ${frame.width}, ${frame.height})")
      }
    }
    c.stream.start().onFailure { error, _ -> emitStatus("Stream failed: ${error.description}") }
    // Wait until the stream is live (capturePhoto only works on an active stream).
    c.stream.state.first { it == StreamState.STREAMING || it == StreamState.STOPPED || it == StreamState.CLOSED }
    c
  }

  private fun capture(requestId: String) = lifecycleScope.launch {
    val c = ensureCamera()
    if (c == null) { js("window.__hydrisCameraError('$requestId', 'Glasses camera not available')"); return@launch }
    c.stream.capturePhoto()
        .onSuccess { photo ->
          val jpeg = withContext(Dispatchers.Default) { FrameCodec.photoToJpeg(photo) }
          if (jpeg == null) js("window.__hydrisCameraError('$requestId', 'Could not decode the photo')")
          else js("window.__hydrisCameraPhoto('$requestId', '${FrameCodec.b64(jpeg)}')")
        }
        .onFailure { error, _ -> js("window.__hydrisCameraError('$requestId', ${JSONObject.quote(error.description)})") }
  }

  // ------------------------------------------------------------------ capture button
  private fun attachInputs(s: DeviceSession) {
    if (inputs != null) return
    s.addInputs(InputsConfiguration(sources = setOf(InputSource.CAPTURE_BUTTON), consumeBack = false))
        .onSuccess { i ->
          inputs = i
          lifecycleScope.launch {
            i.events.collect { event ->
              if (event is InputEvent.Capture && event.pressType == CapturePressType.SHORT_PRESS) {
                js("window.dispatchEvent(new CustomEvent('hydris:glasses-capture-button'))")
              }
            }
          }
        }
        .onFailure { error, _ -> Log.w(TAG, "inputs unavailable: ${error.description}") }
  }

  // ------------------------------------------------------------------ speech (glasses microphone)
  private fun startSpeech() = lifecycleScope.launch {
    speechWanted.set(true)
    speech?.let { it.start(); return@launch }
    val s = ensureSession() ?: return@launch speechState("error", "Glasses not connected")
    if (!ensureDatPermission(Permission.MICROPHONE)) return@launch speechState("error", "Microphone permission denied in Meta AI")
    s.addSpeech()
        .onSuccess { sp ->
          speech = sp
          var started = false
          lifecycleScope.launch {
            sp.transcriptions.collect { r ->
              r ?: return@collect
              js("window.__hydrisSpeech && window.__hydrisSpeech(${JSONObject.quote(r.text)}, ${r.isFinal})")
            }
          }
          lifecycleScope.launch {
            sp.state.collect { st ->
              when (st) {
                SpeechState.STARTED -> { started = true; speechState("listening", null) }
                // Recognition ends after silence; keep "Hey Hydris" always on while wanted.
                SpeechState.STOPPED -> if (started && speechWanted.get()) sp.start() else speechState("idle", null)
                else -> Unit
              }
            }
          }
          lifecycleScope.launch { sp.errors.collect { e -> if (e != null) speechState("error", e.description) } }
          sp.start().onFailure { error, _ -> speechState("error", error.description) }
        }
        .onFailure { error, _ -> speechState("error", "Speech unavailable: ${error.description}") }
  }

  private fun speechState(state: String, detail: String?) =
      js("window.__hydrisSpeechState && window.__hydrisSpeechState('$state', ${if (detail == null) "undefined" else JSONObject.quote(detail)})")

  // ------------------------------------------------------------------ page bridge
  inner class Bridge {
    @JavascriptInterface fun startPreview() { previewOn.set(true); lifecycleScope.launch { ensureCamera() } }
    @JavascriptInterface fun stopPreview() = previewOn.set(false)
    @JavascriptInterface fun capturePhoto(requestId: String) { capture(requestId) }
    @JavascriptInterface fun deviceName(): String = "Ray-Ban Meta"
    @JavascriptInterface fun startSpeech() { this@MainActivity.startSpeech() }
    @JavascriptInterface fun stopSpeech() { speechWanted.set(false); speech?.stop() }
    @JavascriptInterface fun speak(text: String) { tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "hydris-${System.nanoTime()}") }
    @JavascriptInterface fun connectGlasses() = runOnUiThread { Wearables.startRegistration(this@MainActivity) }
    @JavascriptInterface fun status(): String = Wearables.registrationState.value.toString()
  }

  private fun js(code: String) = runOnUiThread { web.evaluateJavascript(code, null) }
  private fun emitStatus(msg: String) { Log.i(TAG, msg); js("console.info(${JSONObject.quote("[Hydris bridge] $msg")})") }

  override fun onDestroy() {
    speechWanted.set(false)
    tts?.shutdown()
    session?.stop()
    super.onDestroy()
  }
}
