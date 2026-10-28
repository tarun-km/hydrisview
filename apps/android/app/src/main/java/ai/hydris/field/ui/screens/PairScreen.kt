package ai.hydris.field.ui.screens

import ai.hydris.field.HydrisApp
import ai.hydris.field.MainActivity
import ai.hydris.field.data.ApiException
import ai.hydris.field.ui.components.BackButton
import ai.hydris.field.ui.components.ErrorNote
import ai.hydris.field.ui.components.Eyebrow
import ai.hydris.field.ui.components.HButton
import ai.hydris.field.ui.components.HCard
import ai.hydris.field.ui.components.HField
import ai.hydris.field.ui.components.HSecondaryButton
import ai.hydris.field.ui.components.NavSpacer
import ai.hydris.field.ui.components.PageHeader
import ai.hydris.field.ui.components.appear
import ai.hydris.field.ui.theme.Hx
import ai.hydris.field.ui.theme.HxShape
import ai.hydris.field.ui.theme.HxType
import android.Manifest
import android.annotation.SuppressLint
import android.view.HapticFeedbackConstants
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ContentPaste
import androidx.compose.material.icons.outlined.HourglassTop
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.navigation.NavController
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.launch

/** Pairing code from a scanned / pasted payload: hydrisfield://pair?code=…, …/pair?code=… or the bare code. */
fun pairingCodeFrom(payload: String): String? {
  val s = payload.trim()
  val raw = Regex("[?&]code=([^&#\\s]+)", RegexOption.IGNORE_CASE).find(s)?.groupValues?.get(1)?.let { android.net.Uri.decode(it) } ?: s
  val alphabet = "23456789ABCDEFGHJKMNPQRSTVWXYZ"
  val c = raw.uppercase().filter { it in alphabet }
  return if (c.length == 8) "${c.take(4)}-${c.drop(4)}" else null
}

/**
 * Pair glasses that show a QR (Meta Ray-Ban Display / browser glasses app): scan it with the phone camera
 * (CameraX + ML Kit barcode scanning) and the glasses are approved for the signed-in person at once. The typed
 * code and a pasted / deep-linked payload (hydrisfield://pair?code=…) are the fallbacks.
 */
@SuppressLint("UnsafeOptInUsageError")
@Composable
fun PairScreen(activity: MainActivity, nav: NavController, initial: String?) {
  val app = LocalContext.current.applicationContext as HydrisApp
  val scope = rememberCoroutineScope()
  val view = LocalView.current
  val clipboard = LocalClipboardManager.current
  var cameraOk by remember { mutableStateOf<Boolean?>(null) }
  var code by remember { mutableStateOf(initial?.let { pairingCodeFrom(it) } ?: "") }
  var busy by remember { mutableStateOf(false) }
  var err by remember { mutableStateOf<String?>(null) }
  var done by remember { mutableStateOf<Pair<String, Boolean>?>(null) } // device name, waiting for admin
  val handled = remember { AtomicBoolean(false) }

  fun approve(payload: String) {
    val c = pairingCodeFrom(payload)
    if (c == null) { err = "That is not a Hydris pairing code."; handled.set(false); return }
    if (busy) return
    code = c; busy = true; err = null
    scope.launch {
      runCatching { app.repo.approvePairing(c) }
        .onSuccess { r ->
          view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
          done = (r.device?.name ?: "Glasses") to r.needsAdminApproval
        }
        .onFailure { e ->
          handled.set(false)
          err = when ((e as? ApiException)?.code) {
            "not_found" -> "Code not found or expired. Ask the glasses for a new code."
            "device_owned_elsewhere" -> "These glasses belong to another organization."
            else -> e.message ?: "Could not pair"
          }
        }
      busy = false
    }
  }

  LaunchedEffect(Unit) {
    if (initial != null && pairingCodeFrom(initial) != null && handled.compareAndSet(false, true)) approve(initial)
    cameraOk = activity.ensurePhonePermission(Manifest.permission.CAMERA)
  }

  Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
    BackButton { nav.popBackStack() }
    PageHeader("Glasses", "Pair glasses", "Scan the QR shown on the glasses. They sign in as you straight away.", modifier = Modifier.appear())

    val d = done
    if (d != null) {
      HCard(Modifier.fillMaxWidth().appear(1), accent = if (d.second) Hx.High else Hx.Ok) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Icon(if (d.second) Icons.Outlined.HourglassTop else Icons.Outlined.CheckCircle, null, tint = if (d.second) Hx.High else Hx.Ok, modifier = Modifier.size(28.dp))
          Spacer(Modifier.width(12.dp))
          Column(Modifier.weight(1f)) {
            Text(if (d.second) "Waiting for administrator approval" else "Paired", style = HxType.Section)
            Text(
              if (d.second) "${d.first} will sign in as you once an administrator approves them." else "${d.first} is signing in as you now. Code $code.",
              color = Hx.Text2, fontSize = 14.sp,
            )
          }
        }
        Spacer(Modifier.height(14.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          HButton({ nav.popBackStack() }, Modifier.weight(1f)) { Text("Done") }
          HSecondaryButton({ done = null; code = ""; handled.set(false) }, Modifier.weight(1f)) { Text("Pair another") }
        }
      }
    } else {
      Box(
        Modifier.fillMaxWidth().aspectRatio(1f).clip(HxShape.Xl).background(Color.Black).border(1.dp, Hx.Line2, HxShape.Xl).appear(1),
        contentAlignment = Alignment.Center,
      ) {
        if (cameraOk == true) QrCamera { raw -> if (handled.compareAndSet(false, true)) approve(raw) }
        else Column(horizontalAlignment = Alignment.CenterHorizontally) {
          Icon(Icons.Outlined.QrCodeScanner, null, tint = Hx.Muted, modifier = Modifier.size(48.dp))
          Text(if (cameraOk == false) "Camera permission is off. Type the code below." else "Starting camera…", color = Hx.Muted, fontSize = 14.sp, modifier = Modifier.padding(top = 10.dp))
        }
        // Viewfinder frame
        Box(Modifier.fillMaxWidth(0.62f).aspectRatio(1f).border(3.dp, Hx.Signal.copy(alpha = 0.9f), HxShape.Lg))
        if (busy) Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.55f)), contentAlignment = Alignment.Center) { Text("Pairing…", color = Color.White, fontWeight = FontWeight.SemiBold) }
      }
      HCard(Modifier.fillMaxWidth().appear(2), padding = 16.dp) {
        Eyebrow("No camera? Type the code")
        Spacer(Modifier.height(8.dp))
        HField(null, code, { code = it.uppercase().take(40) }, placeholder = "XXXX-XXXX")
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          HButton({ approve(code) }, Modifier.weight(1f), enabled = !busy && pairingCodeFrom(code) != null) { Text(if (busy) "Pairing…" else "Pair") }
          HSecondaryButton({ clipboard.getText()?.text?.let { approve(it) } }, Modifier.weight(1f), enabled = !busy) {
            Icon(Icons.Outlined.ContentPaste, null, Modifier.size(18.dp)); Text(" Paste link", maxLines = 1)
          }
        }
      }
    }
    err?.let { ErrorNote(it) }
    Text("The QR holds a single-use code that expires in 5 minutes - never a password. Administrators can also pair at /pair in the console.",
      color = Hx.Muted, style = HxType.Label)
    NavSpacer()
  }
}

/** Back camera preview that reports the first QR payload it decodes (ML Kit, QR format only). */
@Composable
private fun QrCamera(onPayload: (String) -> Unit) {
  val ctx = LocalContext.current
  val owner = LocalLifecycleOwner.current
  val scanner = remember { BarcodeScanning.getClient(BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()) }
  AndroidView(factory = { c ->
    PreviewView(c).apply {
      scaleType = PreviewView.ScaleType.FILL_CENTER
      val providerF = ProcessCameraProvider.getInstance(c)
      providerF.addListener({
        val provider = providerF.get()
        val preview = Preview.Builder().build().also { it.surfaceProvider = surfaceProvider }
        val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
        analysis.setAnalyzer(Executors.newSingleThreadExecutor()) { proxy ->
          val media = proxy.image
          if (media == null) { proxy.close(); return@setAnalyzer }
          scanner.process(InputImage.fromMediaImage(media, proxy.imageInfo.rotationDegrees))
            .addOnSuccessListener { codes -> codes.firstNotNullOfOrNull { it.rawValue }?.let(onPayload) }
            .addOnCompleteListener { proxy.close() }
        }
        runCatching { provider.unbindAll(); provider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis) }
      }, ContextCompat.getMainExecutor(c))
    }
  }, modifier = Modifier.fillMaxSize(), onRelease = { runCatching { ProcessCameraProvider.getInstance(ctx).get().unbindAll() }; scanner.close() })
}
