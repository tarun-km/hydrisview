package ai.hydris.field.ui.screens

import ai.hydris.field.HydrisApp
import ai.hydris.field.MainActivity
import ai.hydris.field.data.AuditDocSummary
import ai.hydris.field.data.OcrLine
import ai.hydris.field.data.ScanPage
import ai.hydris.field.data.ScanUpload
import ai.hydris.field.scan.DocDetect
import ai.hydris.field.scan.Guide
import ai.hydris.field.scan.OcrEngine
import ai.hydris.field.scan.Pt
import ai.hydris.field.ui.components.Chip
import ai.hydris.field.ui.components.ErrorNote
import ai.hydris.field.ui.components.Eyebrow
import ai.hydris.field.ui.components.HCard
import ai.hydris.field.ui.components.ProgressBar
import ai.hydris.field.ui.theme.Hx
import android.Manifest
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import android.graphics.Matrix
import android.util.Base64
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import java.util.concurrent.Executors
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.abs
import kotlin.math.min
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext

private sealed interface Stage {
  data object Menu : Stage
  data class Camera(val glasses: Boolean) : Stage
  data class Reading(val text: String, val progress: Float) : Stage
  data object Review : Stage
  data object Sending : Stage
  data class Sent(val doc: AuditDocSummary) : Stage
  data class Failed(val message: String) : Stage
}

@Composable
fun ScanScreen(activity: MainActivity) {
  val app = LocalContext.current.applicationContext as HydrisApp
  val glasses by app.glasses.state.collectAsState()
  var stage by remember { mutableStateOf<Stage>(Stage.Menu) }
  val pages = remember { mutableStateListOf<Pair<ScanPage, Bitmap>>() }
  var viaGlasses by remember { mutableStateOf(false) }
  val scope = rememberCoroutineScope()

  fun read(page: Bitmap) = scope.launch {
    stage = Stage.Reading("Preparing", 0f)
    runCatching { OcrEngine.scan(page) { t, p -> stage = Stage.Reading(t, p) } }
      .onSuccess { pages.add(it to page); stage = Stage.Review }
      .onFailure { stage = Stage.Failed(it.message ?: "Could not read the page") }
  }
  fun start(useGlasses: Boolean) = scope.launch {
    if (!useGlasses && !activity.ensurePhonePermission(Manifest.permission.CAMERA)) { stage = Stage.Failed("Camera permission is needed to scan with the phone"); return@launch }
    viaGlasses = useGlasses
    stage = Stage.Camera(useGlasses)
  }

  // Import an existing photo of the page (also the path on devices without a camera).
  val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
    if (uri == null) return@rememberLauncherForActivityResult
    viaGlasses = false
    scope.launch {
      stage = Stage.Reading("Flattening the page", 0f)
      runCatching {
        withContext(Dispatchers.Default) {
          val src = ImageDecoder.decodeBitmap(ImageDecoder.createSource(activity.contentResolver, uri)) { d, _, _ -> d.allocator = ImageDecoder.ALLOCATOR_SOFTWARE }
            .copy(Bitmap.Config.ARGB_8888, false)
          val d = DocDetect.detect(src)
          if (d.quad != null && d.coverage > 0.2f && !d.touchesEdge) DocDetect.warpToA4(src, d.quad) else src
        }
      }.onSuccess { read(it) }.onFailure { stage = Stage.Failed(it.message ?: "Could not open the photo") }
    }
  }

  // The glasses capture button starts a scan from the menu (the camera stage handles shooting itself).
  LaunchedEffect(Unit) { app.glasses.captureButton.collect { if (stage == Stage.Menu || stage == Stage.Review) start(true) } }

  Column(Modifier.fillMaxSize().statusBarsPadding().padding(horizontal = 16.dp)) {
    when (val s = stage) {
      Stage.Menu -> Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Spacer(Modifier.height(12.dp))
        Eyebrow("Paper record → verified digital audit", Hx.SignalText)
        Text("Audit scan", style = MaterialTheme.typography.headlineSmall)
        Text("Frame an A4 page; it captures automatically when aligned, flattens the page and reads it twice on this phone. Reviewers verify every value in the console.", color = Hx.Text2)
        HCard(onClick = { start(true) }, accent = Hx.Signal) {
          Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.Visibility, null, tint = Hx.SignalText, modifier = Modifier.size(28.dp))
            Column(Modifier.padding(start = 14.dp).weight(1f)) {
              Text("Scan with glasses camera", style = MaterialTheme.typography.titleMedium)
              Text(if (glasses.registered) "${glasses.deviceName ?: "Ray-Ban Meta"} · or press the capture button" else "Connect your glasses first (Glasses tab)", color = Hx.Muted, style = MaterialTheme.typography.bodySmall)
            }
          }
        }
        HCard(onClick = { start(false) }) {
          Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.PhotoCamera, null, tint = Hx.Text2, modifier = Modifier.size(28.dp))
            Column(Modifier.padding(start = 14.dp).weight(1f)) {
              Text("Scan with phone camera", style = MaterialTheme.typography.titleMedium)
              Text("Guided A4 framing on this phone", color = Hx.Muted, style = MaterialTheme.typography.bodySmall)
            }
          }
        }
        HCard(onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }) {
          Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.Image, null, tint = Hx.Text2, modifier = Modifier.size(28.dp))
            Column(Modifier.padding(start = 14.dp).weight(1f)) {
              Text("Import a photo", style = MaterialTheme.typography.titleMedium)
              Text("A picture of the page already on this phone", color = Hx.Muted, style = MaterialTheme.typography.bodySmall)
            }
          }
        }
        val recent = rememberLoad { auditDocs().take(4) }
        recent.data.value?.takeIf { it.isNotEmpty() }?.let { docs ->
          Eyebrow("Recent scans")
          docs.forEach { d -> Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) { Text(d.title, Modifier.weight(1f), maxLines = 1); Chip(d.status.replace('_', ' ')) } }
        }
      }
      is Stage.Camera -> GuidedCapture(
        glasses = s.glasses,
        onCaptured = { bmp -> read(bmp) },
        onCancel = { stage = if (pages.isEmpty()) Stage.Menu else Stage.Review },
        onError = { stage = Stage.Failed(it) },
      )
      is Stage.Reading -> Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text("Reading the page", style = MaterialTheme.typography.headlineSmall)
        Text(s.text, color = Hx.Text2, modifier = Modifier.padding(vertical = 12.dp))
        ProgressBar(s.progress, Hx.Signal, Modifier.padding(horizontal = 32.dp))
      }
      Stage.Review -> Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Spacer(Modifier.height(12.dp))
        Eyebrow("${pages.size} page${if (pages.size == 1) "" else "s"} read on this phone")
        Text("Check the capture", style = MaterialTheme.typography.headlineSmall)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          itemsIndexed(pages) { i, (p, bmp) ->
            Column {
              Image(bmp.asImageBitmap(), "Page ${i + 1}", Modifier.size(120.dp, 170.dp).clip(RoundedCornerShape(12.dp)), contentScale = ContentScale.Crop)
              Text("p${i + 1} · ${p.readings.first().conf.toInt()}% conf", color = Hx.Muted, style = MaterialTheme.typography.bodySmall)
            }
          }
        }
        val first = pages.last().first.readings.first()
        HCard {
          Eyebrow("Lines read (pass 1)")
          val pairs = labelValues(first.lines)
          pairs.take(8).forEach { (k, v) ->
            Row(Modifier.padding(vertical = 3.dp)) { Text(k, color = Hx.Muted, modifier = Modifier.weight(1f), maxLines = 1); Text(v, fontWeight = FontWeight.Medium, maxLines = 1) }
          }
          if (pairs.isEmpty()) Text("${first.lines.size} lines of text found.", color = Hx.Text2)
        }
        Button({
          stage = Stage.Sending
          scope.launch {
            runCatching { app.repo.uploadScan(ScanUpload(pages = pages.map { it.first }), viaGlasses) }
              .onSuccess { pages.clear(); stage = Stage.Sent(it) }
              .onFailure { stage = Stage.Failed(it.message ?: "Upload failed") }
          }
        }, modifier = Modifier.fillMaxWidth().height(54.dp), colors = ButtonDefaults.buttonColors(containerColor = Hx.Signal)) { Text("Send for verification") }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          OutlinedButton({ start(viaGlasses) }, Modifier.weight(1f), enabled = pages.size < 6) { Text("Add page") }
          OutlinedButton({ pages.clear(); stage = Stage.Menu }, Modifier.weight(1f)) { Text("Discard") }
        }
      }
      Stage.Sending -> Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text("Sending for verification", style = MaterialTheme.typography.headlineSmall)
        Text("Structuring values, tables and figures…", color = Hx.Text2, modifier = Modifier.padding(12.dp))
      }
      is Stage.Sent -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Spacer(Modifier.height(12.dp))
        Eyebrow("Sent · awaiting dual verification", Hx.OkSoft)
        Text(s.doc.title, style = MaterialTheme.typography.headlineSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          Chip("${s.doc.fields} values", Hx.OkSoft); Chip("${s.doc.tables} tables"); s.doc.agreement?.let { Chip("${(it * 100).toInt()}% engines agree", Hx.SignalText) }
          if (s.doc.attention > 0) Chip("${s.doc.attention} to check", Hx.High)
        }
        Text("Captured via ${s.doc.capturedVia}. A reviewer confirms each value against the paper in the console (Work → Audit documents), then a second person approves and the searchable PDF is produced.", color = Hx.Text2)
        Button({ stage = Stage.Menu }, Modifier.fillMaxWidth().height(52.dp), colors = ButtonDefaults.buttonColors(containerColor = Hx.Signal)) { Text("Scan another document") }
      }
      is Stage.Failed -> Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center) {
        ErrorNote(s.message)
        Spacer(Modifier.height(12.dp))
        OutlinedButton({ stage = if (pages.isEmpty()) Stage.Menu else Stage.Review }, Modifier.fillMaxWidth()) { Text("Back") }
      }
    }
  }
}

/** "Label: value" pairs; ML Kit often returns the value column as separate lines, so pair by visual row (bbox = x, y, w, h). */
private fun labelValues(lines: List<OcrLine>): List<Pair<String, String>> = lines.filter { it.text.contains(':') }.map { l ->
  val inline = l.text.substringAfter(':').trim()
  val value = inline.ifEmpty {
    val cy = l.bbox[1] + l.bbox[3] / 2
    lines.filter { o -> o !== l && o.bbox[0] > l.bbox[0] + l.bbox[2] * 0.9 && abs(o.bbox[1] + o.bbox[3] / 2 - cy) < l.bbox[3] * 0.6 }
      .minByOrNull { it.bbox[0] }?.text?.trim().orEmpty()
  }
  l.text.substringBefore(':').trim() to value
}

/** Live framing with page detection, guidance and auto-capture; returns the flattened A4 page. */
@Composable
private fun GuidedCapture(glasses: Boolean, onCaptured: (Bitmap) -> Unit, onCancel: () -> Unit, onError: (String) -> Unit) {
  val app = LocalContext.current.applicationContext as HydrisApp
  val ctx = LocalContext.current
  val owner = LocalLifecycleOwner.current
  var frame by remember { mutableStateOf<Bitmap?>(null) }
  var quad by remember { mutableStateOf<List<Pt>?>(null) }
  var guide by remember { mutableStateOf(Guide.NoDocument) }
  var readyPct by remember { mutableStateOf(0f) }
  var busy by remember { mutableStateOf(false) }
  val imageCapture = remember { ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY).build() }
  val scope = rememberCoroutineScope()
  val state = remember { object { var last: List<Pt>? = null; var stable = 0; var readySince = 0L; var lastDetect = 0L } }

  fun analyse(bmp: Bitmap) {
    val now = System.currentTimeMillis()
    if (now - state.lastDetect < 90) return
    state.lastDetect = now
    val d = DocDetect.detect(bmp)
    state.stable = if (DocDetect.motion(state.last, d.quad) < 0.012f) state.stable + 1 else 0
    state.last = d.quad
    val g = DocDetect.guide(d, state.stable >= 4)
    frame = bmp; quad = d.quad; guide = g
    if (g.ok) { if (state.readySince == 0L) state.readySince = now; readyPct = ((now - state.readySince) / 900f).coerceAtMost(1f) } else { state.readySince = 0; readyPct = 0f }
  }

  suspend fun takePhoto(): Bitmap = if (glasses) app.glasses.capturePhoto() else suspendCancellableCoroutine { cont ->
    imageCapture.takePicture(ContextCompat.getMainExecutor(ctx), object : ImageCapture.OnImageCapturedCallback() {
      override fun onCaptureSuccess(image: ImageProxy) { val b = image.toBitmap().rotate(image.imageInfo.rotationDegrees); image.close(); cont.resume(b) }
      override fun onError(exception: ImageCaptureException) { cont.resumeWithException(exception) }
    })
  }

  fun capture() {
    if (busy) return
    busy = true
    scope.launch {
      runCatching {
        val photo = takePhoto()
        withContext(Dispatchers.Default) {
          val d = DocDetect.detect(photo)
          val q = if (d.quad != null && d.coverage > 0.2f && !d.touchesEdge) d.quad else state.last
          if (q != null) DocDetect.warpToA4(photo, q) else photo
        }
      }.onSuccess { onCaptured(it) }.onFailure { onError(it.message ?: "Capture failed") }
      busy = false
    }
  }

  // Auto-capture once aligned and steady.
  LaunchedEffect(readyPct) { if (readyPct >= 1f && !busy) capture() }
  // Glasses: preview stream + physical capture button.
  if (glasses) {
    LaunchedEffect(Unit) { if (!app.glasses.startPreview()) onError(app.glasses.state.value.lastError ?: "Glasses camera not available") }
    LaunchedEffect(Unit) { app.glasses.frame.collect { it?.let(::analyse) } }
    LaunchedEffect(Unit) { app.glasses.captureButton.collect { capture() } }
    DisposableEffect(Unit) { onDispose { app.glasses.stopPreview() } }
  }

  Column(Modifier.fillMaxSize().padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Hx.Surface).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
      Box(Modifier.size(10.dp).clip(RoundedCornerShape(50)).background(if (guide.ok) Hx.Ok else if (guide == Guide.NoDocument) Hx.Muted else Hx.High))
      Text(if (busy) "Capturing and flattening the page…" else guide.message, Modifier.padding(start = 10.dp).weight(1f), style = MaterialTheme.typography.titleMedium)
      Chip(if (glasses) "Ray-Ban Meta" else "phone")
    }
    BoxWithConstraints(Modifier.fillMaxWidth().weight(1f).clip(RoundedCornerShape(22.dp)).background(Color.Black)) {
      if (glasses) {
        frame?.let { Image(it.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Fit) }
      } else {
        AndroidView(factory = { c ->
          PreviewView(c).apply {
            scaleType = PreviewView.ScaleType.FIT_CENTER
            val providerF = ProcessCameraProvider.getInstance(c)
            providerF.addListener({
              val provider = providerF.get()
              val preview = Preview.Builder().build().also { it.surfaceProvider = surfaceProvider }
              val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888).build()
              val exec = Executors.newSingleThreadExecutor()
              analysis.setAnalyzer(exec) { img -> val b = img.toBitmap().rotate(img.imageInfo.rotationDegrees); img.close(); scope.launch(Dispatchers.Main) { analyse(b) } }
              runCatching {
                provider.unbindAll()
                provider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis, imageCapture)
              }.onFailure { onError("No usable camera on this phone. Use \"Import a photo\" instead.") }
            }, ContextCompat.getMainExecutor(c))
          }
        }, modifier = Modifier.fillMaxSize(), onRelease = { runCatching { ProcessCameraProvider.getInstance(ctx).get().unbindAll() } })
      }
      // Overlay in the fitted image rectangle (both preview paths are FIT_CENTER).
      val f = frame
      Canvas(Modifier.fillMaxSize()) {
        if (f == null) return@Canvas
        val s = min(size.width / f.width, size.height / f.height)
        val w = f.width * s; val h = f.height * s
        val ox = (size.width - w) / 2; val oy = (size.height - h) / 2
        val gh = h * 0.86f; val gw = gh / 1.41421f
        drawRect(Color.White.copy(alpha = 0.5f), Offset(ox + (w - gw) / 2, oy + (h - gh) / 2), androidx.compose.ui.geometry.Size(gw, gh), style = Stroke(2.dp.toPx()))
        quad?.let { q ->
          val col = if (state.readySince > 0) Hx.Ok else if (guide == Guide.MoveBack || guide == Guide.Straighten || guide == Guide.Level) Hx.High else Hx.Signal
          val p = Path().apply { q.forEachIndexed { i, pt -> val x = ox + pt.x * w; val y = oy + pt.y * h; if (i == 0) moveTo(x, y) else lineTo(x, y) }; close() }
          drawPath(p, col.copy(alpha = 0.14f))
          drawPath(p, col, style = Stroke(3.dp.toPx()))
          q.forEach { pt -> drawCircle(col, 5.dp.toPx(), Offset(ox + pt.x * w, oy + pt.y * h)) }
        }
      }
      if (readyPct > 0f && !busy) ProgressBar(readyPct, Hx.Ok, Modifier.align(Alignment.BottomCenter).padding(horizontal = 60.dp, vertical = 14.dp))
    }
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
      Button({ capture() }, Modifier.weight(1f).height(54.dp), enabled = !busy, colors = ButtonDefaults.buttonColors(containerColor = Hx.Signal)) { Text("Capture now") }
      OutlinedButton(onCancel, Modifier.height(54.dp)) { Text("Cancel") }
    }
  }
}

private fun Bitmap.rotate(deg: Int): Bitmap = if (deg == 0) this else Bitmap.createBitmap(this, 0, 0, width, height, Matrix().apply { postRotate(deg.toFloat()) }, true)
@Suppress("unused") private fun unusedB64(x: ByteArray) = Base64.encodeToString(x, Base64.NO_WRAP)
@Suppress("unused") private suspend fun unusedDelay() = delay(0)
@Suppress("unused") private val unusedAspect = Modifier.aspectRatio(1f)
