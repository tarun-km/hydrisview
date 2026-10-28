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
import com.meta.wearable.dat.core.types.ChargingState
import com.meta.wearable.dat.core.types.Device
import com.meta.wearable.dat.core.types.DeviceCompatibility
import com.meta.wearable.dat.core.types.DeviceType
import com.meta.wearable.dat.core.types.DonState
import com.meta.wearable.dat.core.types.HingeState
import com.meta.wearable.dat.core.types.Permission
import com.meta.wearable.dat.core.types.ThermalLevel
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
  /** Everything below comes from DAT `devicesMetadata` (null = not reported). */
  val deviceModel: String? = null,
  val linkState: String? = null,
  val firmware: String? = null,
  /** 0-100, null when DAT reports no level (negative / out of range). */
  val battery: Int? = null,
  val charging: Boolean? = null,
  val worn: Boolean? = null,
  val hingeOpen: Boolean? = null,
  val thermal: String? = null,
  val compatibility: String? = null,
  val displayCapable: Boolean? = null,
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
class GlassesManager(private val appContext: Context, val prefs: GlassesPrefs) {
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

  /** Meta Ray-Ban Display screen (no-op on glasses without one). */
  val display = GlassesDisplay(scope, prefs) { log(it) }

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
        if (ids.isEmpty()) { metaJob?.cancel(); _state.update { it.copy(linkState = null, battery = null, charging = null, worn = null, hingeOpen = null) } }
        ids.firstOrNull()?.let { id ->
          metaJob?.cancel()
          metaJob = scope.launch { Wearables.devicesMetadata[id]?.collect { meta -> _state.update { applyMeta(it, meta) } } }
        }
      }
    }
  }

  private var metaJob: Job? = null

  /** Maps DAT's Device metadata onto the UI state; unknown values stay null so the UI hides them. */
  private fun applyMeta(s: GlassesState, m: Device): GlassesState = s.copy(
    deviceName = m.name.ifEmpty { null } ?: s.deviceName,
    deviceModel = m.deviceType.takeIf { it != DeviceType.UNKNOWN }?.description?.ifBlank { null },
    linkState = m.linkState.name.lowercase(),
    firmware = m.firmwareInfo?.trim()?.ifEmpty { null },
    battery = m.batteryLevel.takeIf { it in 0..100 },
    charging = when (m.chargingState) { ChargingState.CHARGING -> true; ChargingState.NOT_CHARGING -> false; else -> null },
    worn = when (m.donState) { DonState.DONNED -> true; DonState.DOFFED -> false; else -> null },
    hingeOpen = when (m.hingeState) { HingeState.OPEN -> true; HingeState.CLOSED -> false; else -> null },
    thermal = m.thermalLevel.takeIf { it != ThermalLevel.UNKNOWN && it != ThermalLevel.NONE }?.name?.lowercase(),
    compatibility = m.compatibility.takeIf { it != DeviceCompatibility.UNDEFINED }?.displayString,
    displayCapable = m.isDisplayCapable(),
  )

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
    return GlassesId.canonical(raw)
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
              if (st == DeviceSessionState.STARTED) { if (!d.isCompleted) d.complete(created); attachInputs(created); display.attach(created) }
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

  /** Starts a session if needed and waits briefly for the lens display; true when it can show content. */
  suspend fun ensureLens(): Boolean {
    if (display.available) return true
    ensureSession() ?: return false
    kotlinx.coroutines.withTimeoutOrNull(6_000) { display.state.first { it == "STARTED" || it == "unsupported" } }
    return display.available
  }

  /** Stops the camera stream and the glasses session (used before unlinking). */
  fun endSession() {
    runCatching { camera?.stream?.stop() }
    runCatching { session?.stop() }
    reset()
  }

  private fun reset() {
    frameJob?.cancel()
    display.detach()
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
    s.addCamera(StreamConfiguration(videoQuality = VideoQuality.HIGH, frameRate = 24))
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
        colorBitmap(f.buffer, f.width, f.height)?.let { _frame.value = it }
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
  /**
   * Full-colour frame from the decoded YUV 4:2:0 stream. DAT does not document the chroma layout, so it is
   * detected per frame: planar (I420: U plane then V plane) or semi-planar (NV21, interleaved V/U).
   */
  private fun colorBitmap(buffer: ByteBuffer, w: Int, h: Int): Bitmap? {
    if (w <= 0 || h <= 0) return null
    val data = buffer.duplicate().apply { rewind() }
    val total = data.remaining()
    if (total < w * h * 3 / 2) return null
    val stride = max(w, (total / (h * 1.5)).roundToInt())
    val bytes = ByteArray(total).also { data.get(it) }
    val ySize = stride * h
    val cw = w / 2; val ch = h / 2; val cStride = stride / 2
    // Interleaved chroma correlates at distance 2 (same channel), planar at distance 1.
    var d1 = 0L; var d2 = 0L
    val probe = minOf(4000, (total - ySize) - 4)
    for (i in 0 until probe) { val a = bytes[ySize + i].toInt() and 0xFF; d1 += kotlin.math.abs(a - (bytes[ySize + i + 1].toInt() and 0xFF)); d2 += kotlin.math.abs(a - (bytes[ySize + i + 2].toInt() and 0xFF)) }
    val interleaved = d2 < d1
    val px = IntArray(w * h)
    for (y in 0 until h) {
      val yRow = y * stride; val cy = y / 2
      for (x in 0 until w) {
        val Y = (bytes[yRow + x].toInt() and 0xFF) - 16
        val cx = x / 2
        val u: Int; val v: Int
        if (interleaved) { val o = ySize + cy * stride + cx * 2; v = (bytes[o].toInt() and 0xFF) - 128; u = (bytes[o + 1].toInt() and 0xFF) - 128 }
        else { val o = cy * cStride + cx; u = (bytes[ySize + o].toInt() and 0xFF) - 128; v = (bytes[ySize + cStride * ch + o].toInt() and 0xFF) - 128 }
        val yy = 1192 * maxOf(Y, 0)
        val r = ((yy + 1634 * v) shr 10).coerceIn(0, 255)
        val g = ((yy - 833 * v - 400 * u) shr 10).coerceIn(0, 255)
        val b = ((yy + 2066 * u) shr 10).coerceIn(0, 255)
        px[y * w + x] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
      }
    }
    return Bitmap.createBitmap(px, w, h, Bitmap.Config.ARGB_8888)
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
