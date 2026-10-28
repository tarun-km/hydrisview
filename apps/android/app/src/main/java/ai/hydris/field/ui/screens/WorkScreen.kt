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
import ai.hydris.field.ui.components.OfflineBanner
import androidx.compose.runtime.collectAsState
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
import ai.hydris.field.HydrisApp
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.platform.LocalContext

private val TABS = listOf("Alarms", "Rounds", "Maintenance", "Sensors", "Audit docs")
private typealias WorkData = Loadable<ai.hydris.field.data.WorkView>

@Composable
fun WorkScreen(nav: NavController) {
  var tab by rememberSaveable { mutableIntStateOf(0) }
  var scope by rememberSaveable { mutableStateOf("mine") }
  val app = LocalContext.current.applicationContext as HydrisApp
  val outboxRev by app.outbox.revision.collectAsState()
  val online by app.connectivity.online.collectAsState()
  val work = rememberLoad(scope, refreshMs = 15_000) { work(scope) }
  LaunchedEffect(outboxRev, online) { work.reload() }
  val view = remember(work.data.value) { mutableStateOf(work.data.value?.value) }
  val w: WorkData = Loadable(view, work.error, work.nonce)
  Column(Modifier.fillMaxSize().statusBarsPadding()) {
    PageHeader("Operate · field work", "Work", modifier = Modifier.padding(horizontal = 16.dp).padding(top = 12.dp))
    if (tab <= 2) Capsule(listOf("mine" to "Mine", "site" to "My sites"), scope, { scope = it }, Modifier.padding(horizontal = 16.dp).padding(bottom = 10.dp))
    Capsule(TABS.indices.map { it to TABS[it] }, tab, { tab = it }, Modifier.padding(horizontal = 16.dp).horizontalScroll(rememberScrollState()))
    Spacer(Modifier.height(12.dp))
    OfflineBanner(Modifier.padding(horizontal = 16.dp), cachedAt = work.data.value?.cachedAt)
    when (tab) {
      0 -> AlarmsTab(nav, w, scope, onChanged = { work.reload() })
      1 -> RoundsTab(nav, w, scope)
      2 -> MaintenanceTab(nav, w, scope)
      3 -> SensorsTab(nav)
      else -> AuditDocsTab()
    }
  }
}

@Composable
private fun <T> ListOf(l: Loadable<List<T>>, empty: String, emptyBody: String? = null, row: @Composable (T) -> Unit) {
  val data = l.data.value
  when {
    data == null && l.error.value != null -> ErrorNote(l.error.value!!, Modifier.padding(16.dp))
    data == null -> Loading()
    data.isEmpty() -> EmptyState(empty, emptyBody, modifier = Modifier.padding(16.dp))
    else -> LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
      item { Spacer(Modifier.height(4.dp)) }
      itemsIndexed(data) { i, it -> Box(Modifier.appear(i)) { row(it) } }
      item { NavSpacer() }
    }
  }
}

@Composable
private fun <T> derived(w: WorkData, pick: (ai.hydris.field.data.WorkView) -> List<T>): Loadable<List<T>> {
  val v = w.data.value
  return Loadable(remember(v) { mutableStateOf(v?.let(pick)) }, w.error, w.nonce)
}

@Composable
private fun AlarmsTab(nav: NavController, w: WorkData, scope: String, onChanged: () -> Unit) {
  val r = repo()
  val cs = rememberCoroutineScope()
  var busy by remember { mutableStateOf<String?>(null) }
  var err by remember { mutableStateOf<String?>(null) }
  Column {
    err?.let { ErrorNote(it, Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) }
    ListOf(derived(w) { it.alarms }, if (scope == "mine") "No alarms assigned to you" else "No open alarms on your sites",
      if (scope == "mine") "Switch to My sites to see every open alarm where you work." else null) { a ->
      AlarmRow(a, onClick = { nav.navigate("alarm/${a.id}") }) {
        // Quick transitions straight from the list (rendered from the API's allowedActions); resolving needs a note, so it opens the alarm.
        val quick = a.allowedActions.filter { it == "acknowledge" || it == "investigate" }
        if (quick.isNotEmpty() || "resolve" in a.allowedActions) Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          quick.forEach { act ->
            HButton({
              cs.launch { busy = a.id; err = null; runCatching { r.alarmAction(a.id, act) }.onFailure { err = it.message }; busy = null; onChanged() }
            }, Modifier.height(40.dp), enabled = busy == null) { Text(actionLabel(act), fontSize = 14.sp) }
          }
          if ("resolve" in a.allowedActions) HSecondaryButton({ nav.navigate("alarm/${a.id}") }, Modifier.height(40.dp)) { Text("Resolve…", fontSize = 14.sp) }
        }
      }
    }
  }
}

fun actionLabel(a: String) = when (a) {
  "acknowledge" -> "Acknowledge"; "investigate" -> "Investigate"; "resolve" -> "Resolve"; "close" -> "Close"
  "start" -> "Start"; "hold" -> "Put on hold"; "complete" -> "Complete"; else -> label(a)
}

@Composable
fun AlarmRow(a: Alarm, onClick: () -> Unit, extra: @Composable () -> Unit = {}) {
  HCard(Modifier.fillMaxWidth(), onClick = onClick, accent = if (a.severity == "critical" && a.state == "active") Hx.Alert else null, padding = 14.dp) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Dot(Hx.severity(a.severity), 10.dp, pulse = a.severity == "critical" && a.state == "active")
      Column(Modifier.weight(1f).padding(start = 12.dp)) {
        Text(a.title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(listOfNotNull(label(a.state), ago(a.triggeredAt), if (a.mine) "you" else a.assigneeName, a.siteName).joinToString(" · "), color = Hx.Muted, style = MaterialTheme.typography.bodySmall, maxLines = 1)
      }
      SeverityChip(a.severity)
    }
    extra()
  }
}

@Composable
private fun RoundsTab(nav: NavController, w: WorkData, scope: String) {
  val app = LocalContext.current.applicationContext as HydrisApp
  val entries by app.outbox.entries.collectAsState()
  ListOf(derived(w) { it.inspections }, "No rounds", "Rounds assigned to you appear here.") { i ->
    val queued = entries.count { it.inspectionId == i.id && it.kind == "response" && it.state == "pending" }
    val submitQueued = entries.any { it.inspectionId == i.id && it.action == "submit" && it.state == "pending" }
    val answered = (i.answered + queued).coerceAtMost(i.stepCount)
    val overdue = i.dueAt?.let { runCatching { java.time.Instant.parse(it).isBefore(java.time.Instant.now()) }.getOrDefault(false) } == true && i.status != "submitted" && i.status != "approved"
    HCard(Modifier.fillMaxWidth(), onClick = { nav.navigate("round/${i.id}") }, accent = if (overdue) Hx.High else null, padding = 16.dp) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Text(i.title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
        Chip(if (submitQueued) "Submit queued" else label(i.status), when { submitQueued -> Hx.Accent; i.status == "submitted" || i.status == "approved" -> Hx.OkSoft; i.status == "rejected" -> Hx.High; else -> Hx.SignalText })
      }
      Text(listOfNotNull(if (scope == "site" && !i.mine) i.assigneeName ?: "Unassigned" else null, i.assetName, i.siteName, if (overdue) "overdue" else null).joinToString(" · "),
        color = if (overdue) Hx.HighText else Hx.Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp, bottom = 8.dp))
      ProgressBar(if (i.stepCount > 0) answered.toFloat() / i.stepCount else 0f, if (i.priority == "high") Hx.High else Hx.Signal)
      Text("$answered/${i.stepCount} steps${if (queued > 0) " · $queued waiting to sync" else ""}", color = Hx.Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp))
    }
  }
}

@Composable
private fun MaintenanceTab(nav: NavController, w: WorkData, scope: String) {
  ListOf(derived(w) { it.tasks }, if (scope == "mine") "No maintenance assigned to you" else "No open maintenance on your sites") { t ->
    HCard(Modifier.fillMaxWidth(), onClick = { nav.navigate("task/${t.id}") }, accent = if (t.priority == "urgent") Hx.Alert else null, padding = 16.dp) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Text(t.title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
        Chip(label(t.priority), when (t.priority) { "urgent" -> Hx.Critical; "high" -> Hx.High; else -> Hx.Text2 })
      }
      val done = t.checklist.count { it.done }
      Text(listOfNotNull(label(t.status), if (t.mine) "you" else t.assigneeName ?: "Unassigned", t.assetTag, if (t.checklist.isNotEmpty()) "$done/${t.checklist.size} checks" else null).joinToString(" · "),
        color = Hx.Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(vertical = 6.dp))
      if (t.checklist.isNotEmpty()) ProgressBar(done.toFloat() / t.checklist.size, Hx.OkSoft)
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
  val l = rememberLoad(id) { alarmDetail(id) }
  val scope = rememberCoroutineScope()
  var busy by remember { mutableStateOf(false) }
  var err by remember { mutableStateOf<String?>(null) }
  Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
    BackButton { nav.popBackStack() }
    val env = l.data.value
    val a = env?.alarm ?: run { if (l.error.value != null) ErrorNote(l.error.value!!) else Loading(); return@Column }
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
    // Actions come from the API's allowedActions (state machine + this person's permissions).
    val allowed = env.allowedActions
    // Resolving requires a note describing what was done (the API rejects it without one).
    var note by remember(a.state) { mutableStateOf("") }
    if ("resolve" in allowed) HField("What was done (needed to resolve)", note, { note = it }, Modifier.fillMaxWidth(), singleLine = false, minLines = 3)
    if (allowed.isEmpty() && a.state != "closed") Text("No actions available to you for this alarm.", color = Hx.Muted, style = MaterialTheme.typography.bodySmall)
    a.resolutionNote?.let { HCard(Modifier.fillMaxWidth(), padding = 16.dp) { Eyebrow("Resolution"); Text(it, color = Hx.Text, modifier = Modifier.padding(top = 6.dp)) } }
    allowed.forEachIndexed { i, action ->
      val needsNote = action == "resolve" && note.isBlank()
      val click: () -> Unit = { scope.launch { busy = true; err = null; runCatching { r.alarmAction(id, action, note.trim().ifEmpty { null }) }.onFailure { err = it.message }; l.reload(); busy = false } }
      if (i == 0) HButton(click, enabled = !busy && !needsNote, modifier = Modifier.fillMaxWidth().height(52.dp)) { Text(actionLabel(action)) }
      else HSecondaryButton(click, enabled = !busy && !needsNote, modifier = Modifier.fillMaxWidth().height(52.dp)) { Text(actionLabel(action)) }
    }
    if (env.history.isNotEmpty()) HCard(Modifier.fillMaxWidth(), padding = 16.dp) {
      Text("History", style = HxType.Card)
      env.history.takeLast(8).reversed().forEach { e ->
        Column(Modifier.padding(top = 10.dp)) {
          Text("${label(e.action)}${e.actorName?.let { " · $it" } ?: ""}", color = Hx.Text, fontSize = 14.sp)
          e.note?.let { Text(it, color = Hx.Text2, fontSize = 13.sp) }
          Text(ago(e.at), color = Hx.Muted, fontSize = 12.sp)
        }
      }
    }
    NavSpacer()
  }
}
