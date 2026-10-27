package ai.hydris.field.ui.screens

import ai.hydris.field.data.Alarm
import ai.hydris.field.ui.components.Chip
import ai.hydris.field.ui.components.BackButton
import ai.hydris.field.ui.components.BrandCard
import ai.hydris.field.ui.components.Capsule
import ai.hydris.field.ui.components.EmptyState
import ai.hydris.field.ui.components.HButton
import ai.hydris.field.ui.components.HField
import ai.hydris.field.ui.components.HSecondaryButton
import ai.hydris.field.ui.components.NavSpacer
import ai.hydris.field.ui.components.PageHeader
import ai.hydris.field.ui.components.PaperCard
import ai.hydris.field.ui.components.SeverityChip
import ai.hydris.field.ui.components.appear
import ai.hydris.field.ui.theme.HxType
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.ui.graphics.Color

import ai.hydris.field.ui.components.Dot
import ai.hydris.field.ui.components.ErrorNote
import ai.hydris.field.ui.components.Eyebrow
import ai.hydris.field.ui.components.HCard
import ai.hydris.field.ui.components.Loading
import ai.hydris.field.ui.components.ProgressBar
import ai.hydris.field.ui.components.ago
import ai.hydris.field.ui.components.fmt
import ai.hydris.field.ui.components.label
import ai.hydris.field.ui.theme.Hx
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.CheckBox
import androidx.compose.material.icons.outlined.CheckBoxOutlineBlank
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.PrimaryScrollableTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import kotlinx.coroutines.launch

private val TABS = listOf("Alarms", "Inspections", "Maintenance", "Sensors", "Audit docs")

@Composable
fun WorkScreen(nav: NavController) {
  var tab by rememberSaveable { mutableIntStateOf(0) }
  Column(Modifier.fillMaxSize().statusBarsPadding()) {
    PageHeader("Operate · field work", "Work", modifier = Modifier.padding(horizontal = 16.dp).padding(top = 12.dp))
    Capsule(TABS.indices.map { it to TABS[it] }, tab, { tab = it }, Modifier.padding(horizontal = 16.dp).horizontalScroll(rememberScrollState()))
    Spacer(Modifier.height(12.dp))
    when (tab) {
      0 -> AlarmsTab(nav)
      1 -> InspectionsTab()
      2 -> MaintenanceTab()
      3 -> SensorsTab(nav)
      else -> AuditDocsTab()
    }
  }
}

@Composable
private fun <T> ListOf(l: Loadable<List<T>>, empty: String, row: @Composable (T) -> Unit) {
  val data = l.data.value
  when {
    data == null && l.error.value != null -> ErrorNote(l.error.value!!, Modifier.padding(16.dp))
    data == null -> Loading()
    data.isEmpty() -> EmptyState(empty, modifier = Modifier.padding(16.dp))
    else -> LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
      item { Spacer(Modifier.height(4.dp)) }
      itemsIndexed(data) { i, it -> Box(Modifier.appear(i)) { row(it) } }
      item { NavSpacer() }
    }
  }
}

@Composable
private fun AlarmsTab(nav: NavController) {
  val l = rememberLoad(refreshMs = 15_000) { alarms().filter { it.state != "closed" } }
  ListOf(l, "No open alarms.") { a -> AlarmRow(a) { nav.navigate("alarm/${a.id}") } }
}

@Composable
fun AlarmRow(a: Alarm, onClick: () -> Unit) {
  HCard(Modifier.fillMaxWidth(), onClick = onClick, accent = if (a.severity == "critical" && a.state == "active") Hx.Alert else null, padding = 14.dp) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Dot(Hx.severity(a.severity), 10.dp)
      Column(Modifier.weight(1f).padding(start = 12.dp)) {
        Text(a.title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text("${label(a.state)} · ${ago(a.triggeredAt)}${a.assigneeName?.let { " · $it" } ?: ""}", color = Hx.Muted, style = MaterialTheme.typography.bodySmall)
      }
      SeverityChip(a.severity)
    }
  }
}

@Composable
private fun InspectionsTab() {
  val l = rememberLoad { inspections() }
  ListOf(l, "No inspections.") { i ->
    HCard(Modifier.fillMaxWidth(), padding = 16.dp) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Text(i.title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
        Chip(label(i.status), if (i.status == "submitted" || i.status == "approved") Hx.OkSoft else Hx.SignalText)
      }
      Text("${i.assigneeName ?: "Unassigned"} · ${i.siteName ?: ""}${i.dueAt?.let { " · due ${ago(it).replace(" ago", " overdue")}" }?.takeIf { java.time.Instant.parse(i.dueAt).isBefore(java.time.Instant.now()) } ?: ""}",
        color = Hx.Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp, bottom = 8.dp))
      ProgressBar(if (i.stepCount > 0) i.answered.toFloat() / i.stepCount else 0f, if (i.priority == "high") Hx.High else Hx.Signal)
      Text("${i.answered}/${i.stepCount} steps", color = Hx.Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp))
    }
  }
}

@Composable
private fun MaintenanceTab() {
  val r = repo()
  val l = rememberLoad { tasks().filter { it.status != "completed" && it.status != "cancelled" } }
  val scope = rememberCoroutineScope()
  ListOf(l, "No open maintenance tasks.") { t ->
    var expanded by remember(t.id) { mutableStateOf(false) }
    HCard(Modifier.fillMaxWidth(), onClick = { expanded = !expanded }, accent = if (t.priority == "urgent") Hx.Alert else null, padding = 16.dp) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Text(t.title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f), maxLines = if (expanded) 4 else 2, overflow = TextOverflow.Ellipsis)
        Chip(label(t.priority), when (t.priority) { "urgent" -> Hx.Critical; "high" -> Hx.High; else -> Hx.Text2 })
      }
      val done = t.checklist.count { it.done }
      Text("${label(t.status)} · ${t.assigneeName ?: "Unassigned"} · $done/${t.checklist.size} checks", color = Hx.Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(vertical = 6.dp))
      ProgressBar(if (t.checklist.isEmpty()) 0f else done.toFloat() / t.checklist.size, Hx.OkSoft)
      if (expanded) {
        t.description?.let { Text(it, color = Hx.Text2, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 10.dp)) }
        t.checklist.forEach { c ->
          Row(Modifier.fillMaxWidth().clickable {
            scope.launch { runCatching { r.toggleChecklist(t.id, c.id, !c.done) }; l.reload() }
          }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(if (c.done) Icons.Outlined.CheckBox else Icons.Outlined.CheckBoxOutlineBlank, null, tint = if (c.done) Hx.OkSoft else Hx.Muted)
            Text("  ${c.label}", color = if (c.done) Hx.Muted else Hx.Text)
          }
        }
      }
    }
  }
}

@Composable
private fun SensorsTab(nav: NavController) {
  val l = rememberLoad(refreshMs = 10_000) { sensors() }
  ListOf(l, "No sensors.") { s ->
    HCard(Modifier.fillMaxWidth(), onClick = { nav.navigate("sensor/${s.id}") }, padding = 16.dp) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
          Text("${s.name}", style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
          Row(verticalAlignment = Alignment.CenterVertically) { Dot(Hx.freshness(s.freshness), 7.dp); Text("  ${s.tag} · ${ago(s.lastTs)}${if (s.openAlarms > 0) " · ${s.openAlarms} alarm" else ""}", color = Hx.Muted, style = MaterialTheme.typography.bodySmall) }
        }
        Text(fmt(s.lastValue), style = HxType.KpiSm, color = if (s.openAlarms > 0) Hx.HighText else Hx.Text)
        Text(" ${if (s.unit == "pH") "" else s.unit}", color = Hx.Muted, style = MaterialTheme.typography.bodySmall)
      }
    }
  }
}

@Composable
private fun AuditDocsTab() {
  val l = rememberLoad(refreshMs = 20_000) { auditDocs() }
  ListOf(l, "No audit documents yet - scan one from the Scan tab.") { d ->
    HCard(Modifier.fillMaxWidth(), padding = 16.dp) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Text(d.title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
        Chip(label(d.status), when (d.status) { "approved" -> Hx.OkSoft; "rejected" -> Hx.Alert; "verified" -> Hx.SignalText; else -> Hx.Medium })
      }
      Text("${d.fields} values · ${d.tables} tables · via ${d.capturedVia} · ${d.capturedBy ?: ""} · ${ago(d.createdAt)}", color = Hx.Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(vertical = 6.dp))
      ProgressBar(if (d.review.total > 0) d.review.done.toFloat() / d.review.total else 0f, if (d.review.complete) Hx.OkSoft else Hx.Signal)
      Text("${d.review.done}/${d.review.total} reviewed${d.agreement?.let { " · ${(it * 100).toInt()}% engine agreement" } ?: ""}", color = Hx.Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp))
    }
  }
}

// ------------------------------------------------------------------ alarm detail
@Composable
fun AlarmDetailScreen(id: String, nav: NavController) {
  val r = repo()
  val l = rememberLoad(id) { alarm(id) }
  val scope = rememberCoroutineScope()
  var busy by remember { mutableStateOf(false) }
  var err by remember { mutableStateOf<String?>(null) }
  Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
    BackButton { nav.popBackStack() }
    val a = l.data.value ?: run { if (l.error.value != null) ErrorNote(l.error.value!!) else Loading(); return@Column }
    Eyebrow("Alarm · ${a.assetTag ?: a.sensorTag ?: "plant"}")
    Text(a.title, style = HxType.Page)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { SeverityChip(a.severity); Chip(label(a.state)); if (a.synthetic) Chip("Synthetic", Hx.Purple) }
    a.description?.let { Text(it, color = Hx.Text2, fontSize = 15.sp, lineHeight = 22.sp) }
    PaperCard(Modifier.fillMaxWidth()) {
      Text("Reading at trigger", fontSize = 13.5.sp, color = Hx.Ink.copy(alpha = 0.75f))
      Spacer(Modifier.height(12.dp))
      Row(verticalAlignment = Alignment.Bottom) {
        Text(fmt(a.triggerValue), style = HxType.Kpi, color = when (a.severity) { "critical" -> Hx.CriticalOnPaper; "high" -> Hx.HighOnPaper; else -> Hx.Ink })
        Text("  ${a.unit ?: ""}", fontSize = 15.sp, color = Hx.Ink.copy(alpha = 0.6f), modifier = Modifier.padding(bottom = 4.dp))
      }
      Spacer(Modifier.height(10.dp))
      Text("Limit ${fmt(a.threshold)} · peak ${fmt(a.peakValue)}", fontSize = 13.sp, color = Hx.Ink.copy(alpha = 0.7f))
      Text("${a.assetTag ?: ""} ${a.assetName ?: ""} · sensor ${a.sensorTag ?: "—"} · raised ${ago(a.triggeredAt)}", color = Hx.Ink2, style = MaterialTheme.typography.bodySmall)
    }
    a.recommendedAction?.let { BrandCard(Modifier.fillMaxWidth()) { Eyebrow("Recommended action", Color.White.copy(alpha = 0.85f)); Spacer(Modifier.height(8.dp)); Text(it, color = Color.White, fontSize = 15.sp, lineHeight = 22.sp) } }
    err?.let { ErrorNote(it) }
    val next = when (a.state) { "active" -> listOf("acknowledge" to "Acknowledge"); "acknowledged" -> listOf("investigate" to "Investigate", "resolve" to "Resolve"); "investigating" -> listOf("resolve" to "Resolve"); "resolved" -> listOf("close" to "Close"); else -> emptyList() }
    // Resolving requires a note describing what was done (the API rejects it without one).
    var note by remember(a.state) { mutableStateOf("") }
    if (next.any { it.first == "resolve" }) HField("What was done (needed to resolve)", note, { note = it }, Modifier.fillMaxWidth(), singleLine = false, minLines = 2)
    next.forEachIndexed { i, (action, text) ->
      val needsNote = action == "resolve" && note.isBlank()
      val click: () -> Unit = { scope.launch { busy = true; err = null; runCatching { r.alarmAction(id, action, note.trim().ifEmpty { null }) }.onFailure { err = it.message }; l.reload(); busy = false } }
      if (i == 0) HButton(click, enabled = !busy && !needsNote, modifier = Modifier.fillMaxWidth().height(52.dp)) { Text(text) }
      else HSecondaryButton(click, enabled = !busy && !needsNote, modifier = Modifier.fillMaxWidth().height(52.dp)) { Text(text) }
    }
    NavSpacer()
  }
}
