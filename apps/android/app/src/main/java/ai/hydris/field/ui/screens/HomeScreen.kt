package ai.hydris.field.ui.screens

import ai.hydris.field.HydrisApp
import ai.hydris.field.data.InspectionSummary
import ai.hydris.field.data.Session
import ai.hydris.field.data.Shift
import ai.hydris.field.ui.components.Avatar
import ai.hydris.field.ui.components.BrandCard
import ai.hydris.field.ui.components.Chip
import ai.hydris.field.ui.components.CountUp
import ai.hydris.field.ui.components.Dot
import ai.hydris.field.ui.components.EmptyState
import ai.hydris.field.ui.components.ErrorNote
import ai.hydris.field.ui.components.Eyebrow
import ai.hydris.field.ui.components.HButton
import ai.hydris.field.ui.components.HCard
import ai.hydris.field.ui.components.HLightButton
import ai.hydris.field.ui.components.NavSpacer
import ai.hydris.field.ui.components.OfflineBanner
import ai.hydris.field.ui.components.ProgressBar
import ai.hydris.field.ui.components.SectionTitle
import ai.hydris.field.ui.components.SeverityChip
import ai.hydris.field.ui.components.Skeleton
import ai.hydris.field.ui.components.ago
import ai.hydris.field.ui.components.appear
import ai.hydris.field.ui.components.fmt
import ai.hydris.field.ui.components.label
import ai.hydris.field.ui.components.pressable
import ai.hydris.field.ui.theme.Hx
import ai.hydris.field.ui.theme.HxShape
import ai.hydris.field.ui.theme.HxType
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.ui.draw.clip
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import java.time.Instant
import java.time.LocalTime

/** "My shift": the operator's day at a glance, scoped to their sites and assignments (GET /me/shift). */
@Composable
fun HomeScreen(session: Session, nav: NavController) {
  val app = LocalContext.current.applicationContext as HydrisApp
  val glasses by app.glasses.state.collectAsState()
  val outboxRev by app.outbox.revision.collectAsState()
  val online by app.connectivity.online.collectAsState()
  val l = rememberLoad(refreshMs = 20_000) { shift() }
  // Local changes (queued answers, submits) and reconnecting refresh the shift.
  LaunchedEffect(outboxRev, online) { l.reload() }
  val fresh = l.data.value
  val s = fresh?.value
  val name = s?.profile?.user?.name ?: session.user.name
  val hour = LocalTime.now().hour
  val greet = when { hour < 5 -> "Good evening"; hour < 12 -> "Good morning"; hour < 17 -> "Good afternoon"; else -> "Good evening" }

  LazyColumn(Modifier.fillMaxSize().statusBarsPadding().padding(horizontal = 16.dp)) {
    item {
      Row(Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Avatar(name, 44.dp, Modifier.pressable(scale = 0.94f) { nav.navigate("profile") }.semantics { contentDescription = "Profile" })
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
          Text(s?.profile?.org?.name ?: session.org?.name ?: "Hydris", style = androidx.compose.material3.MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
          Text(s?.profile?.title ?: if (session.accountType == "admin") "Administrator" else "Field Operator", color = Hx.Muted, fontSize = 12.5.sp, maxLines = 1)
        }
        GlassesChip(glasses.registered, glasses.linkState, glasses.battery) { nav.navigate("glasses") }
      }
      OfflineBanner(cachedAt = fresh?.cachedAt)
      Column(Modifier.appear()) {
        Eyebrow(listOfNotNull("My shift", s?.profile?.shiftLabel).joinToString(" · "))
        Spacer(Modifier.height(10.dp))
        Text("$greet, ${name.substringBefore(' ')}.", style = HxType.Page)
        if (s != null) Text(summary(s), style = HxType.Page, color = Hx.Muted)
        if (s != null && s.profile.sites.isNotEmpty()) {
          Spacer(Modifier.height(12.dp))
          Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            s.profile.sites.take(3).forEach { Chip(it.name, Hx.Text2) }
            if (s.profile.sites.size > 3) Chip("+${s.profile.sites.size - 3}")
          }
        }
      }
      Spacer(Modifier.height(20.dp))
    }
    if (s == null) {
      item {
        if (l.error.value != null) ErrorNote(l.error.value!!)
        else Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
          Skeleton(Modifier.fillMaxWidth().height(150.dp), HxShape.Xl)
          Skeleton(Modifier.fillMaxWidth().height(120.dp), HxShape.Xl)
          Skeleton(Modifier.fillMaxWidth().height(90.dp), HxShape.Xl)
        }
      }
      return@LazyColumn
    }

    // Shift progress: rounds done of assigned today.
    item {
      BrandCard(Modifier.fillMaxWidth().appear(1)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Text("Rounds today", style = HxType.Section, color = Color.White, modifier = Modifier.weight(1f))
          if (s.progress.overdue > 0) Chip("${s.progress.overdue} overdue", Color.White, filled = true)
        }
        Spacer(Modifier.height(14.dp))
        Row(verticalAlignment = Alignment.Bottom) {
          CountUp("${s.progress.done}", HxType.Kpi, Color.White)
          Text(" / ${s.progress.assigned}", style = HxType.KpiSm, color = Color.White.copy(alpha = 0.75f), modifier = Modifier.padding(bottom = 2.dp))
        }
        Text(
          if (s.progress.assigned == 0) "No rounds assigned yet." else if (s.progress.done == s.progress.assigned) "All rounds submitted. Nice work." else "${s.progress.assigned - s.progress.done} to go${if (s.progress.inProgress > 0) " · ${s.progress.inProgress} in progress" else ""}",
          color = Color.White.copy(alpha = 0.86f), fontSize = 14.sp, modifier = Modifier.padding(top = 4.dp, bottom = 14.dp),
        )
        ProgressBar(if (s.progress.assigned > 0) s.progress.done.toFloat() / s.progress.assigned else 0f, Color.White)
      }
    }

    // Next round + start.
    item {
      Spacer(Modifier.height(12.dp))
      val next = s.nextRound
      if (next == null) HCard(Modifier.fillMaxWidth().appear(2)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Icon(Icons.Outlined.CheckCircle, null, tint = Hx.OkFill, modifier = Modifier.size(26.dp))
          Column(Modifier.padding(start = 12.dp)) {
            Text("Nothing waiting", style = HxType.Card)
            Text("New rounds assigned to you appear here.", color = Hx.Muted, style = HxType.Label)
          }
        }
      } else NextRoundCard(next, app.outbox.pendingFor(next.id).count { it.kind == "response" }) { nav.navigate("round/${next.id}") }
    }

    // My alarms (assigned to me or at my sites).
    item { SectionTitle("My alarms", if (s.alarms.open > 0) "All ${s.alarms.open}" else null) { nav.navigate("work") } }
    if (s.alarms.items.isEmpty()) item { EmptyState("No open alarms on your sites", "Alarms raised at your sites show here.", modifier = Modifier.padding(bottom = 8.dp)) }
    items(s.alarms.items.take(4).size) { i ->
      val a = s.alarms.items[i]
      HCard(Modifier.fillMaxWidth().padding(bottom = 10.dp).appear(i), onClick = { nav.navigate("alarm/${a.id}") }, accent = if (a.severity == "critical" && a.state == "active") Hx.Critical else null, padding = 16.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Dot(Hx.severity(a.severity), 10.dp, pulse = a.state == "active" && a.severity == "critical")
          Column(Modifier.weight(1f).padding(start = 12.dp, end = 8.dp)) {
            Text(a.title, style = HxType.Card, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(listOfNotNull(label(a.state), ago(a.triggeredAt), if (a.mine) "assigned to you" else a.siteName).joinToString(" · "), color = Hx.Muted, style = HxType.Label, maxLines = 1)
          }
          SeverityChip(a.severity)
        }
      }
    }

    // My maintenance.
    item { SectionTitle("My maintenance", if (s.tasks.open > 0) "All ${s.tasks.open}" else null) { nav.navigate("work") } }
    if (s.tasks.items.isEmpty()) item { EmptyState("No maintenance assigned", "Tasks assigned to you appear here.", modifier = Modifier.padding(bottom = 8.dp)) }
    items(s.tasks.items.take(3).size) { i ->
      val t = s.tasks.items[i]
      val done = t.checklist.count { it.done }
      HCard(Modifier.fillMaxWidth().padding(bottom = 10.dp).appear(i), onClick = { nav.navigate("task/${t.id}") }, accent = if (t.priority == "urgent") Hx.Critical else null, padding = 16.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Column(Modifier.weight(1f).padding(end = 8.dp)) {
            Text(t.title, style = HxType.Card, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text("${label(t.status)}${t.assetTag?.let { " · $it" } ?: ""}${if (t.checklist.isNotEmpty()) " · $done/${t.checklist.size} checks" else ""}", color = Hx.Muted, style = HxType.Label)
          }
          Chip(label(t.priority), when (t.priority) { "urgent" -> Hx.Critical; "high" -> Hx.High; else -> Hx.Text2 })
        }
      }
    }

    // Plant status for my sites (compact readings).
    if (s.plant.isNotEmpty()) {
      item { SectionTitle("Plant status", "Sensors") { nav.navigate("work") } }
      item {
        HCard(Modifier.fillMaxWidth().appear(1), padding = 6.dp) {
          s.plant.take(8).chunked(2).forEach { pair ->
            Row(Modifier.fillMaxWidth()) {
              pair.forEach { m ->
                Column(Modifier.weight(1f).pressable { nav.navigate("sensor/${m.id}") }.padding(14.dp)) {
                  Row(verticalAlignment = Alignment.CenterVertically) {
                    Dot(if (m.openAlarms > 0) Hx.Critical else Hx.freshness(m.freshness), 6.dp)
                    Text("  ${m.assetTag ?: m.tag}", color = Hx.Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                  }
                  Row(verticalAlignment = Alignment.Bottom, modifier = Modifier.padding(top = 4.dp)) {
                    Text(fmt(m.value, if (m.unit == "pH") 2 else 1), style = HxType.KpiSm.copy(fontSize = 24.sp), color = if (m.openAlarms > 0) Hx.CriticalText else Hx.Text)
                    Text(" ${m.unit}", color = Hx.Muted, fontSize = 12.sp, modifier = Modifier.padding(bottom = 3.dp))
                  }
                  Text(m.name, color = Hx.Text2, fontSize = 12.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
              }
              if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
          }
        }
      }
    }
    item { Spacer(Modifier.height(8.dp)); NavSpacer() }
  }
}

private fun summary(s: Shift): String {
  val crit = s.alarms.items.count { it.severity == "critical" && it.state == "active" }
  val left = s.progress.assigned - s.progress.done
  return when {
    crit > 0 -> "$crit critical alarm${if (crit > 1) "s need" else " needs"} you."
    left > 0 -> "$left round${if (left > 1) "s" else ""} left today."
    s.alarms.open > 0 -> "${s.alarms.open} open alarm${if (s.alarms.open > 1) "s" else ""} on your sites."
    else -> "All quiet on your sites."
  }
}

@Composable
private fun NextRoundCard(r: InspectionSummary, queued: Int, onStart: () -> Unit) {
  val overdue = r.dueAt?.let { runCatching { Instant.parse(it).isBefore(Instant.now()) }.getOrDefault(false) } == true
  val answered = (r.answered + queued).coerceAtMost(r.stepCount)
  HCard(Modifier.fillMaxWidth().appear(2), onClick = onStart, accent = if (overdue || r.priority == "high") Hx.High else null) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Eyebrow(if (r.status == "in_progress" || r.status == "paused") "Continue round" else "Next round", modifier = Modifier.weight(1f))
      if (overdue) Chip("Overdue", Hx.High) else r.dueAt?.let { Chip("Due ${due(it)}") }
    }
    Spacer(Modifier.height(10.dp))
    Text(r.title, style = HxType.Section, maxLines = 2, overflow = TextOverflow.Ellipsis)
    Text(listOfNotNull(r.assetName, r.siteName).joinToString(" · "), color = Hx.Muted, style = HxType.Label, modifier = Modifier.padding(top = 4.dp, bottom = 14.dp))
    ProgressBar(if (r.stepCount > 0) answered.toFloat() / r.stepCount else 0f, if (r.priority == "high") Hx.High else Hx.Signal)
    Text("$answered of ${r.stepCount} steps", color = Hx.Muted, style = HxType.Label, modifier = Modifier.padding(top = 6.dp, bottom = 14.dp))
    HButton(onStart, Modifier.fillMaxWidth().height(52.dp)) {
      Text(if (answered > 0) "Continue round" else "Start round", fontWeight = FontWeight.SemiBold)
      Spacer(Modifier.width(8.dp))
      Icon(Icons.AutoMirrored.Outlined.ArrowForward, null, modifier = Modifier.size(18.dp))
    }
  }
}

private fun due(iso: String): String = runCatching {
  val t = Instant.parse(iso).atZone(java.time.ZoneId.systemDefault())
  "%02d:%02d".format(t.hour, t.minute)
}.getOrDefault("")

@Composable
private fun GlassesChip(registered: Boolean, link: String?, battery: Int?, onClick: () -> Unit) {
  val connected = link?.contains("connect", true) == true && link?.contains("dis", true) != true
  val (text, color) = when {
    connected -> "Glasses${battery?.let { " · $it%" } ?: ""}" to Hx.Ok
    registered -> "Glasses linked" to Hx.Accent
    else -> "No glasses" to Hx.Muted
  }
  Row(
    Modifier.clip(HxShape.Pill).background(Hx.Surface2).border(1.dp, Hx.Line2, HxShape.Pill).pressable(scale = 0.95f, onClick = onClick).padding(horizontal = 12.dp, vertical = 8.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Dot(color, 7.dp, pulse = connected)
    Text("  $text", fontSize = 12.5.sp, fontWeight = FontWeight.Medium, color = Hx.Text2)
  }
}

