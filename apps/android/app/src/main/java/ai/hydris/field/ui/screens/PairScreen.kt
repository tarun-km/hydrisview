package ai.hydris.field.ui.screens

import ai.hydris.field.HydrisApp
import ai.hydris.field.MainActivity
import ai.hydris.field.data.ApiException
import ai.hydris.field.ui.components.BackButton
import ai.hydris.field.ui.components.ErrorNote
import ai.hydris.field.ui.components.Eyebrow
import ai.hydris.field.ui.components.HButton
import ai.hydris.field.ui.components.HCard
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
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.TextButton
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
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
  val c = raw.uppercase().filter { it in CODE_ALPHABET }
  return if (c.length == 8) "${c.take(4)}-${c.drop(4)}" else null
}

/** Pairing code alphabet (packages/domain PAIRING_CODE_ALPHABET): no 0/O, 1/I/L, U. */
private const val CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"

/**
 * Pair glasses by their code. Head-worn displays are only visible to the wearer, so a phone can never scan the
 * lens: the typed 8-character code (XXXX-XXXX) is the default path, auto-submitted once complete. A pasted link
 * or a deep / App Link (hydrisfield://pair?code=..., https://.../pair?code=...) also works. The QR scanner remains
 * as a secondary option for the browser simulator / desktop glasses page. Native Ray-Ban Meta glasses need no code.
 */
@SuppressLint("UnsafeOptInUsageError")
@Composable
fun PairScreen(activity: MainActivity, nav: NavController, initial: String?) {
  val app = LocalContext.current.applicationContext as HydrisApp
  val scope = rememberCoroutineScope()
  val view = LocalView.current
  val clipboard = LocalClipboardManager.current
  var scanning by remember { mutableStateOf(false) }
  var cameraOk by remember { mutableStateOf<Boolean?>(null) }
  // Raw code characters (max 8, alphabet only); the dash is drawn between the two groups.
  var chars by remember { mutableStateOf(initial?.let { pairingCodeFrom(it) }?.replace("-", "") ?: "") }
  var busy by remember { mutableStateOf(false) }
  var err by remember { mutableStateOf<String?>(null) }
  var done by remember { mutableStateOf<Pair<String, Boolean>?>(null) } // device name, waiting for admin
  val handled = remember { AtomicBoolean(false) }
  val focus = remember { FocusRequester() }
  val code = if (chars.length > 4) "${chars.take(4)}-${chars.drop(4)}" else chars

  fun approve(payload: String) {
    val c = pairingCodeFrom(payload)
    if (c == null) { err = "That is not a Hydris pairing code. It has 8 characters, like ABCD-2345."; handled.set(false); return }
    if (busy) return
    chars = c.replace("-", ""); busy = true; err = null
    scope.launch {
      runCatching { app.repo.approvePairing(c) }
        .onSuccess { r ->
          view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
          done = (r.device?.name ?: "Glasses") to r.needsAdminApproval
        }
        .onFailure { e ->
          handled.set(false)
          view.performHapticFeedback(HapticFeedbackConstants.REJECT)
          val api = e as? ApiException
          err = when {
            api?.code == "invalid_code" -> "Invalid code. Check the 8 characters shown on the glasses."
            api?.code == "already_used" -> "This code was already used. Ask the glasses for a new code."
            api?.code == "not_found" || api?.status == 404 -> "Code expired or not recognised. Choose New code on the glasses and try again."
            api?.code == "device_owned_elsewhere" -> "These glasses belong to another organization."
            api?.status == 429 -> "Too many attempts. Wait a minute, then try again."
            else -> e.message ?: "Could not pair"
          }
        }
      busy = false
    }
  }

  fun onInput(text: String) {
    if (busy) return
    // Paste detection: a pasted link or formatted code is parsed as a whole.
    if (text.length - chars.length > 1 || text.contains("code=", ignoreCase = true) || text.contains("://")) {
      val c = pairingCodeFrom(text)
      if (c != null) { chars = c.replace("-", ""); err = null; if (handled.compareAndSet(false, true)) approve(c); return }
    }
    val next = text.uppercase().filter { it in CODE_ALPHABET }.take(8)
    err = null
    chars = next
    if (next.length < 8) handled.set(false)
    else if (handled.compareAndSet(false, true)) approve(next)
  }

  LaunchedEffect(Unit) {
    if (initial != null && pairingCodeFrom(initial) != null && handled.compareAndSet(false, true)) approve(initial)
    else runCatching { focus.requestFocus() }
  }
  LaunchedEffect(scanning) { if (scanning && cameraOk != true) cameraOk = activity.ensurePhonePermission(Manifest.permission.CAMERA) }

  Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
    BackButton { nav.popBackStack() }
    PageHeader("Glasses", "Pair glasses", "Enter the code shown on the glasses. They sign in as you straight away.", modifier = Modifier.appear())

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
          HSecondaryButton({ done = null; chars = ""; handled.set(false) }, Modifier.weight(1f)) { Text("Pair another") }
        }
      }
    } else {
      HCard(Modifier.fillMaxWidth().appear(1), padding = 16.dp) {
        Eyebrow("Code on the glasses")
        Spacer(Modifier.height(12.dp))
        BasicTextField(
          value = chars,
          onValueChange = { onInput(it) },
          enabled = !busy,
          singleLine = true,
          keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false, keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Done),
          keyboardActions = KeyboardActions(onDone = { if (chars.length == 8) approve(chars) }),
          cursorBrush = SolidColor(Color.Transparent),
          modifier = Modifier.fillMaxWidth().focusRequester(focus).semantics { contentDescription = "Pairing code, 8 characters" },
          decorationBox = { _ ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
              for (i in 0 until 8) {
                if (i == 4) Text("-", color = Hx.Signal, fontSize = 28.sp, fontWeight = FontWeight.Bold)
                val ch = chars.getOrNull(i)
                val active = i == chars.length && !busy
                Box(
                  Modifier.weight(1f).height(56.dp).clip(HxShape.Lg).background(Color.White.copy(alpha = 0.06f))
                    .border(if (active) 2.dp else 1.dp, if (err != null) Hx.Critical else if (active) Hx.Signal else Hx.Line2, HxShape.Lg),
                  contentAlignment = Alignment.Center,
                ) { Text(ch?.toString() ?: "", color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.SemiBold, fontFamily = FontFamily.Monospace) }
              }
            }
          },
        )
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          HButton({ approve(chars) }, Modifier.weight(1f), enabled = !busy && chars.length == 8) { Text(if (busy) "Pairing…" else "Pair") }
          HSecondaryButton({ clipboard.getText()?.text?.let { onInput(it) } }, Modifier.weight(1f), enabled = !busy) {
            Icon(Icons.Outlined.ContentPaste, null, Modifier.size(18.dp)); Text(" Paste", maxLines = 1)
          }
        }
      }
      err?.let { ErrorNote(it) }
      if (scanning) {
        Box(
          Modifier.fillMaxWidth().aspectRatio(1f).clip(HxShape.Xl).background(Color.Black).border(1.dp, Hx.Line2, HxShape.Xl),
          contentAlignment = Alignment.Center,
        ) {
          if (cameraOk == true) QrCamera { raw -> if (handled.compareAndSet(false, true)) approve(raw) }
          else Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Outlined.QrCodeScanner, null, tint = Hx.Muted, modifier = Modifier.size(48.dp))
            Text(if (cameraOk == false) "Camera permission is off. Type the code above." else "Starting camera…", color = Hx.Muted, fontSize = 14.sp, modifier = Modifier.padding(top = 10.dp))
          }
          Box(Modifier.fillMaxWidth(0.62f).aspectRatio(1f).border(3.dp, Hx.Signal.copy(alpha = 0.9f), HxShape.Lg))
          if (busy) Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.55f)), contentAlignment = Alignment.Center) { Text("Pairing…", color = Color.White, fontWeight = FontWeight.SemiBold) }
        }
      }
      TextButton({ scanning = !scanning }) {
        Icon(Icons.Outlined.QrCodeScanner, null, Modifier.size(18.dp), tint = Hx.Text2)
        Text(if (scanning) "  Hide scanner" else "  Scan QR (simulator / desktop)", color = Hx.Text2)
      }
    }
    Text("The code is single-use and expires in 5 minutes - never a password. Ray-Ban Meta glasses pair automatically from the Glasses screen. Administrators can also pair at /pair in the console.",
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
