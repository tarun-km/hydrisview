package ai.hydris.field.ui.screens

import ai.hydris.field.HydrisApp
import ai.hydris.field.MainActivity
import ai.hydris.field.data.Answer
import ai.hydris.field.data.Turn
import ai.hydris.field.ui.components.Chip
import ai.hydris.field.ui.LocalNavPadding
import ai.hydris.field.ui.components.Dot
import ai.hydris.field.ui.components.EmptyState
import ai.hydris.field.ui.components.HIconButton
import ai.hydris.field.ui.components.appear
import ai.hydris.field.ui.components.fieldColors
import ai.hydris.field.ui.components.pressable
import ai.hydris.field.ui.theme.HxShape
import ai.hydris.field.ui.theme.HxType
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material3.SwitchDefaults
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.sp

import ai.hydris.field.ui.components.Eyebrow
import ai.hydris.field.ui.theme.Hx
import ai.hydris.field.voice.VoiceEngine
import android.Manifest
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.MicOff
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/** "Hey Hydris": wake phrase, tolerant of common recognition spellings (same as packages/domain/src/voice.ts). */
private val WAKE = Regex("""\b(?:hey|hi|hay|ok|okay|a)[\s,]+(?:hydris|hydras|hydrus|hydrous|high\s?dris|hi\s?dris|hydra|idris)\b""", RegexOption.IGNORE_CASE)
private val STOP = Regex("""^(stop|cancel|thanks|thank you|never ?mind|that's all|bye)\b""", RegexOption.IGNORE_CASE)
fun afterWake(text: String): String? = WAKE.find(text)?.let { text.substring(it.range.last + 1).trim(' ', ',', '.', '!', '?') }

private data class Msg(val mine: Boolean, val text: String, val answer: Answer? = null)

@Composable
fun AskScreen(activity: MainActivity) {
  val app = LocalContext.current.applicationContext as HydrisApp
  val voice = app.voice
  val source by voice.source.collectAsState()
  val listening by voice.listening.collectAsState()
  val msgs = remember { mutableStateListOf<Msg>() }
  var input by remember { mutableStateOf("") }
  var heard by remember { mutableStateOf("") }
  var wake by remember { mutableStateOf(app.prefs.value.heyHydris) }
  var awaiting by remember { mutableStateOf(false) } // after the wake phrase / in follow-up window
  var thinking by remember { mutableStateOf(false) }
  val list = rememberLazyListState()
  val scope = rememberCoroutineScope()

  fun ask(q: String) = scope.launch {
    if (q.isBlank()) return@launch
    if (STOP.containsMatchIn(q.trim())) { awaiting = false; heard = ""; return@launch }
    msgs.add(Msg(true, q)); heard = ""; thinking = true
    val history = msgs.dropLast(1).takeLast(6).map { Turn(if (it.mine) "user" else "assistant", it.text) }
    val a = runCatching { app.repo.ask(q, history) }.getOrElse { Answer("Sorry, I couldn't get that answer (${it.message}).", "error", "none") }
    msgs.add(Msg(false, a.answer, a)); thinking = false
    list.animateScrollToItem(msgs.size)
    if (wake) { voice.speak(a.answer); awaiting = true }
  }

  // Wake word state machine on the transcript stream (glasses mic or phone mic).
  LaunchedEffect(wake) {
    if (!wake) { voice.stop(); return@LaunchedEffect }
    if (voice.source.value != VoiceEngine.Source.Glasses && !activity.ensurePhonePermission(Manifest.permission.RECORD_AUDIO)) { wake = false; return@LaunchedEffect }
    voice.start()
    voice.transcripts.collect { (text, final) ->
      val q = afterWake(text)
      when {
        !awaiting && q == null -> Unit
        !awaiting && q != null -> if (final && q.length > 2) ask(q) else { awaiting = true; heard = q }
        else -> { val clean = q ?: text; heard = clean; if (final && clean.length > 1) ask(clean) }
      }
    }
  }

  val navPad = LocalNavPadding.current
  val ime = WindowInsets.ime.asPaddingValues().calculateBottomPadding()
  Column(Modifier.fillMaxSize().statusBarsPadding().padding(horizontal = 16.dp).padding(bottom = maxOf(navPad, ime + 8.dp))) {
    Row(Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 8.dp).appear(), verticalAlignment = Alignment.CenterVertically) {
      Column(Modifier.weight(1f)) {
        Eyebrow("Answers from your live plant data")
        Spacer(Modifier.height(10.dp))
        Text("Hydris", style = HxType.Page)
      }
      Column(horizontalAlignment = Alignment.End) {
        Switch(wake, { wake = it; app.prefs.update { p -> p.copy(heyHydris = it) } }, colors = SwitchDefaults.colors(checkedTrackColor = Hx.Signal, checkedThumbColor = Color.White, uncheckedTrackColor = Hx.Surface2, uncheckedThumbColor = Hx.Muted, uncheckedBorderColor = Hx.Line2))
        Row(verticalAlignment = Alignment.CenterVertically) {
          if (wake && listening) { Dot(Hx.Ok, 6.dp, pulse = true); Spacer(Modifier.width(6.dp)) }
          Text(if (!wake) "Hey Hydris off" else if (listening) "${if (source == VoiceEngine.Source.Glasses) "glasses mic" else "phone mic"}" else "starting…", color = Hx.Muted, style = MaterialTheme.typography.bodySmall)
        }
      }
    }
    LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = list, verticalArrangement = Arrangement.spacedBy(10.dp)) {
      if (msgs.isEmpty()) item {
        Column(Modifier.padding(vertical = 12.dp)) {
          EmptyState("Ask Hydris", "Ask about readings, alarms, your work or an asset. Turn on “Hey Hydris” to talk hands-free - through the glasses microphone when they're connected.", Icons.Outlined.AutoAwesome)
        }
      }
      items(msgs) { m ->
        Row(Modifier.fillMaxWidth().appear(), horizontalArrangement = if (m.mine) Arrangement.End else Arrangement.Start) {
          val shape = if (m.mine) RoundedCornerShape(20.dp, 20.dp, 6.dp, 20.dp) else RoundedCornerShape(20.dp, 20.dp, 20.dp, 6.dp)
          Column(Modifier.widthIn(max = 320.dp).clip(shape).background(if (m.mine) Hx.Signal else Hx.Surface).border(1.dp, if (m.mine) Color.Transparent else Hx.Line, shape).padding(14.dp)) {
            Text(m.text, color = if (m.mine) Color.White else Hx.Text, fontSize = 15.sp, lineHeight = 21.sp)
            m.answer?.takeIf { it.facts.isNotEmpty() }?.let { a ->
              Spacer(Modifier.height(8.dp))
              a.facts.take(4).forEach { f -> Text("${f.value}${f.unit?.takeIf { it != "pH" }?.let { " $it" } ?: ""} · ${f.label}", color = Hx.Text2, style = MaterialTheme.typography.bodySmall) }
              Text(if (a.engine == "hydris-rules") "from live data" else a.engine, color = Hx.Muted, style = MaterialTheme.typography.bodySmall)
            }
          }
        }
      }
      if (thinking) item { Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) { Dot(Hx.Purple, 8.dp, pulse = true); Text("  Checking your plant data…", color = Hx.Muted) } }
      if (awaiting && heard.isNotBlank()) item { Text("“$heard”", color = Hx.Accent, modifier = Modifier.padding(8.dp)) }
    }
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(vertical = 8.dp)) {
      items(listOf("What is the current pH?", "Any open alarms?", "What are my tasks?", "Dissolved oxygen", "Status of P-101")) { q ->
        Chip(q, Hx.Text2, modifier = Modifier.pressable { ask(q) })
      }
    }
    Row(Modifier.padding(bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
      OutlinedTextField(input, { input = it }, Modifier.weight(1f), placeholder = { Text("Ask Hydris…", fontSize = 15.sp) }, singleLine = true, shape = HxShape.Pill, colors = fieldColors(),
        textStyle = MaterialTheme.typography.bodyLarge)
      Spacer(Modifier.width(8.dp))
      HIconButton(Icons.AutoMirrored.Outlined.Send, "Send", { val q = input; input = ""; ask(q) }, size = 52.dp, variant = "brand")
      Spacer(Modifier.width(8.dp))
      HIconButton(if (wake) Icons.Outlined.Mic else Icons.Outlined.MicOff, "Talk", { if (!wake) wake = true; awaiting = true; heard = "" }, size = 52.dp, tint = if (wake) Hx.Accent else Hx.Muted)
    }
  }
}
