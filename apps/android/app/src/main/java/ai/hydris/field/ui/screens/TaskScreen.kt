package ai.hydris.field.ui.screens

import ai.hydris.field.HydrisApp
import ai.hydris.field.MainActivity
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
import ai.hydris.field.ui.components.ProgressBar
import ai.hydris.field.ui.components.ago
import ai.hydris.field.ui.components.appear
import ai.hydris.field.ui.components.label
import ai.hydris.field.ui.components.pressable
import ai.hydris.field.ui.theme.Hx
import ai.hydris.field.ui.theme.HxShape
import ai.hydris.field.ui.theme.HxType
import android.Manifest
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.CheckBox
import androidx.compose.material.icons.outlined.CheckBoxOutlineBlank
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import androidx.navigation.NavController
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Maintenance task: checklist, start / hold, and complete with a note and an optional evidence photo. */
@Composable
fun TaskScreen(id: String, nav: NavController) {
  val app = LocalContext.current.applicationContext as HydrisApp
  val activity = LocalContext.current as? MainActivity
  val ctx = LocalContext.current
  val r = repo()
  val l = rememberLoad(id) { task(id) }
  val scope = rememberCoroutineScope()
  var busy by remember { mutableStateOf(false) }
  var err by remember { mutableStateOf<String?>(null) }
  var note by remember { mutableStateOf("") }
  var photo by remember { mutableStateOf<File?>(null) }
  var thumb by remember { mutableStateOf<Bitmap?>(null) }
  var pendingShot by remember { mutableStateOf<File?>(null) }
  val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
    val f = pendingShot
    if (ok && f != null) scope.launch {
      thumb = withContext(Dispatchers.IO) { BitmapFactory.decodeFile(f.path)?.also { writeScaled(it, f) }?.let { BitmapFactory.decodeFile(f.path) } }
      photo = f
    } else f?.delete()
  }

  Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
    BackButton { nav.popBackStack() }
    val env = l.data.value ?: run { if (l.error.value != null) ErrorNote(l.error.value!!) else Loading(); return@Column }
    val t = env.task
    Eyebrow("Maintenance${t.assetTag?.let { " · $it" } ?: ""}")
    Text(t.title, style = HxType.Page)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      Chip(label(t.status), if (t.status == "completed") Hx.OkFill else Hx.SignalText)
      Chip(label(t.priority), when (t.priority) { "urgent" -> Hx.Critical; "high" -> Hx.High; else -> Hx.Text2 })
      Chip(label(t.kind))
    }
    t.description?.let { Text(it, color = Hx.Text2, fontSize = 15.sp, lineHeight = 22.sp) }
    val open = t.status in setOf("open", "assigned", "in_progress", "on_hold")
    val canExec = env.permissions.execute
    if (t.checklist.isNotEmpty()) HCard(Modifier.fillMaxWidth().appear(1), padding = 16.dp) {
      val done = t.checklist.count { it.done }
      Row(verticalAlignment = Alignment.CenterVertically) {
        Text("Checklist", style = HxType.Card, modifier = Modifier.weight(1f))
        Text("$done/${t.checklist.size}", color = Hx.Muted, fontSize = 13.sp)
      }
      Spacer(Modifier.height(8.dp))
      ProgressBar(done.toFloat() / t.checklist.size, Hx.OkSoft)
      Spacer(Modifier.height(6.dp))
      t.checklist.forEach { c ->
        Row(
          Modifier.fillMaxWidth().clip(HxShape.Sm).pressable(enabled = open && canExec && !busy, scale = 0.99f, role = Role.Checkbox) {
            scope.launch { busy = true; err = null; runCatching { r.toggleChecklist(t.id, c.id, !c.done) }.onFailure { err = it.message }; l.reload(); busy = false }
          }.padding(vertical = 10.dp),
          verticalAlignment = Alignment.CenterVertically,
        ) {
          Icon(if (c.done) Icons.Outlined.CheckBox else Icons.Outlined.CheckBoxOutlineBlank, null, tint = if (c.done) Hx.OkSoft else Hx.Muted)
          Text("  ${c.label}", color = if (c.done) Hx.Muted else Hx.Text, fontSize = 15.sp)
        }
      }
    }
    err?.let { ErrorNote(it) }
    if (open && canExec) {
      val checklistDone = t.checklist.all { it.done }
      if (t.status != "in_progress") HButton({
        scope.launch { busy = true; err = null; runCatching { r.taskAction(t.id, "start") }.onFailure { err = it.message }; l.reload(); busy = false }
      }, Modifier.fillMaxWidth().height(52.dp), enabled = !busy) { Text(if (t.status == "on_hold") "Resume work" else "Start work", fontWeight = FontWeight.SemiBold) }
      else HCard(Modifier.fillMaxWidth().appear(2)) {
        Text("Complete the task", style = HxType.Card)
        Spacer(Modifier.height(10.dp))
        HField("What was done", note, { note = it }, Modifier.fillMaxWidth(), placeholder = "Replaced the filter element, differential back to 12 mbar", singleLine = false, minLines = 3)
        Spacer(Modifier.height(10.dp))
        thumb?.let { Image(it.asImageBitmap(), "Evidence photo", Modifier.fillMaxWidth().height(180.dp).clip(HxShape.Lg), contentScale = ContentScale.Crop); Spacer(Modifier.height(8.dp)) }
        HSecondaryButton({
          scope.launch {
            if (activity?.ensurePhonePermission(Manifest.permission.CAMERA) != true) { err = "Camera permission is needed for the photo."; return@launch }
            val f = app.outbox.newPhotoFile(); pendingShot = f
            runCatching { camera.launch(FileProvider.getUriForFile(ctx, "${ctx.packageName}.captures", f)) }.onFailure { err = it.message }
          }
        }, Modifier.fillMaxWidth().height(46.dp)) { Icon(Icons.Outlined.CameraAlt, null, Modifier.size(18.dp)); Text(if (photo == null) "  Add evidence photo" else "  Retake photo") }
        if (!checklistDone) Text("Tick every checklist item before completing.", color = Hx.HighText, fontSize = 13.sp, modifier = Modifier.padding(top = 10.dp))
        Spacer(Modifier.height(12.dp))
        HButton({
          scope.launch {
            busy = true; err = null
            runCatching {
              photo?.let { r.uploadAttachment("maintenance", t.id, it); it.delete() }
              r.taskAction(t.id, "complete", note.trim())
            }.onSuccess { photo = null; thumb = null }.onFailure { err = it.message }
            l.reload(); busy = false
          }
        }, Modifier.fillMaxWidth().height(52.dp), enabled = !busy && note.isNotBlank() && checklistDone) { Text(if (busy) "Saving…" else "Complete task", fontWeight = FontWeight.SemiBold) }
        Spacer(Modifier.height(8.dp))
        HSecondaryButton({
          scope.launch { busy = true; err = null; runCatching { r.taskAction(t.id, "hold", note.trim().ifEmpty { null }) }.onFailure { err = it.message }; l.reload(); busy = false }
        }, Modifier.fillMaxWidth().height(46.dp), enabled = !busy) { Text("Put on hold") }
      }
    } else if (open) Text("Only the assigned person can work on this task.", color = Hx.Muted, fontSize = 13.5.sp)
    t.completionNote?.let { HCard(Modifier.fillMaxWidth(), padding = 16.dp) { Eyebrow("Completion note"); Text(it, color = Hx.Text, modifier = Modifier.padding(top = 6.dp)) } }
    if (env.activity.isNotEmpty()) HCard(Modifier.fillMaxWidth(), padding = 16.dp) {
      Text("Activity", style = HxType.Card)
      env.activity.takeLast(10).reversed().forEach { a ->
        Column(Modifier.padding(top = 10.dp)) {
          Text("${label(a.action)}${a.actorName?.let { " · $it" } ?: ""}", color = Hx.Text, fontSize = 14.sp)
          a.note?.let { Text(it, color = Hx.Text2, fontSize = 13.sp) }
          Text(ago(a.at), color = Hx.Muted, fontSize = 12.sp)
        }
      }
    }
    NavSpacer()
  }
}
