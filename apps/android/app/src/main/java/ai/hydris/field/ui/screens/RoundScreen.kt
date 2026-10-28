package ai.hydris.field.ui.screens

import ai.hydris.field.HydrisApp
import ai.hydris.field.MainActivity
import ai.hydris.field.data.InspectionEnvelope
import ai.hydris.field.data.OutboxEntry
import ai.hydris.field.data.Step
import ai.hydris.field.ui.components.BackButton
import ai.hydris.field.ui.components.Chip
import ai.hydris.field.ui.components.ErrorNote
import ai.hydris.field.ui.components.Eyebrow
import ai.hydris.field.ui.components.HButton
import ai.hydris.field.ui.components.HCard
import ai.hydris.field.ui.components.HField
import ai.hydris.field.ui.components.HSecondaryButton
import ai.hydris.field.ui.components.Loading
import ai.hydris.field.ui.components.NavSpacer
import ai.hydris.field.ui.components.OfflineBanner
import ai.hydris.field.ui.components.PaperCard
import ai.hydris.field.ui.components.ProgressBar
import ai.hydris.field.ui.components.appear
import ai.hydris.field.ui.components.label
import ai.hydris.field.ui.components.pressable
import ai.hydris.field.ui.theme.Hx
import ai.hydris.field.ui.theme.HxMotion
import ai.hydris.field.ui.theme.HxShape
import ai.hydris.field.ui.theme.HxType
import ai.hydris.field.ui.theme.LocalReducedMotion
import android.Manifest
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
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
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.CloudUpload
import androidx.compose.material.icons.outlined.TaskAlt
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import androidx.navigation.NavController
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

private val EDITABLE = setOf("scheduled", "in_progress", "paused", "rejected")

/** One step's answer as the operator sees it: from the server, or queued on this phone. */
private data class Answer(val value: JsonObject, val note: String?, val outcome: String, val queued: Boolean, val photoFile: String? = null)

/** Same rule as @hydris/domain stepOutcome, so progress and abnormal flags are right while offline. */
private fun outcome(step: Step, v: JsonObject): String = when (v["kind"]?.jsonPrimitive?.content) {
  "check" -> if (v["abnormal"]?.jsonPrimitive?.booleanOrNull == true || v["checked"]?.jsonPrimitive?.booleanOrNull != true) "abnormal" else "ok"
  "reading" -> {
    val x = v["value"]?.jsonPrimitive?.doubleOrNull
    if (x != null && ((step.expectedMin != null && x < step.expectedMin) || (step.expectedMax != null && x > step.expectedMax))) "abnormal" else "ok"
  }
  "choice" -> if (v["option"]?.jsonPrimitive?.content in step.abnormalOptions) "abnormal" else "ok"
  else -> "ok"
}

/**
 * Step-by-step round execution, offline first. Every answer is written to the outbox with a client op id
 * and replayed to `POST /inspections/:id/responses` (idempotent), exactly like the glasses app; start and
 * submit are queued the same way, so a round started without signal can be finished and submitted later.
 */
@Composable
fun RoundScreen(id: String, nav: NavController) {
  val app = LocalContext.current.applicationContext as HydrisApp
  val activity = LocalContext.current as? MainActivity
  val scope = rememberCoroutineScope()
  val reduced = LocalReducedMotion.current
  val entries by app.outbox.entries.collectAsState()
  val glasses by app.glasses.state.collectAsState()
  val online by app.connectivity.online.collectAsState()
  var env by remember { mutableStateOf<InspectionEnvelope?>(app.outbox.cachedInspection(id)) }
  var cachedAt by remember { mutableStateOf<Long?>(null) }
  var loadError by remember { mutableStateOf<String?>(null) }
  val outboxRev by app.outbox.revision.collectAsState()

  LaunchedEffect(id, online) {
    runCatching { app.repo.inspection(id) }
      .onSuccess { env = it.value; cachedAt = it.cachedAt; loadError = null }
      .onFailure { if (env == null) loadError = it.message ?: "Could not load this round" }
  }
  // The replay updates the cached copy; pick it up.
  LaunchedEffect(outboxRev) { app.outbox.cachedInspection(id)?.let { env = it } }

  Column(Modifier.fillMaxSize().statusBarsPadding()) {
    val e = env
    Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
      BackButton { nav.popBackStack() }
      Spacer(Modifier.width(12.dp))
      Column(Modifier.weight(1f)) {
        Eyebrow("Round${e?.inspection?.asset?.let { " · ${it.tag}" } ?: ""}")
        Text(e?.inspection?.title ?: "Loading…", style = HxType.Card, maxLines = 2)
      }
    }
    if (e == null) {
      Box(Modifier.padding(16.dp)) { if (loadError != null) ErrorNote(loadError!!) else Loading() }
      return@Column
    }
    val insp = e.inspection
    val mine = entries.filter { it.inspectionId == id }
    val pending = mine.filter { it.state == "pending" }
    val conflicts = mine.filter { it.state == "conflict" }
    val answers: Map<String, Answer> = remember(insp, mine) {
      val m = insp.responses.mapValues { (_, r) -> Answer(r.value, r.note, r.outcome, false) }.toMutableMap()
      pending.filter { it.kind == "response" }.sortedBy { it.recordedAt }.forEach { p ->
        val step = insp.steps.firstOrNull { it.id == p.stepId } ?: return@forEach
        m[p.stepId!!] = Answer(p.value!!, p.note, outcome(step, p.value), true, p.photoFile)
      }
      m
    }
    val submitQueued = pending.any { it.action == "submit" }
    val startQueued = pending.any { it.action == "start" }
    val editable = insp.status in EDITABLE && !submitQueued
    val required = insp.steps.filter { it.required }
    val requiredDone = required.count { answers.containsKey(it.id) }
    val abnormal = insp.steps.count { answers[it.id]?.outcome == "abnormal" }
    val complete = requiredDone == required.size

    // Progress header.
    Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Text("${answers.size} of ${insp.steps.size} steps", color = Hx.Text2, fontSize = 13.5.sp, modifier = Modifier.weight(1f))
        if (abnormal > 0) Chip("$abnormal abnormal", Hx.High)
        Spacer(Modifier.width(6.dp))
        Chip(if (submitQueued) "Submit queued" else label(insp.status), if (insp.status == "submitted" || insp.status == "approved") Hx.OkFill else Hx.Text2)
      }
      Spacer(Modifier.height(8.dp))
      ProgressBar(if (insp.steps.isEmpty()) 0f else answers.size.toFloat() / insp.steps.size, if (abnormal > 0) Hx.High else Hx.Signal)
    }

    val firstOpen = insp.steps.indexOfFirst { !answers.containsKey(it.id) }.let { if (it < 0) insp.steps.size else it }
    var index by rememberSaveable(id) { mutableStateOf(-1) }
    var started by rememberSaveable(id) { mutableStateOf(false) }
    val notStarted = insp.status == "scheduled" && !startQueued && answers.isEmpty() && !started
    if (index < 0) index = firstOpen.coerceAtMost(insp.steps.size)
    var confirmSubmit by remember { mutableStateOf(false) }

    Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
      OfflineBanner(cachedAt = cachedAt)
      conflicts.forEach { c -> ConflictCard(c, insp.steps.firstOrNull { it.id == c.stepId }?.title) { app.outbox.discard(c.id) } }
      when {
        submitQueued || insp.status == "submitted" || insp.status == "approved" -> DoneCard(submitQueued, insp.status, abnormal, online) { nav.popBackStack() }
        !editable -> HCard(Modifier.fillMaxWidth()) { Text("This round is ${label(insp.status).lowercase()}.", style = HxType.Card); Text("It can no longer be changed from the phone.", color = Hx.Muted, style = HxType.Label) }
        notStarted -> StartCard(insp.safetyNotices, insp.steps.size, insp.reviewNote) {
          app.outbox.queueAction(id, "start"); app.sync(); started = true; index = 0
        }
        else -> {
          if (insp.status == "rejected" && insp.reviewNote != null) ReturnedNote(insp.reviewNote)
          StepStrip(insp.steps, answers, index) { index = it }
          Spacer(Modifier.height(12.dp))
          if (index >= insp.steps.size) {
            ReviewCard(insp.steps, answers, complete, required.size - requiredDone) { confirmSubmit = true }
          } else {
            AnimatedContent(
              index, label = "step",
              transitionSpec = {
                if (reduced) fadeIn(tween(0)) togetherWith fadeOut(tween(0))
                else {
                  val dir = if (targetState > initialState) 1 else -1
                  (fadeIn(tween(HxMotion.Base)) + slideInHorizontally(tween(HxMotion.Base, easing = HxMotion.EaseOut)) { it / 10 * dir }) togetherWith
                    (fadeOut(tween(HxMotion.Fast)) + slideOutHorizontally(tween(HxMotion.Base, easing = HxMotion.EaseOut)) { -it / 10 * dir })
                }
              },
            ) { i ->
              val step = insp.steps[i]
              StepCard(
                step, i, insp.steps.size, answers[step.id], glassesReady = glasses.registered,
                onAnswer = { value, note, photo ->
                  app.outbox.recordStep(id, step.id, value, note, photo)
                  app.sync()
                  index = (i + 1).coerceAtMost(insp.steps.size)
                },
                newPhotoFile = { app.outbox.newPhotoFile() },
                ensureCamera = { activity?.ensurePhonePermission(Manifest.permission.CAMERA) ?: false },
                glassesPhoto = { file ->
                  val bmp = app.glasses.capturePhoto()
                  runCatching { app.captures.save(bmp, "photo", glasses.deviceName) }
                  withContext(Dispatchers.IO) { writeScaled(bmp, file) }
                },
              )
            }
          }
          Spacer(Modifier.height(14.dp))
          Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            HSecondaryButton({ index = (index - 1).coerceAtLeast(0) }, Modifier.weight(1f).height(50.dp), enabled = index > 0) { Text("Previous") }
            if (index < insp.steps.size) HSecondaryButton({ index = (index + 1).coerceAtMost(insp.steps.size) }, Modifier.weight(1f).height(50.dp)) {
              Text(if (index == insp.steps.size - 1) "Review" else if (answers.containsKey(insp.steps[index].id)) "Next" else "Skip")
            }
            else Spacer(Modifier.weight(1f))
          }
        }
      }
      Spacer(Modifier.height(16.dp))
      NavSpacer()
    }

    if (confirmSubmit) AlertDialog(
      onDismissRequest = { confirmSubmit = false },
      containerColor = Hx.Surface2,
      title = { Text("Submit for review?", style = HxType.Section) },
      text = {
        Text(buildString {
          append("${answers.size} of ${insp.steps.size} steps recorded.")
          if (abnormal > 0) append(" $abnormal abnormal finding${if (abnormal > 1) "s" else ""} will open a follow-up maintenance request.")
          if (!online) append(" You are offline: the round is submitted as soon as the phone reconnects.")
        }, color = Hx.Text2, fontSize = 15.sp, lineHeight = 21.sp)
      },
      confirmButton = { TextButton({ confirmSubmit = false; app.outbox.queueAction(id, "submit"); app.sync() }) { Text("Submit", color = Hx.Accent, fontWeight = FontWeight.SemiBold) } },
      dismissButton = { TextButton({ confirmSubmit = false }) { Text("Keep editing", color = Hx.Text2) } },
    )
  }
}

@Composable
private fun StepStrip(steps: List<Step>, answers: Map<String, Answer>, current: Int, onJump: (Int) -> Unit) {
  Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
    steps.forEachIndexed { i, s ->
      val a = answers[s.id]
      val color = when { i == current -> Hx.Signal; a?.outcome == "abnormal" -> Hx.High; a != null -> Hx.OkFill; else -> Hx.Surface3 }
      Box(
        Modifier.weight(1f).height(if (i == current) 8.dp else 6.dp).clip(HxShape.Pill).background(color)
          .pressable(scale = 1f) { onJump(i) }.semantics { contentDescription = "Step ${i + 1}: ${s.title}"; selected = i == current },
      )
    }
    Box(Modifier.width(18.dp).height(6.dp).clip(HxShape.Pill).background(if (current >= steps.size) Hx.Signal else Hx.Surface3).pressable(scale = 1f) { onJump(steps.size) }.semantics { contentDescription = "Review" })
  }
}

@Composable
private fun StartCard(safety: List<String>, steps: Int, reviewNote: String?, onStart: () -> Unit) {
  Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
    if (reviewNote != null) ReturnedNote(reviewNote)
    if (safety.isNotEmpty()) PaperCard(Modifier.fillMaxWidth().appear(1)) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Outlined.WarningAmber, null, tint = Hx.HighOnPaper)
        Text("  Before you start", fontWeight = FontWeight.SemiBold, color = Hx.Ink, fontSize = 16.sp)
      }
      Spacer(Modifier.height(8.dp))
      safety.forEach { Text("• $it", color = Hx.Ink2, fontSize = 14.5.sp, lineHeight = 21.sp, modifier = Modifier.padding(vertical = 3.dp)) }
    }
    HCard(Modifier.fillMaxWidth().appear(2)) {
      Text("$steps steps", style = HxType.Section)
      Text("Answers are saved on this phone as you go and sync automatically, so you can keep working without signal.", color = Hx.Muted, style = HxType.Label, modifier = Modifier.padding(top = 6.dp, bottom = 16.dp))
      HButton(onStart, Modifier.fillMaxWidth().height(52.dp)) { Text("Start round", fontWeight = FontWeight.SemiBold) }
    }
  }
}

@Composable
private fun ReturnedNote(note: String) {
  HCard(Modifier.fillMaxWidth().padding(bottom = 12.dp), accent = Hx.High, padding = 16.dp) {
    Eyebrow("Returned for correction", Hx.HighText)
    Text(note, color = Hx.Text, fontSize = 14.5.sp, modifier = Modifier.padding(top = 6.dp))
  }
}

@Composable
private fun ConflictCard(c: OutboxEntry, stepTitle: String?, onDiscard: () -> Unit) {
  HCard(Modifier.fillMaxWidth().padding(bottom = 12.dp), accent = Hx.Critical, padding = 16.dp) {
    Text(if (c.kind == "action") "${label(c.action ?: "change")} was not accepted" else "Answer not accepted${stepTitle?.let { ": $it" } ?: ""}", style = HxType.Card)
    Text(reasonText(c.error), color = Hx.Text2, style = HxType.Label, modifier = Modifier.padding(top = 4.dp, bottom = 10.dp))
    HSecondaryButton(onDiscard, Modifier.height(42.dp)) { Text("Discard") }
  }
}

private fun reasonText(r: String?): String = when {
  r == null -> "The server refused this change."
  r.startsWith("inspection_") -> "The round was ${r.removePrefix("inspection_").replace('_', ' ')} while you were offline."
  r == "unknown_step" || r == "kind_mismatch" -> "The round's checklist changed on the server. Record this step again."
  r == "photo_missing" -> "The photo file is no longer on this phone."
  else -> r
}

@Composable
private fun DoneCard(queued: Boolean, status: String, abnormal: Int, online: Boolean, onBack: () -> Unit) {
  HCard(Modifier.fillMaxWidth().appear()) {
    Icon(if (queued) Icons.Outlined.CloudUpload else Icons.Outlined.TaskAlt, null, tint = if (queued) Hx.Accent else Hx.OkFill, modifier = Modifier.size(36.dp))
    Spacer(Modifier.height(10.dp))
    Text(if (queued) (if (online) "Submitting…" else "Submit queued") else if (status == "approved") "Approved" else "Submitted for review", style = HxType.Section)
    Text(
      if (queued) "The round is saved on this phone and is submitted as soon as there is a connection." else
        "Your supervisor reviews it in the console.${if (abnormal > 0) " A follow-up maintenance request was opened for the abnormal findings." else ""}",
      color = Hx.Muted, style = HxType.Label, modifier = Modifier.padding(top = 6.dp, bottom = 16.dp),
    )
    HButton(onBack, Modifier.fillMaxWidth().height(50.dp)) { Text("Back") }
  }
}

@Composable
private fun ReviewCard(steps: List<Step>, answers: Map<String, Answer>, complete: Boolean, missing: Int, onSubmit: () -> Unit) {
  HCard(Modifier.fillMaxWidth()) {
    Text("Review", style = HxType.Section)
    Text(if (complete) "All required steps are recorded." else "$missing required step${if (missing > 1) "s" else ""} still open.", color = if (complete) Hx.Muted else Hx.HighText, style = HxType.Label, modifier = Modifier.padding(top = 4.dp, bottom = 10.dp))
    steps.forEach { s ->
      val a = answers[s.id]
      Row(Modifier.fillMaxWidth().padding(vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(8.dp).clip(HxShape.Pill).background(when { a == null -> if (s.required) Hx.High else Hx.Surface3; a.outcome == "abnormal" -> Hx.High; else -> Hx.OkFill }))
        Text("  ${s.title}", color = Hx.Text, fontSize = 14.sp, modifier = Modifier.weight(1f), maxLines = 1)
        Text(a?.let { display(s, it) } ?: if (s.required) "required" else "—", color = if (a?.outcome == "abnormal") Hx.HighText else Hx.Muted, fontSize = 13.sp)
        if (a?.queued == true) Text("  •", color = Hx.Accent)
      }
    }
    Spacer(Modifier.height(12.dp))
    HButton(onSubmit, Modifier.fillMaxWidth().height(52.dp), enabled = complete) { Text("Submit for review", fontWeight = FontWeight.SemiBold) }
  }
}

private fun display(s: Step, a: Answer): String = when (a.value["kind"]?.jsonPrimitive?.content) {
  "check" -> if (a.outcome == "abnormal") "Fail" else "Pass"
  "reading" -> "${a.value["value"]?.jsonPrimitive?.content} ${s.unit ?: ""}".trim()
  "choice" -> a.value["option"]?.jsonPrimitive?.content ?: ""
  "text" -> "Noted"
  "photo" -> if (a.queued) "Photo (queued)" else "Photo"
  else -> "Done"
}

@Composable
private fun StepCard(
  step: Step, i: Int, total: Int, answer: Answer?, glassesReady: Boolean,
  onAnswer: (JsonObject, String?, File?) -> Unit,
  newPhotoFile: () -> File, ensureCamera: suspend () -> Boolean, glassesPhoto: suspend (File) -> Unit,
) {
  val ctx = LocalContext.current
  val scope = rememberCoroutineScope()
  var note by rememberSaveable(step.id) { mutableStateOf(answer?.note ?: "") }
  var showNote by rememberSaveable(step.id) { mutableStateOf(!answer?.note.isNullOrBlank()) }
  var err by remember(step.id) { mutableStateOf<String?>(null) }
  var busy by remember(step.id) { mutableStateOf(false) }
  HCard(Modifier.fillMaxWidth()) {
    Eyebrow("Step ${i + 1} of $total · ${kindLabel(step.kind)}${if (step.required) "" else " · optional"}")
    Spacer(Modifier.height(8.dp))
    Text(step.title, style = HxType.Section)
    step.instruction?.let { Text(it, color = Hx.Text2, fontSize = 14.5.sp, lineHeight = 21.sp, modifier = Modifier.padding(top = 6.dp)) }
    step.caution?.let {
      Row(Modifier.fillMaxWidth().padding(top = 12.dp).clip(HxShape.Md).background(Hx.High.copy(alpha = 0.12f)).border(1.dp, Hx.High.copy(alpha = 0.4f), HxShape.Md).padding(12.dp)) {
        Icon(Icons.Outlined.WarningAmber, null, tint = Hx.HighText, modifier = Modifier.size(20.dp))
        Text("  $it", color = Hx.HighText, fontSize = 14.sp, lineHeight = 20.sp)
      }
    }
    Spacer(Modifier.height(16.dp))
    val n = note.trim().ifEmpty { null }
    when (step.kind) {
      "check" -> {
        val cur = answer?.let { if (it.outcome == "abnormal") "fail" else "pass" }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          Choice("Pass", Icons.Outlined.Check, cur == "pass", Hx.OkFill, Modifier.weight(1f)) { onAnswer(buildJsonObject { put("kind", "check"); put("checked", true) }, n, null) }
          Choice("Fail", Icons.Outlined.Close, cur == "fail", Hx.High, Modifier.weight(1f)) { onAnswer(buildJsonObject { put("kind", "check"); put("checked", false); put("abnormal", true) }, n, null) }
        }
      }
      "choice" -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        val cur = answer?.value?.get("option")?.jsonPrimitive?.content
        step.options.forEach { o ->
          val bad = o in step.abnormalOptions
          Choice(o, if (bad) Icons.Outlined.WarningAmber else null, cur == o, if (bad) Hx.High else Hx.Signal, Modifier.fillMaxWidth()) {
            onAnswer(buildJsonObject { put("kind", "choice"); put("option", o) }, n, null)
          }
        }
      }
      "reading" -> {
        var text by rememberSaveable(step.id) { mutableStateOf(answer?.value?.get("value")?.jsonPrimitive?.content ?: "") }
        val v = text.replace(',', '.').toDoubleOrNull()
        val out = v != null && ((step.expectedMin != null && v < step.expectedMin) || (step.expectedMax != null && v > step.expectedMax))
        HField("Reading${step.unit?.let { " ($it)" } ?: ""}", text, { text = it }, Modifier.fillMaxWidth(), placeholder = "0.0", keyboardType = KeyboardType.Decimal)
        val range = when { step.expectedMin != null && step.expectedMax != null -> "Expected ${num(step.expectedMin)} – ${num(step.expectedMax)} ${step.unit ?: ""}"; step.expectedMax != null -> "Expected at most ${num(step.expectedMax)} ${step.unit ?: ""}"; step.expectedMin != null -> "Expected at least ${num(step.expectedMin)} ${step.unit ?: ""}"; else -> null }
        range?.let { Text(it.trim(), color = if (out) Hx.HighText else Hx.Muted, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp)) }
        if (out) Text("Outside the expected range: this is recorded as abnormal. Add a note if you can.", color = Hx.HighText, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
        Spacer(Modifier.height(12.dp))
        HButton({ onAnswer(buildJsonObject { put("kind", "reading"); put("value", v!!) }, n, null) }, Modifier.fillMaxWidth().height(50.dp), enabled = v != null) { Text("Save reading") }
      }
      "text" -> {
        var text by rememberSaveable(step.id) { mutableStateOf(answer?.value?.get("text")?.jsonPrimitive?.content ?: "") }
        HField(null, text, { text = it }, Modifier.fillMaxWidth(), placeholder = "Describe what you see", singleLine = false, minLines = 3)
        Spacer(Modifier.height(12.dp))
        HButton({ onAnswer(buildJsonObject { put("kind", "text"); put("text", text.trim()) }, null, null) }, Modifier.fillMaxWidth().height(50.dp), enabled = text.isNotBlank()) { Text("Save note") }
      }
      "photo" -> {
        var target by remember(step.id) { mutableStateOf<File?>(null) }
        val launcher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
          val f = target
          if (ok && f != null) scope.launch {
            withContext(Dispatchers.IO) { BitmapFactory.decodeFile(f.path)?.let { writeScaled(it, f) } }
            onAnswer(buildJsonObject { put("kind", "photo") }, n, f)
          } else f?.delete()
        }
        PhotoPreview(answer, ctx.filesDir)
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          HButton({
            scope.launch {
              err = null
              if (!ensureCamera()) { err = "Camera permission is needed to take the photo."; return@launch }
              val f = newPhotoFile(); target = f
              runCatching { launcher.launch(FileProvider.getUriForFile(ctx, "${ctx.packageName}.captures", f)) }.onFailure { err = it.message }
            }
          }, Modifier.weight(1f).height(50.dp), enabled = !busy) { Icon(Icons.Outlined.CameraAlt, null, Modifier.size(18.dp)); Text("  Phone") }
          HSecondaryButton({
            scope.launch {
              busy = true; err = null
              val f = newPhotoFile()
              runCatching { glassesPhoto(f) }.onSuccess { onAnswer(buildJsonObject { put("kind", "photo") }, n, f) }.onFailure { err = it.message ?: "Glasses camera not available"; f.delete() }
              busy = false
            }
          }, Modifier.weight(1f).height(50.dp), enabled = glassesReady && !busy) { Icon(Icons.Outlined.Visibility, null, Modifier.size(18.dp)); Text(if (busy) "  Capturing…" else "  Glasses") }
        }
        if (!glassesReady) Text("Link your glasses in the Glasses tab to take the photo hands-free.", color = Hx.Muted, fontSize = 12.5.sp, modifier = Modifier.padding(top = 8.dp))
      }
      else -> Text("This step type is not supported on the phone yet.", color = Hx.Muted)
    }
    err?.let { ErrorNote(it, Modifier.padding(top = 10.dp)) }
    if (step.kind != "text") {
      Spacer(Modifier.height(12.dp))
      if (showNote) HField("Note (optional)", note, { note = it }, Modifier.fillMaxWidth(), singleLine = false, minLines = 2)
      else Text("+ Add a note", color = Hx.Accent, fontSize = 14.sp, fontWeight = FontWeight.Medium, modifier = Modifier.pressable { showNote = true }.padding(vertical = 6.dp))
    }
    if (answer != null) Row(Modifier.padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
      Box(Modifier.size(7.dp).clip(HxShape.Pill).background(if (answer.queued) Hx.Accent else Hx.OkFill))
      Text(if (answer.queued) "  Saved on this phone · waiting to sync" else "  Recorded", color = Hx.Muted, fontSize = 12.5.sp)
    }
  }
}

@Composable
private fun PhotoPreview(answer: Answer?, filesDir: File) {
  val file = answer?.photoFile?.let { File(File(filesDir, "outbox/photos"), it) }
  val bmp by produceState<Bitmap?>(null, file) { value = file?.takeIf { it.exists() }?.let { withContext(Dispatchers.IO) { decodeThumb(it) } } }
  Box(
    Modifier.fillMaxWidth().aspectRatio(4f / 3f).clip(HxShape.Lg).background(Hx.Field).border(1.dp, Hx.Line2, HxShape.Lg),
    contentAlignment = Alignment.Center,
  ) {
    when {
      bmp != null -> Image(bmp!!.asImageBitmap(), "Step photo", Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
      answer != null -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(Icons.Outlined.TaskAlt, null, tint = Hx.OkFill, modifier = Modifier.size(30.dp))
        Text("Photo uploaded", color = Hx.Text2, fontSize = 14.sp, modifier = Modifier.padding(top = 6.dp))
      }
      else -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(Icons.Outlined.CameraAlt, null, tint = Hx.Muted, modifier = Modifier.size(30.dp))
        Text("No photo yet", color = Hx.Muted, fontSize = 14.sp, modifier = Modifier.padding(top = 6.dp))
      }
    }
  }
}

@Composable
private fun Choice(text: String, icon: androidx.compose.ui.graphics.vector.ImageVector?, selected: Boolean, color: Color, modifier: Modifier = Modifier, onClick: () -> Unit) {
  Row(
    modifier.height(56.dp).clip(HxShape.Md)
      .background(if (selected) color.copy(alpha = 0.22f) else Hx.Surface2)
      .border(if (selected) 1.5.dp else 1.dp, if (selected) color else Hx.Line2, HxShape.Md)
      .pressable(scale = 0.97f, onClick = onClick).semantics { this.selected = selected }.padding(horizontal = 16.dp),
    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center,
  ) {
    icon?.let { Icon(it, null, tint = if (selected) Color.White else Hx.Text2, modifier = Modifier.size(20.dp)); Spacer(Modifier.width(8.dp)) }
    Text(text, color = if (selected) Color.White else Hx.Text, fontSize = 16.sp, fontWeight = FontWeight.Medium)
  }
}

private fun kindLabel(k: String) = when (k) { "check" -> "Pass / fail"; "reading" -> "Reading"; "choice" -> "Condition"; "text" -> "Note"; "photo" -> "Photo"; else -> label(k) }
private fun num(d: Double) = if (d % 1.0 == 0.0) d.toInt().toString() else d.toString()

/** Downscale to at most 1600 px and re-encode, so photos upload quickly over weak field signal. */
internal fun writeScaled(src: Bitmap, out: File, maxPx: Int = 1600) {
  val s = maxPx.toFloat() / maxOf(src.width, src.height)
  val b = if (s < 1f) Bitmap.createScaledBitmap(src, (src.width * s).toInt(), (src.height * s).toInt(), true) else src
  out.outputStream().use { b.compress(Bitmap.CompressFormat.JPEG, 85, it) }
}

private fun decodeThumb(f: File): Bitmap? {
  val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
  BitmapFactory.decodeFile(f.path, o)
  var sample = 1
  while (maxOf(o.outWidth, o.outHeight) / (sample * 2) >= 720) sample *= 2
  return BitmapFactory.decodeFile(f.path, BitmapFactory.Options().apply { inSampleSize = sample })
}
