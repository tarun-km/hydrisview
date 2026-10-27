package ai.hydris.field.ui.screens

import ai.hydris.field.HydrisApp
import ai.hydris.field.MainActivity
import ai.hydris.field.ScanRequest
import ai.hydris.field.glasses.Capture
import ai.hydris.field.glasses.GlassesManager
import ai.hydris.field.glasses.GlassesState
import ai.hydris.field.glasses.LensQuality
import ai.hydris.field.ui.components.Capsule
import ai.hydris.field.ui.components.Chip
import ai.hydris.field.ui.components.Dot
import ai.hydris.field.ui.components.EmptyCapturesArt
import ai.hydris.field.ui.components.ErrorNote
import ai.hydris.field.ui.components.Eyebrow
import ai.hydris.field.ui.components.GlassesArt
import ai.hydris.field.ui.components.GlassesLook
import ai.hydris.field.ui.components.HButton
import ai.hydris.field.ui.components.HCard
import ai.hydris.field.ui.components.HSecondaryButton
import ai.hydris.field.ui.components.NavSpacer
import ai.hydris.field.ui.components.PageHeader
import ai.hydris.field.ui.components.SectionTitle
import ai.hydris.field.ui.components.appear
import ai.hydris.field.ui.components.label
import ai.hydris.field.ui.components.pressable
import ai.hydris.field.ui.components.sharedCapture
import ai.hydris.field.ui.components.sheen
import ai.hydris.field.ui.theme.Hx
import ai.hydris.field.ui.theme.HxMotion
import ai.hydris.field.ui.theme.HxShape
import ai.hydris.field.ui.theme.HxType
import ai.hydris.field.ui.theme.LocalReducedMotion
import android.content.Intent
import android.graphics.Bitmap
import android.view.HapticFeedbackConstants
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BatteryChargingFull
import androidx.compose.material.icons.outlined.BatteryFull
import androidx.compose.material.icons.outlined.Cast
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.DocumentScanner
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.HelpOutline
import androidx.compose.material.icons.outlined.LinkOff
import androidx.compose.material.icons.outlined.Memory
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.OpenInNew
import androidx.compose.material.icons.outlined.PhotoCamera
import androidx.compose.material.icons.outlined.RadioButtonChecked
import androidx.compose.material.icons.outlined.SensorsOff
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material.icons.outlined.ViewInAr
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.meta.wearable.dat.display.views.IconName
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The glasses companion: hero device card, live status tiles, quick actions, the Hydris captures gallery,
 * setup stepper, persisted preferences, device actions and help.
 *
 * Everything about the device comes from Meta's DAT (`devicesMetadata`, session and capability states); values DAT
 * does not report are hidden, never guessed. The Meta AI app stays installed - it owns pairing and firmware.
 */
@Composable
fun GlassesScreen(activity: MainActivity, nav: NavController) {
  val app = LocalContext.current.applicationContext as HydrisApp
  val g by app.glasses.state.collectAsState()
  val lens by app.glasses.display.state.collectAsState()
  val prefs by app.prefs.settings.collectAsState()
  val captures by app.captures.items.collectAsState()
  var registered by remember { mutableStateOf(app.api.hasDevice()) }
  var busy by remember { mutableStateOf<String?>(null) }
  var err by remember { mutableStateOf<String?>(null) }
  var note by remember { mutableStateOf<String?>(null) }
  var confirm by remember { mutableStateOf<String?>(null) }
  var flash by remember { mutableStateOf(0) }
  val scope = rememberCoroutineScope()
  val view = LocalView.current

  fun act(label: String, block: suspend () -> Unit) = scope.launch {
    if (busy != null) return@launch
    busy = label; err = null; note = null
    runCatching { block() }.onFailure { err = it.message ?: "Something went wrong" }
    busy = null
  }

  fun takePhoto() = act("photo") {
    view.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
    val bmp: Bitmap = app.glasses.capturePhoto()
    flash++
    view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
    app.captures.save(bmp, "photo", g.deviceName ?: g.deviceModel)
    app.glasses.display.showStatus("Photo saved", "In Hydris captures", IconName.CHECKMARK_CIRCLE)
    note = "Photo saved to Hydris captures."
  }

  // A short press of the glasses capture button takes a photo while this tab is open.
  val takeLatest by rememberUpdatedState(::takePhoto)
  LaunchedEffect(Unit) { app.glasses.captureButton.collect { if (busy == null) takeLatest() } }
  LaunchedEffect(note) { if (note != null) { delay(4000); note = null } }

  val connected = g.registered && g.devices.isNotEmpty() && g.linkState != "disconnected"
  val look = when { connected -> GlassesLook.Connected; g.registered -> GlassesLook.Linked; else -> GlassesLook.Offline }
  val setupDone = g.registered && registered

  Box(Modifier.fillMaxSize()) {
    Column(
      Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(top = 12.dp),
      verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
      PageHeader("People & devices", "Field glasses", if (connected) "Connected and ready." else if (g.registered) "Linked · waiting for glasses." else "Not connected yet.",
        subColor = if (connected) Hx.Text2 else Hx.Muted)

      HeroCard(g, look, lens, registered, app.api.deviceName, Modifier.appear(1))

      // quick actions
      Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).appear(2), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        HButton({ takePhoto() }, enabled = g.registered && busy == null) {
          Icon(Icons.Outlined.PhotoCamera, null, Modifier.size(18.dp)); Text(if (busy == "photo") "Capturing…" else "Take photo")
        }
        HSecondaryButton({ app.scanRequest.value = ScanRequest.GlassesCamera; nav.navigate("scan") { popUpTo("home"); launchSingleTop = true } }, enabled = g.registered) {
          Icon(Icons.Outlined.DocumentScanner, null, Modifier.size(18.dp)); Text("Scan document")
        }
        HSecondaryButton({ testMic(app, ::act, { note = it }, { err = it }) }, enabled = g.registered && busy == null) {
          Icon(Icons.Outlined.Mic, null, Modifier.size(18.dp)); Text(if (busy == "mic") "Listening…" else "Test microphone")
        }
        HSecondaryButton({ showLensTest(app, ::act, { note = it }, { err = it }) }, enabled = g.registered && busy == null && g.displayCapable != false && lens != "unsupported") {
          Icon(Icons.Outlined.ViewInAr, null, Modifier.size(18.dp)); Text(if (busy == "lens") "Sending…" else "Show on lens")
        }
      }

      AnimatedVisibility(note != null, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
        Row(Modifier.fillMaxWidth().clip(HxShape.Pill).background(Hx.OkFill.copy(alpha = 0.16f)).border(1.dp, Hx.OkFill.copy(alpha = 0.45f), HxShape.Pill).padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
          Dot(Hx.Ok, 8.dp); Text(note.orEmpty(), color = Hx.Text, fontSize = 14.sp, modifier = Modifier.padding(start = 10.dp))
        }
      }
      (err ?: g.lastError)?.let { ErrorNote(it) }

      // status grid
      SectionTitle("Status")
      Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).appear(3), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        StatusTile(Icons.Outlined.Videocam, "Camera", if (g.cameraStreaming) "Live" else "Idle", if (g.cameraStreaming) Hx.Ok else Hx.Muted,
          if (busy == "camera") "Testing…" else "Test camera", Modifier.weight(1f), g.registered && busy == null) {
          act("camera") { if (app.glasses.startPreview()) note = "Glasses camera is streaming." else err = app.glasses.state.value.lastError; app.glasses.stopPreview() }
        }
        StatusTile(Icons.Outlined.Mic, "Microphone", if (g.speech == "listening") "Listening" else "Off", if (g.speech == "listening") Hx.Ok else Hx.Muted,
          if (busy == "mic") "Listening…" else "Test", Modifier.weight(1f), g.registered && busy == null) { testMic(app, ::act, { note = it }, { err = it }) }
      }
      Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).appear(4), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        val (lensLabel, lensColor) = when {
          lens == "unsupported" || g.displayCapable == false -> "Unsupported" to Hx.Muted
          lens == "STARTED" -> "Attached" to Hx.Ok
          lens != "none" -> label(lens) to Hx.Medium
          g.displayCapable == true -> "Available" to Hx.Accent
          else -> "Not attached" to Hx.Muted
        }
        StatusTile(Icons.Outlined.ViewInAr, "Lens display", lensLabel, lensColor, "Test card", Modifier.weight(1f),
          g.registered && busy == null && lensLabel != "Unsupported") { showLensTest(app, ::act, { note = it }, { err = it }) }
        StatusTile(Icons.Outlined.Cast, "Live share", if (!registered) "Needs register" else if (prefs.shareLive) "Sharing" else "Paused",
          if (registered && prefs.shareLive) Hx.Ok else Hx.Muted, if (prefs.shareLive) "Pause" else "Resume", Modifier.weight(1f), registered) {
          app.prefs.update { it.copy(shareLive = !it.shareLive) }
        }
      }
      CaptureButtonTile(g.registered, busy == "photo", flash, Modifier.appear(5)) { takePhoto() }

      // captures
      SectionTitle("Captures", if (captures.isNotEmpty()) "See all" else null) { nav.navigate("captures") }
      if (captures.isEmpty()) {
        HCard(Modifier.fillMaxWidth().appear(6)) {
          EmptyCapturesArt(Modifier.fillMaxWidth(0.6f).align(Alignment.CenterHorizontally))
          Text("No captures yet", style = HxType.Card, modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 8.dp))
          Text("Photos you take with the glasses through Hydris - quick photos and the originals of audit scans - are kept here on this phone.",
            color = Hx.Muted, style = HxType.Label, modifier = Modifier.padding(top = 6.dp).align(Alignment.CenterHorizontally))
        }
      } else CaptureGrid(captures.take(6), Modifier.appear(6)) { nav.navigate("capture/${it.id}") }

      // setup
      SectionTitle("Setup")
      SetupStepper(g, registered, setupDone, busy, Modifier.appear(7),
        onConnect = { if (!g.initialized) app.glasses.initialize(); app.glasses.connect(activity) },
        onTestCamera = { act("camera") { if (app.glasses.startPreview()) note = "Glasses camera is streaming." else err = app.glasses.state.value.lastError; app.glasses.stopPreview() } },
        onTestMic = { testMic(app, ::act, { note = it }, { err = it }) },
        onRegister = {
          act("register") {
            val hw = app.glasses.hardwareId() ?: throw IllegalStateException("Connect the glasses first (step 1)")
            app.repo.registerGlasses(hw, g.deviceName ?: "Ray-Ban Meta", g.deviceModel ?: "Ray-Ban Meta")
            registered = true; note = "Registered - your glasses now appear in the console."
          }
        },
      )

      // preferences
      SectionTitle("Preferences")
      HCard(Modifier.fillMaxWidth().appear(8), padding = 6.dp) {
        PrefRow("Lens preview", "Show the camera view on the Meta Ray-Ban Display while scanning", prefs.lensPreview) { v -> app.prefs.update { it.copy(lensPreview = v) } }
        AnimatedVisibility(prefs.lensPreview) {
          Column(Modifier.padding(horizontal = 14.dp, vertical = 6.dp)) {
            Text("Lens preview quality", style = HxType.Label, color = Hx.Text2)
            Spacer(Modifier.height(8.dp))
            Capsule(LensQuality.entries.map { it to it.label }, prefs.lensQuality, { q -> app.prefs.update { it.copy(lensQuality = q) } })
            Text(if (prefs.lensQuality == LensQuality.SHARP) "600 px, about 5 updates a second" else "400 px, about 2-3 updates a second · lighter on Bluetooth",
              color = Hx.Muted, style = HxType.Label, modifier = Modifier.padding(top = 6.dp))
          }
        }
        Divider()
        PrefRow("Auto-capture", "Take the page photo automatically once it is aligned and steady", prefs.autoCapture) { v -> app.prefs.update { it.copy(autoCapture = v) } }
        Divider()
        PrefRow("Share live view", "Send the current screen and the scan camera to the control room", prefs.shareLive) { v -> app.prefs.update { it.copy(shareLive = v) } }
        Divider()
        PrefRow("“Hey Hydris” voice", "Start hands-free listening when you open Ask", prefs.heyHydris) { v -> app.prefs.update { it.copy(heyHydris = v) } }
      }

      // device actions
      SectionTitle("Device")
      HCard(Modifier.fillMaxWidth().appear(9)) {
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          HSecondaryButton({ confirm = "disconnect" }, Modifier.weight(1f), enabled = g.registered && busy == null) {
            Icon(Icons.Outlined.LinkOff, null, Modifier.size(18.dp)); Text("Disconnect", maxLines = 1)
          }
          HSecondaryButton({ confirm = "unregister" }, Modifier.weight(1f), enabled = registered && busy == null) {
            Icon(Icons.Outlined.SensorsOff, null, Modifier.size(18.dp)); Text("Unregister", maxLines = 1)
          }
        }
        Text("Disconnect removes Hydris from the Meta AI app. Unregister removes these glasses from your Hydris console; captures stay on this phone.",
          color = Hx.Muted, style = HxType.Label, modifier = Modifier.padding(top = 12.dp))
      }

      HelpCard(Modifier.appear(10)) {
        val launch = activity.packageManager.getLaunchIntentForPackage(GlassesManager.META_AI_PACKAGE)
        if (launch != null) activity.startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) else err = "The Meta AI app is not installed."
      }

      if (g.log.isNotEmpty()) LogCard(g.log)
      NavSpacer()
    }

    confirm?.let { what ->
      AlertDialog(
        onDismissRequest = { confirm = null },
        containerColor = Hx.Surface2, titleContentColor = Hx.Text, textContentColor = Hx.Text2, shape = HxShape.Xl,
        title = { Text(if (what == "disconnect") "Disconnect from Meta AI?" else "Unregister from Hydris?", style = HxType.Section) },
        text = {
          Text(if (what == "disconnect") "Hydris will no longer reach the glasses' camera, microphone or display. You can connect again at any time."
          else "The glasses disappear from your Hydris console and new scans are no longer attributed to them. Captures stay on this phone.")
        },
        confirmButton = {
          TextButton({
            confirm = null
            if (what == "disconnect") { app.glasses.endSession(); app.glasses.disconnect(activity) }
            else act("unregister") { app.repo.unregisterGlasses(); registered = false; note = "Unregistered from Hydris." }
          }) { Text(if (what == "disconnect") "Disconnect" else "Unregister", color = Hx.CriticalText, fontWeight = FontWeight.SemiBold) }
        },
        dismissButton = { TextButton({ confirm = null }) { Text("Cancel", color = Hx.Text2) } },
      )
    }
  }
}

private fun testMic(app: HydrisApp, act: (String, suspend () -> Unit) -> Any, ok: (String) -> Unit, fail: (String?) -> Unit) {
  act("mic") {
    if (app.glasses.startSpeech()) { ok("Glasses microphone is listening."); delay(2500) } else fail(app.glasses.state.value.lastError)
    app.glasses.stopSpeech()
  }
}

private fun showLensTest(app: HydrisApp, act: (String, suspend () -> Unit) -> Any, ok: (String) -> Unit, fail: (String?) -> Unit) {
  act("lens") {
    if (app.glasses.ensureLens()) {
      app.glasses.display.showTestCard(); ok("Test card sent to the lens.")
      delay(6000); app.glasses.display.showIdle()
    } else fail(app.glasses.state.value.lastError ?: "The lens display is not available on these glasses.")
  }
}

// ------------------------------------------------------------------ hero

@Composable
private fun HeroCard(g: GlassesState, look: GlassesLook, lens: String, registered: Boolean, consoleName: String?, modifier: Modifier) {
  Column(
    modifier.fillMaxWidth().clip(HxShape.Xl)
      .drawBehind {
        drawRect(Hx.Surface)
        drawRect(Brush.radialGradient(listOf((if (look == GlassesLook.Connected) Hx.Signal else Hx.Surface3).copy(alpha = 0.42f), Color.Transparent),
          center = Offset(size.width * 0.7f, size.height * 0.18f), radius = size.width * 0.8f))
      }
      .sheen(HxShape.Xl, Color(0x14FFFFFF)).border(1.dp, Hx.Line, HxShape.Xl).padding(20.dp),
  ) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Eyebrow(g.deviceModel ?: "Smart glasses", modifier = Modifier.weight(1f))
      StatusChip(when (look) { GlassesLook.Connected -> "Connected"; GlassesLook.Linked -> "Linked"; else -> "Not connected" },
        when (look) { GlassesLook.Connected -> Hx.Ok; GlassesLook.Linked -> Hx.Medium; else -> Hx.Muted })
    }
    GlassesArt(look, Modifier.fillMaxWidth().padding(vertical = 14.dp, horizontal = 4.dp),
      description = "Glasses illustration, ${look.name.lowercase()}")
    Text(g.deviceName ?: if (g.registered) "Waiting for glasses" else "Connect your glasses", style = HxType.Page.copy(fontSize = 26.sp, lineHeight = 30.sp))
    val sub = listOfNotNull(g.deviceModel, g.firmware?.let { "Firmware $it" }).joinToString(" · ")
    if (sub.isNotEmpty()) Text(sub, color = Hx.Muted, style = HxType.Label, modifier = Modifier.padding(top = 4.dp), maxLines = 2, overflow = TextOverflow.Ellipsis)

    // DAT-reported vitals only
    val vitals = buildList<@Composable () -> Unit> {
      g.battery?.let { b -> add { Vital(if (g.charging == true) Icons.Outlined.BatteryChargingFull else Icons.Outlined.BatteryFull, "$b%", if (g.charging == true) "Charging" else "Battery", if (b <= 15) Hx.High else Hx.Text) } }
      g.worn?.let { w -> add { Vital(Icons.Outlined.Visibility, if (w) "On" else "Off", "Worn", Hx.Text) } }
      g.hingeOpen?.let { h -> add { Vital(Icons.Outlined.RadioButtonChecked, if (h) "Open" else "Folded", "Hinge", Hx.Text) } }
      g.thermal?.let { t -> add { Vital(Icons.Outlined.Memory, label(t), "Thermal", Hx.High) } }
    }
    if (vitals.isNotEmpty()) {
      Spacer(Modifier.height(16.dp))
      Row(Modifier.fillMaxWidth().clip(HxShape.Lg).background(Hx.Bg2.copy(alpha = 0.7f)).border(1.dp, Hx.Line, HxShape.Lg).padding(vertical = 12.dp)) {
        vitals.forEachIndexed { i, v ->
          Box(Modifier.weight(1f), contentAlignment = Alignment.Center) { v() }
          if (i < vitals.lastIndex) Box(Modifier.width(1.dp).height(34.dp).background(Hx.Line).align(Alignment.CenterVertically))
        }
      }
    }
    Spacer(Modifier.height(14.dp))
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      StatusChip("Meta link · ${label(g.registration.lowercase())}", if (g.registered) Hx.Ok else Hx.Muted)
      StatusChip("Session · ${label(g.session.lowercase())}", if (g.session.equals("started", true)) Hx.Ok else Hx.Muted)
      if (registered) StatusChip("In Hydris console", Hx.Signal) else StatusChip("Not in console", Hx.Muted)
      g.compatibility?.takeIf { !it.equals("compatible", true) }?.let { StatusChip(it, Hx.High) }
    }
    if (registered && consoleName != null) Text("Registered as “$consoleName”", color = Hx.Muted, style = HxType.Label, modifier = Modifier.padding(top = 10.dp))
  }
}

@Composable
private fun Vital(icon: ImageVector, value: String, caption: String, color: Color) {
  Column(horizontalAlignment = Alignment.CenterHorizontally) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Icon(icon, null, tint = color, modifier = Modifier.size(16.dp))
      Text(value, color = color, fontSize = 15.sp, fontWeight = FontWeight.Medium, style = HxType.Num, modifier = Modifier.padding(start = 6.dp))
    }
    Text(caption, color = Hx.Muted, fontSize = 11.5.sp)
  }
}

/** Status chip whose text and colour cross-fade when the state changes. */
@Composable
private fun StatusChip(text: String, color: Color) {
  val reduced = LocalReducedMotion.current
  val c by animateColorAsState(color, tween(if (reduced) 0 else HxMotion.Base), label = "chip")
  Row(
    Modifier.height(28.dp).clip(HxShape.Pill).background(c.copy(alpha = 0.12f)).border(1.dp, c.copy(alpha = 0.38f), HxShape.Pill).padding(horizontal = 11.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Dot(c, 6.dp, pulse = color == Hx.Ok)
    AnimatedContent(text, transitionSpec = { fadeIn(tween(if (reduced) 0 else HxMotion.Base)) togetherWith fadeOut(tween(if (reduced) 0 else HxMotion.Fast)) }, label = "chipText") { t ->
      Text(t, color = if (color == Hx.Muted) Hx.Text2 else Hx.Text, fontSize = 12.5.sp, fontWeight = FontWeight.Medium, maxLines = 1, modifier = Modifier.padding(start = 7.dp))
    }
  }
}

// ------------------------------------------------------------------ status tiles

@Composable
private fun StatusTile(icon: ImageVector, title: String, state: String, color: Color, action: String, modifier: Modifier, enabled: Boolean, onAction: () -> Unit) {
  HCard(modifier.fillMaxHeight(), padding = 16.dp) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Box(Modifier.size(38.dp).clip(CircleShape).background(Hx.Surface2).border(1.dp, Hx.Line, CircleShape), contentAlignment = Alignment.Center) {
        Icon(icon, null, tint = Hx.Text, modifier = Modifier.size(19.dp))
      }
      Spacer(Modifier.weight(1f))
      Dot(color, 8.dp, pulse = color == Hx.Ok)
    }
    Text(title, style = HxType.Label, color = Hx.Muted, modifier = Modifier.padding(top = 14.dp))
    val reduced = LocalReducedMotion.current
    AnimatedContent(state, transitionSpec = { fadeIn(tween(if (reduced) 0 else HxMotion.Base)) togetherWith fadeOut(tween(if (reduced) 0 else HxMotion.Fast)) }, label = "tile") { s ->
      Text(s, style = HxType.Card.copy(fontSize = 18.sp), maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    Spacer(Modifier.weight(1f).height(12.dp))
    Text(action, color = if (enabled) Hx.Accent else Hx.Muted, fontSize = 13.5.sp, fontWeight = FontWeight.Medium,
      modifier = Modifier.padding(top = 12.dp).pressable(enabled, onClick = onAction))
  }
}

@Composable
private fun CaptureButtonTile(enabled: Boolean, busy: Boolean, flash: Int, modifier: Modifier, onCapture: () -> Unit) {
  val reduced = LocalReducedMotion.current
  var pulse by remember { mutableStateOf(false) }
  LaunchedEffect(flash) { if (flash > 0 && !reduced) { pulse = true; delay(220); pulse = false } }
  val ring by animateFloatAsState(if (pulse) 1.12f else 1f, tween(220, easing = HxMotion.EaseOut), label = "ring")
  HCard(modifier.fillMaxWidth(), padding = 16.dp) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Column(Modifier.weight(1f)) {
        Text("Capture button", style = HxType.Label, color = Hx.Muted)
        Text(if (busy) "Capturing…" else if (enabled) "Ready" else "Connect first", style = HxType.Card.copy(fontSize = 18.sp))
        Text("A short press on the glasses takes a photo while this tab is open; in Scan it captures the page.", color = Hx.Muted, style = HxType.Label, modifier = Modifier.padding(top = 4.dp))
      }
      Box(
        Modifier.padding(start = 12.dp).size(64.dp).graphicsLayer { scaleX = ring; scaleY = ring }.clip(CircleShape)
          .border(3.dp, if (enabled) Color.White else Hx.Line2, CircleShape).padding(6.dp).clip(CircleShape)
          .background(if (enabled) Hx.Signal else Hx.Surface3).pressable(enabled && !busy, 0.9f, onClick = onCapture),
        contentAlignment = Alignment.Center,
      ) { Icon(Icons.Outlined.PhotoCamera, "Take photo", tint = Color.White, modifier = Modifier.size(22.dp)) }
    }
  }
}

// ------------------------------------------------------------------ captures preview

@Composable
fun CaptureThumb(c: Capture, modifier: Modifier = Modifier, onClick: () -> Unit) {
  val app = LocalContext.current.applicationContext as HydrisApp
  val bmp by produceState<Bitmap?>(null, c.id) { value = app.captures.thumbnail(c) }
  Box(modifier.aspectRatio(1f).clip(HxShape.Md).background(Hx.Surface2).border(1.dp, Hx.Line, HxShape.Md).pressable(scale = 0.96f, onClick = onClick)) {
    bmp?.let { Image(it.asImageBitmap(), "Capture", Modifier.fillMaxSize().sharedCapture(c.id), contentScale = ContentScale.Crop) }
    if (c.type == "scan" || c.auditDocId != null) {
      Box(Modifier.align(Alignment.BottomStart).padding(6.dp).clip(HxShape.Pill).background(Hx.Bg.copy(alpha = 0.72f)).padding(horizontal = 8.dp, vertical = 3.dp)) {
        Text(if (c.auditDocId != null) "Audit" else "Scan", fontSize = 10.5.sp, color = Color.White, fontWeight = FontWeight.Medium)
      }
    }
  }
}

@Composable
private fun CaptureGrid(items: List<Capture>, modifier: Modifier, onOpen: (Capture) -> Unit) {
  Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    items.chunked(3).forEach { row ->
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        row.forEach { c -> CaptureThumb(c, Modifier.weight(1f)) { onOpen(c) } }
        repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
      }
    }
    items.firstOrNull()?.let { Text("Latest · ${SimpleDateFormat("d MMM, HH:mm", Locale.getDefault()).format(Date(it.takenAt))}", color = Hx.Muted, style = HxType.Label) }
  }
}

// ------------------------------------------------------------------ setup stepper

@Composable
private fun SetupStepper(
  g: GlassesState, registered: Boolean, done: Boolean, busy: String?, modifier: Modifier,
  onConnect: () -> Unit, onTestCamera: () -> Unit, onTestMic: () -> Unit, onRegister: () -> Unit,
) {
  var expanded by remember(done) { mutableStateOf(!done) }
  val reduced = LocalReducedMotion.current
  val rot by animateFloatAsState(if (expanded) 180f else 0f, tween(if (reduced) 0 else HxMotion.Base), label = "chev")
  val steps = listOf(g.registered, g.cameraStreaming || g.speech == "listening" || done, registered)
  HCard(modifier.fillMaxWidth(), accent = if (done) Hx.OkFill else null) {
    Row(Modifier.fillMaxWidth().pressable(scale = 0.99f) { expanded = !expanded }, verticalAlignment = Alignment.CenterVertically) {
      Column(Modifier.weight(1f)) {
        Text(if (done) "Setup complete" else "Connect in three steps", style = HxType.Card)
        Text("${steps.count { it }} of 3 done", color = Hx.Muted, style = HxType.Label)
      }
      // progress segments
      Row(horizontalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(end = 10.dp)) {
        steps.forEach { s -> Box(Modifier.size(18.dp, 4.dp).clip(HxShape.Pill).background(if (s) Hx.Signal else Hx.Surface3)) }
      }
      Icon(Icons.Outlined.ExpandMore, if (expanded) "Collapse" else "Expand", tint = Hx.Text2, modifier = Modifier.graphicsLayer { rotationZ = rot })
    }
    AnimatedVisibility(expanded, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
      Column(Modifier.padding(top = 16.dp)) {
        Step(1, "Link with the Meta AI app", if (g.registered) "Linked. Hydris can reach your glasses." else "Opens the Meta AI app to approve Hydris. Keep it installed - it manages pairing and updates.", steps[0], false) {
          if (!g.registered) HButton(onConnect) { Text("Connect glasses") }
        }
        Step(2, "Allow camera and microphone", "Approved in the Meta AI app the first time Hydris uses them. Test them here.", steps[1], false) {
          Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            HSecondaryButton(onTestCamera, enabled = g.registered && busy == null) { Text(if (busy == "camera") "Testing…" else "Test camera") }
            HSecondaryButton(onTestMic, enabled = g.registered && busy == null) { Text(if (busy == "mic") "Testing…" else "Test mic") }
          }
        }
        Step(3, "Register in the Hydris console", if (registered) "Registered. Supervisors see the glasses under Field glasses; scans are attributed to them." else "Adds these glasses to your organization so the console shows them.", steps[2], true) {
          if (!registered) HButton(onRegister, enabled = g.registered && busy == null) { Text(if (busy == "register") "Registering…" else "Register glasses") }
        }
      }
    }
  }
}

@Composable
private fun Step(n: Int, title: String, body: String, done: Boolean, last: Boolean, actions: @Composable () -> Unit) {
  val reduced = LocalReducedMotion.current
  val fill by animateColorAsState(if (done) Hx.Signal else Hx.Surface2, tween(if (reduced) 0 else HxMotion.Base), label = "step")
  Row(Modifier.height(IntrinsicSize.Min)) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
      Box(Modifier.size(30.dp).clip(CircleShape).background(fill).border(1.dp, if (done) Color.Transparent else Hx.Line2, CircleShape), contentAlignment = Alignment.Center) {
        if (done) Icon(Icons.Outlined.Check, null, tint = Color.White, modifier = Modifier.size(16.dp)) else Text("$n", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
      }
      if (!last) Box(Modifier.width(2.dp).weight(1f).padding(vertical = 4.dp).background(if (done) Hx.Signal.copy(alpha = 0.6f) else Hx.Line2))
    }
    Column(Modifier.padding(start = 14.dp, bottom = if (last) 0.dp else 18.dp).weight(1f)) {
      Text(title, style = HxType.Card.copy(fontSize = 15.5.sp), modifier = Modifier.padding(top = 4.dp))
      Text(body, color = Hx.Text2, fontSize = 13.5.sp, lineHeight = 19.sp, modifier = Modifier.padding(top = 4.dp, bottom = 10.dp))
      actions()
    }
  }
}

// ------------------------------------------------------------------ preferences, help, log

@Composable
private fun PrefRow(title: String, sub: String, checked: Boolean, onChange: (Boolean) -> Unit) {
  Row(Modifier.fillMaxWidth().pressable(scale = 0.99f) { onChange(!checked) }.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
    Column(Modifier.weight(1f).padding(end = 12.dp)) {
      Text(title, fontSize = 15.sp, fontWeight = FontWeight.Medium)
      Text(sub, color = Hx.Muted, style = HxType.Label)
    }
    Switch(checked, onChange, colors = SwitchDefaults.colors(checkedTrackColor = Hx.Signal, checkedThumbColor = Color.White, uncheckedTrackColor = Hx.Surface2, uncheckedThumbColor = Hx.Muted, uncheckedBorderColor = Hx.Line2))
  }
}

@Composable
private fun ColumnScope.Divider() = Box(Modifier.padding(horizontal = 14.dp).fillMaxWidth().height(1.dp).background(Hx.Line))

@Composable
private fun HelpCard(modifier: Modifier, onOpenMetaAi: () -> Unit) {
  HCard(modifier.fillMaxWidth()) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Icon(Icons.Outlined.HelpOutline, null, tint = Hx.Accent, modifier = Modifier.size(20.dp))
      Text("If the glasses don't respond", style = HxType.Card, modifier = Modifier.padding(start = 10.dp))
    }
    Spacer(Modifier.height(10.dp))
    listOf(
      "Wear the glasses, or unfold them - folded glasses go to sleep and refuse a session.",
      "Keep the Meta AI app installed and the glasses showing Connected in it; Hydris reaches them through it.",
      "For this test build, Developer Mode must be on for the glasses in the Meta AI app.",
      "Still stuck: Disconnect below, then Connect again to re-approve Hydris.",
    ).forEach {
      Row(Modifier.padding(vertical = 5.dp), verticalAlignment = Alignment.Top) {
        Box(Modifier.padding(top = 7.dp).size(6.dp).clip(CircleShape).background(Hx.Signal))
        Text(it, color = Hx.Text2, fontSize = 14.sp, lineHeight = 20.sp, modifier = Modifier.padding(start = 12.dp))
      }
    }
    Spacer(Modifier.height(12.dp))
    HSecondaryButton(onOpenMetaAi) { Icon(Icons.Outlined.OpenInNew, null, Modifier.size(17.dp)); Text("Open Meta AI app") }
  }
}

@Composable
private fun LogCard(log: List<String>) {
  var open by remember { mutableStateOf(false) }
  HCard(Modifier.fillMaxWidth(), onClick = { open = !open }) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Eyebrow("Connection log", modifier = Modifier.weight(1f))
      Text(if (open) "Hide" else "Show", color = Hx.Accent, fontSize = 13.sp)
    }
    AnimatedVisibility(open) {
      Column(Modifier.padding(top = 8.dp)) { log.take(10).forEach { Text(it, color = Hx.Muted, style = HxType.Label) } }
    }
  }
}
