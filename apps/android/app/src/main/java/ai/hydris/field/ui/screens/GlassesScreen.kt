package ai.hydris.field.ui.screens

import ai.hydris.field.HydrisApp
import ai.hydris.field.MainActivity
import ai.hydris.field.ui.components.Chip
import ai.hydris.field.ui.components.Dot
import ai.hydris.field.ui.components.ErrorNote
import ai.hydris.field.ui.components.Eyebrow
import ai.hydris.field.ui.components.HCard
import ai.hydris.field.ui.theme.Hx
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/**
 * One place to connect Ray-Ban Meta glasses to Hydris:
 *  1. Meta AI app link (DAT registration - the Meta AI app must stay installed; it owns pairing and firmware)
 *  2. Glasses permissions (camera, microphone - approved in the Meta AI app)
 *  3. Register the glasses as a Hydris device so the console shows them and attributes their scans.
 */
@Composable
fun GlassesScreen(activity: MainActivity) {
  val app = LocalContext.current.applicationContext as HydrisApp
  val g by app.glasses.state.collectAsState()
  var registered by remember { mutableStateOf(app.api.hasDevice()) }
  var busy by remember { mutableStateOf<String?>(null) }
  var err by remember { mutableStateOf<String?>(null) }
  var note by remember { mutableStateOf<String?>(null) }
  val scope = rememberCoroutineScope()

  fun act(label: String, block: suspend () -> Unit) = scope.launch {
    busy = label; err = null; note = null
    runCatching { block() }.onFailure { err = it.message }
    busy = null
  }

  Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
    Eyebrow("Ray-Ban Meta · Meta Wearables Device Access Toolkit", Hx.SignalText)
    Text("Glasses", style = MaterialTheme.typography.headlineSmall)
    HCard(accent = if (g.registered) Hx.OkSoft else null) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Dot(if (g.registered && g.devices.isNotEmpty()) Hx.Ok else if (g.registered) Hx.Medium else Hx.Muted, 12.dp)
        Column(Modifier.padding(start = 12.dp).weight(1f)) {
          Text(g.deviceName ?: if (g.registered) "Waiting for glasses" else "Not connected", style = MaterialTheme.typography.titleLarge)
          Text("Meta link: ${g.registration.lowercase()} · session: ${g.session.lowercase()}", color = Hx.Muted, style = MaterialTheme.typography.bodySmall)
        }
      }
      Spacer(Modifier.height(10.dp))
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Chip(if (g.cameraStreaming) "camera live" else "camera idle", if (g.cameraStreaming) Hx.OkSoft else Hx.Text2)
        Chip("mic ${g.speech}", if (g.speech == "listening") Hx.OkSoft else Hx.Text2)
        Chip(if (registered) "in Hydris console" else "not registered", if (registered) Hx.SignalText else Hx.Text2)
      }
    }

    note?.let { Text(it, color = Hx.OkSoft) }
    (err ?: g.lastError)?.let { ErrorNote(it) }
    Step(1, "Link with the Meta AI app", if (g.registered) "Linked. Hydris can reach your glasses." else "Opens the Meta AI app to approve Hydris. Keep the Meta AI app installed - it manages glasses pairing and updates.", g.registered) {
      if (!g.registered) Button({ if (!g.initialized) app.glasses.initialize(); app.glasses.connect(activity) }, colors = ButtonDefaults.buttonColors(containerColor = Hx.Signal)) { Text("Connect glasses") }
      else OutlinedButton({ app.glasses.disconnect(activity) }) { Text("Disconnect") }
    }
    Step(2, "Allow camera and microphone", "Approved in the Meta AI app the first time you scan or say “Hey Hydris”. Test them here.", g.cameraStreaming || g.speech == "listening") {
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton({ act("camera") { if (app.glasses.startPreview()) note = "Glasses camera is streaming." else err = app.glasses.state.value.lastError; app.glasses.stopPreview() } }, enabled = g.registered && busy == null) { Text(if (busy == "camera") "Testing…" else "Test camera") }
        OutlinedButton({ act("mic") { if (app.glasses.startSpeech()) note = "Glasses microphone is listening." else err = app.glasses.state.value.lastError; app.glasses.stopSpeech() } }, enabled = g.registered && busy == null) { Text(if (busy == "mic") "Testing…" else "Test microphone") }
      }
    }
    Step(3, "Register in the Hydris console", if (registered) "Registered as “${app.api.deviceName ?: "Ray-Ban Meta"}”. Supervisors see it under Field glasses; scans are attributed to it." else "Adds these glasses to your organization so the console shows them and attributes their scans.", registered) {
      if (!registered) Button({
        act("register") {
          val hw = app.glasses.hardwareId() ?: throw IllegalStateException("Connect the glasses first (step 1)")
          app.repo.registerGlasses(hw, g.deviceName ?: "Ray-Ban Meta", "Ray-Ban Meta")
          registered = true; note = "Registered - your glasses now appear in the console."
        }
      }, enabled = g.registered && busy == null, colors = ButtonDefaults.buttonColors(containerColor = Hx.Signal)) { Text(if (busy == "register") "Registering…" else "Register glasses") }
      else OutlinedButton({ act("unregister") { app.repo.unregisterGlasses(); registered = false } }, enabled = busy == null) { Text("Unregister") }
    }

    HCard {
      Eyebrow("What the glasses do in Hydris")
      Spacer(Modifier.height(6.dp))
      listOf(
        "Audit scan: look at an A4 record - guided framing, auto-capture, on-phone OCR.",
        "Capture button: a short press takes the page photo.",
        "Hey Hydris: ask for readings, alarms or tasks; answers play on the glasses speakers.",
        "Alarms: critical alarms on your sites notify this phone in real time.",
      ).forEach { Text("•  $it", color = Hx.Text2, modifier = Modifier.padding(vertical = 3.dp)) }
    }
    if (g.log.isNotEmpty()) HCard { Eyebrow("Connection log"); g.log.take(8).forEach { Text(it, color = Hx.Muted, style = MaterialTheme.typography.bodySmall) } }
  }
}

@Composable
private fun Step(n: Int, title: String, body: String, done: Boolean, actions: @Composable () -> Unit) {
  HCard {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Text("$n", fontWeight = FontWeight.SemiBold, color = if (done) Hx.Midnight else Hx.Text,
        modifier = Modifier.size(28.dp).clip(CircleShape).background(if (done) Hx.Ok else Hx.Surface2).padding(top = 4.dp), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
      Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 12.dp))
    }
    Text(body, color = Hx.Text2, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(vertical = 10.dp))
    actions()
  }
}

@Suppress("unused") private val keep = Modifier.fillMaxWidth()
