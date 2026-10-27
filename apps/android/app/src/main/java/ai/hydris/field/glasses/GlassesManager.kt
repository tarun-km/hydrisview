package ai.hydris.field.glasses

import android.app.Activity
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.util.Log
import androidx.exifinterface.media.ExifInterface
import com.meta.wearable.dat.camera.Camera
import com.meta.wearable.dat.camera.addCamera
import com.meta.wearable.dat.camera.types.PhotoData
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
import com.meta.wearable.dat.inputs.Inputs
import com.meta.wearable.dat.inputs.addInputs
import com.meta.wearable.dat.inputs.types.CapturePressType
import com.meta.wearable.dat.inputs.types.InputEvent
import com.meta.wearable.dat.inputs.types.InputSource
import com.meta.wearable.dat.inputs.types.InputsConfiguration
import com.meta.wearable.dat.speech.Speech
import com.meta.wearable.dat.speech.addSpeech
import com.meta.wearable.dat.speech.types.SpeechState
import java.io.ByteArrayInputStream
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max
import kotlin.math.roundToInt
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** Connection status shown on the Glasses screen. */
data class GlassesState(
  val initialized: Boolean = false,
  val registration: String = "unknown",
  val registered: Boolean = false,
  val devices: List<String> = emptyList(),
  val deviceName: String? = null,
  val session: String = "idle",
  val cameraStreaming: Boolean = false,
  val speech: String = "off",
  val lastError: String? = null,
  val log: List<String> = emptyList(),
)

/**
 * Ray-Ban Meta glasses through Meta's Wearables Device Access Toolkit (DAT 1.0.x).
 *
 * The Meta AI app must stay installed: it owns the Bluetooth link, glasses setup, firmware and the
 * permission prompts. This app is where the operator works; DAT gives it the glasses' camera stream,
 * photo capture, capture button and on-glasses speech recognition.
 */
class GlassesManager(private val appContext: Context) {
  companion object { const val META_AI_PACKAGE = "com.facebook.stella" }
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
  private val _state = MutableStateFlow(GlassesState())
  val state: StateFlow<GlassesState> = _state.asStateFlow()

  /** Latest preview frame (luma) for guided A4 framing. */
  private val _frame = MutableStateFlow<Bitmap?>(null)
  val frame: StateFlow<Bitmap?> = _frame.asStateFlow()
  private val _captureButton = MutableSharedFlow<Unit>(extraBufferCapacity = 4)
  val captureButton: SharedFlow<Unit> = _captureButton.asSharedFlow()
  private val _speech = MutableSharedFlow<Pair<String, Boolean>>(extraBufferCapacity = 16)
  val speech: SharedFlow<Pair<String, Boolean>> = _speech.asSharedFlow()

  /** Installed by MainActivity: requests a glasses permission (opens the Meta AI app). */
  var permissionRequester: (suspend (Permission) -> PermissionStatus)? = null

  private var session: DeviceSession? = null
  private var sessionReady: CompletableDeferred<DeviceSession>? = null
  private var camera: Camera? = null
  private var speechCap: Speech? = null
  private var inputs: Inputs? = null
  private var frameJob: Job? = null
  private val previewOn = AtomicBoolean(false)
  private val speechWanted = AtomicBoolean(false)
  private val cameraMutex = Mutex()
  private var lastFrameAt = 0L

  private fun log(msg: String) {
    Log.i("HydrisGlasses", msg)
    _state.update { it.copy(log = (listOf(msg) + it.log).take(30)) }
  }
  private fun fail(msg: String) { log(msg); _state.update { it.copy(lastError = msg) } }

  /** Call after BLUETOOTH/BLUETOOTH_CONNECT are granted. */
  fun initialize() {
    if (_state.value.initialized) return
    Wearables.initialize(appContext)
    _state.update { it.copy(initialized = true) }
    scope.launch { Wearables.registrationErrorStream.collect { e -> fail("Meta AI: ${e.description}") } }
    scope.launch {
      Wearables.registrationState.collect { r -> _state.update { it.copy(registration = r.toString(), registered = r == RegistrationState.REGISTERED) } }
    }
    scope.launch {
      Wearables.devices.collect { ids ->
        _state.update { it.copy(devices = ids.map { d -> d.toString() }) }
        ids.firstOrNull()?.let { id ->
          scope.launch { Wearables.devicesMetadata[id]?.collect { meta -> _state.update { it.copy(deviceName = meta.name.ifEmpty { "Ray-Ban Meta" }) } } }
        }
      }
    }
  }

  /** True when the Meta AI app (package com.facebook.stella) is installed - DAT registration goes through it. */
  fun metaAiInstalled(): Boolean = runCatching { appContext.packageManager.getPackageInfo(META_AI_PACKAGE, 0); true }.getOrDefault(false)

  fun connect(activity: Activity) {
    if (!metaAiInstalled()) { fail("Install the Meta AI app and pair your glasses in it first - Hydris connects through it."); return }
    _state.update { it.copy(lastError = null) }
    Wearables.startRegistration(activity)
  }
  fun disconnect(activity: Activity) { Wearables.startUnregistration(activity) }

  /** Stable, non-reversible hardware id for registering these glasses with Hydris. */
  fun hardwareId(): String? {
    val raw = _state.value.devices.firstOrNull() ?: return null
    val h = MessageDigest.getInstance("SHA-256").digest(("hydris-glasses:$raw").toByteArray())
    return "rbm-" + h.take(16).joinToString("") { "%02x".format(it) }
  }

  private suspend fun ensurePermission(p: Permission): Boolean {
    var granted = false
    Wearables.checkPermissionStatus(p).onSuccess { granted = it == PermissionStatus.Granted }
    if (granted) return true
    val requester = permissionRequester ?: return false
    return requester(p) == PermissionStatus.Granted
  }

  private suspend fun ensureSession(): DeviceSession? {
    session?.let { s -> if (s.state.value == DeviceSessionState.STARTED) return s }
    if (!_state.value.registered) { fail("Connect Hydris in the Meta AI app first (Glasses → Connect)"); return null }
    val ready = sessionReady ?: CompletableDeferred<DeviceSession>().also { d ->
      sessionReady = d
      Wearables.createSession(AutoDeviceSelector())
        .onSuccess { created ->
          session = created
          scope.launch {
            created.state.collect { st ->
              _state.update { it.copy(session = st.toString()) }
              if (st == DeviceSessionState.STARTED) { if (!d.isCompleted) d.complete(created); attachInputs(created) }
              if (st == DeviceSessionState.STOPPED) {
                // Ended before it started (glasses asleep, not worn, or no permission): fail the waiter instead of hanging.
                if (!d.isCompleted) d.completeExceptionally(IllegalStateException(_state.value.lastError ?: "Glasses session ended"))
                reset()
              }
            }
          }
          scope.launch { created.errors.collect { e -> fail("Session: ${e.description}") } }
          created.start()
        }
        .onFailure { e, _ -> fail("No glasses session: ${e.description}"); d.completeExceptionally(IllegalStateException(e.description)); sessionReady = null }
    }
    return runCatching { withTimeout(20_000) { ready.await() } }
      .onFailure { if (it is kotlinx.coroutines.TimeoutCancellationException) { fail("Glasses did not respond. Wear them (or unfold), check they show Connected in the Meta AI app, then try again."); sessionReady = null } }
      .getOrNull()
  }

  private fun reset() {
    frameJob?.cancel()
    camera = null; speechCap = null; inputs = null; session = null; sessionReady = null
    _state.update { it.copy(cameraStreaming = false, speech = "off", session = "stopped") }
  }

  // ------------------------------------------------------------------ camera
  private suspend fun ensureCamera(): Camera? = cameraMutex.withLock {
    camera?.let { c -> if (c.stream.state.value != StreamState.STOPPED && c.stream.state.value != StreamState.CLOSED) return c }
    // Permission first (as in Meta's samples): a session without camera permission reports no eligible device.
    if (!ensurePermission(Permission.CAMERA)) { fail("Camera permission denied in Meta AI"); return null }
    val s = ensureSession() ?: return null
    var added: Camera? = null
    s.addCamera(StreamConfiguration(videoQuality = VideoQuality.MEDIUM, frameRate = 24))
      .onSuccess { added = it }
      .onFailure { e, _ -> fail("Camera unavailable: ${e.description}") }
    val c = added ?: return null
    camera = c
    scope.launch { c.stream.errorStream.collect { e -> log("Stream: ${e.description}") } }
    frameJob = scope.launch(Dispatchers.Default) {
      c.stream.videoStream.collect { f ->
        if (!previewOn.get() || f.isCompressed) return@collect
        val now = System.currentTimeMillis()
        if (now - lastFrameAt < 100) return@collect
        lastFrameAt = now
        lumaBitmap(f.buffer, f.width, f.height)?.let { _frame.value = it }
      }
    }
    c.stream.start().onFailure { e, _ -> fail("Stream failed: ${e.description}") }
    c.stream.state.first { it == StreamState.STREAMING || it == StreamState.STOPPED || it == StreamState.CLOSED }
    _state.update { it.copy(cameraStreaming = c.stream.state.value == StreamState.STREAMING) }
    c
  }

  suspend fun startPreview(): Boolean { previewOn.set(true); return ensureCamera() != null }
  fun stopPreview() { previewOn.set(false); _frame.value = null }

  /** Full-resolution still from the glasses (EXIF orientation applied). */
  suspend fun capturePhoto(): Bitmap {
    val c = ensureCamera() ?: throw IllegalStateException(_state.value.lastError ?: "Glasses camera not available")
    var out: Bitmap? = null
    var err: String? = null
    c.stream.capturePhoto()
      .onSuccess { photo -> out = decodePhoto(photo) }
      .onFailure { e, _ -> err = e.description }
    return out ?: throw IllegalStateException(err ?: "Could not decode the glasses photo")
  }

  private fun attachInputs(s: DeviceSession) {
    if (inputs != null) return
    s.addInputs(InputsConfiguration(sources = setOf(InputSource.CAPTURE_BUTTON), consumeBack = false))
      .onSuccess { i ->
        inputs = i
        scope.launch { i.events.collect { e -> if (e is InputEvent.Capture && e.pressType == CapturePressType.SHORT_PRESS) _captureButton.tryEmit(Unit) } }
      }
      .onFailure { e, _ -> log("Capture button unavailable: ${e.description}") }
  }

  // ------------------------------------------------------------------ speech (glasses microphone)
  /** Always-on recognition on the glasses (restarted after silence while wanted). Returns false when unavailable. */
  suspend fun startSpeech(): Boolean {
    speechWanted.set(true)
    speechCap?.let { it.start(); return true }
    val s = ensureSession() ?: return false
    if (!ensurePermission(Permission.MICROPHONE)) { fail("Microphone permission denied in Meta AI"); return false }
    var ok = false
    s.addSpeech()
      .onSuccess { sp ->
        speechCap = sp
        ok = true
        var started = false
        scope.launch { sp.transcriptions.collect { r -> if (r != null) _speech.tryEmit(r.text to r.isFinal) } }
        scope.launch {
          sp.state.collect { st ->
            when (st) {
              SpeechState.STARTED -> { started = true; _state.update { it.copy(speech = "listening") } }
              SpeechState.STOPPED -> if (started && speechWanted.get()) sp.start() else _state.update { it.copy(speech = "off") }
              else -> Unit
            }
          }
        }
        scope.launch { sp.errors.collect { e -> if (e != null) log("Speech: ${e.description}") } }
        sp.start().onFailure { e, _ -> fail("Speech failed: ${e.description}") }
      }
      .onFailure { e, _ -> fail("Speech unavailable: ${e.description}") }
    return ok
  }
  fun stopSpeech() { speechWanted.set(false); speechCap?.stop() }

  // ------------------------------------------------------------------ image helpers
  /** DAT raw frames are 4:2:0 YUV; every such layout starts with the luma plane, which is all page detection needs. */
  private fun lumaBitmap(buffer: ByteBuffer, w: Int, h: Int): Bitmap? {
    if (w <= 0 || h <= 0) return null
    val data = buffer.duplicate().apply { rewind() }
    val total = data.remaining()
    val stride = when {
      total >= w * h * 3 / 2 -> max(w, (total / (h * 1.5)).roundToInt())
      total >= w * h -> total / h
      else -> return null
    }
    val step = max(1, (w + 639) / 640)
    val ow = w / step; val oh = h / step
    val px = IntArray(ow * oh)
    val row = ByteArray(stride)
    for (y in 0 until oh) {
      data.position(y * step * stride)
      data.get(row, 0, minOf(stride, data.remaining()))
      for (x in 0 until ow) { val l = row[x * step].toInt() and 0xFF; px[y * ow + x] = (0xFF shl 24) or (l shl 16) or (l shl 8) or l }
    }
    return Bitmap.createBitmap(px, ow, oh, Bitmap.Config.ARGB_8888)
  }

  private fun decodePhoto(photo: PhotoData): Bitmap? = when (photo) {
    is PhotoData.Bitmap -> photo.bitmap
    is PhotoData.HEIC -> {
      val buf = photo.data.duplicate().apply { rewind() }
      val bytes = ByteArray(buf.remaining()).also { buf.get(it) }
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.let { bmp ->
        val m = Matrix()
        when (runCatching { ExifInterface(ByteArrayInputStream(bytes)).getAttributeInt(ExifInterface.TAG_ORIENTATION, 1) }.getOrDefault(1)) {
          ExifInterface.ORIENTATION_ROTATE_90 -> m.postRotate(90f)
          ExifInterface.ORIENTATION_ROTATE_180 -> m.postRotate(180f)
          ExifInterface.ORIENTATION_ROTATE_270 -> m.postRotate(270f)
        }
        if (m.isIdentity) bmp else Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
      }
    }
  }
}
