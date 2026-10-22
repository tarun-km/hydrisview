package ai.hydris.field.ui.screens

import ai.hydris.field.HydrisApp
import ai.hydris.field.data.Session
import ai.hydris.field.ui.components.Bars
import ai.hydris.field.ui.components.Chip
import ai.hydris.field.ui.components.Donut
import ai.hydris.field.ui.components.Dot
import ai.hydris.field.ui.components.ErrorNote
import ai.hydris.field.ui.components.Eyebrow
import ai.hydris.field.ui.components.HCard
import ai.hydris.field.ui.components.KpiTile
import ai.hydris.field.ui.components.Loading
import ai.hydris.field.ui.components.Row2
import ai.hydris.field.ui.components.SectionTitle
import ai.hydris.field.ui.components.ago
import ai.hydris.field.ui.components.fmt
import ai.hydris.field.ui.components.label
import ai.hydris.field.ui.theme.Hx
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
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.Build
import androidx.compose.material.icons.outlined.FactCheck
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import java.time.LocalTime

private val HEALTH = mapOf("operational" to Hx.OkSoft, "degraded" to Hx.High, "down" to Hx.Alert, "maintenance" to Hx.Insight, "standby" to Hx.Muted)

@Composable
fun HomeScreen(session: Session, nav: NavController, onSignOut: () -> Unit) {
  val app = LocalContext.current.applicationContext as HydrisApp
  val glasses by app.glasses.state.collectAsState()
  val ov = rememberLoad(refreshMs = 15_000) { overview() }
  val o = ov.data.value
  val hour = LocalTime.now().hour
  val greet = when { hour < 12 -> "Good morning"; hour < 17 -> "Good afternoon"; else -> "Good evening" }

  LazyColumn(Modifier.fillMaxSize().statusBarsPadding().padding(horizontal = 16.dp)) {
    item {
      Row(Modifier.fillMaxWidth().padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
          Eyebrow(session.org?.name ?: "Hydris")
          Text("$greet, ${session.user.name.substringBefore(' ')}.", style = MaterialTheme.typography.headlineSmall)
        }
        if (session.org?.isDemo == true) Chip("Demo", Hx.SignalText)
        IconButton(onSignOut) { Icon(Icons.AutoMirrored.Outlined.Logout, "Sign out", tint = Hx.Muted) }
      }
      if (o != null) {
        val crit = o.alarms.critical
        Text(
          if (crit > 0) "$crit critical alarm${if (crit > 1) "s need" else " needs"} attention." else if (o.alarms.open > 0) "${o.alarms.open} open alarms, none critical." else "All quiet on your sites.",
          color = if (crit > 0) Hx.Alert else Hx.Text2, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 4.dp),
        )
      }
      Spacer(Modifier.height(16.dp))
    }
    if (o == null) {
      item { if (ov.error.value != null) ErrorNote(ov.error.value!!) else Loading() }
      return@LazyColumn
    }
    item {
      Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row2 {
          KpiTile("Open alarms", "${o.alarms.open}", "${o.alarms.critical} critical · ${o.alarms.active} unacknowledged", Modifier.weight(1f), if (o.alarms.critical > 0) Hx.Alert else Hx.Text, Icons.Outlined.Warning) { nav.navigate("work") }
          KpiTile("Inspections", "${o.inspections.due}", "${o.inspections.overdue} overdue · ${o.inspections.review} in review", Modifier.weight(1f), if (o.inspections.overdue > 0) Hx.High else Hx.Text, Icons.Outlined.FactCheck) { nav.navigate("work") }
        }
        Row2 {
          KpiTile("Maintenance", "${o.maintenance.open}", "${o.maintenance.urgent} high or urgent", Modifier.weight(1f), icon = Icons.Outlined.Build) { nav.navigate("work") }
          KpiTile("Field glasses", "${o.devices.connected}/${o.devices.registered}", if (glasses.registered) "${glasses.deviceName ?: "Ray-Ban Meta"} linked" else "connected now", Modifier.weight(1f), Hx.SignalText, Icons.Outlined.Visibility) { nav.navigate("glasses") }
        }
      }
    }
    item {
      SectionTitle("Alarm trend", "14 days")
      HCard {
        val days = o.alarmTrend.takeLast(14)
        Row(verticalAlignment = Alignment.Bottom) {
          Text("${days.sumOf { it.n }}", fontSize = 28.sp, fontWeight = FontWeight.SemiBold)
          Text("  alarms · ${o.alarms.last24h} in the last 24 h", color = Hx.Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(bottom = 6.dp))
        }
        Spacer(Modifier.height(10.dp))
        Bars(days.map { it.n }, Hx.Signal, Modifier.fillMaxWidth().height(84.dp))
      }
    }
    item {
      SectionTitle("Asset health")
      HCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
          val total = o.assetHealth.sumOf { it.n }
          Donut(o.assetHealth.map { it.n.toFloat() to (HEALTH[it.status] ?: Hx.Muted) }, Modifier.size(112.dp)) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
              Text("$total", fontSize = 24.sp, fontWeight = FontWeight.SemiBold)
              Text("assets", color = Hx.Muted, style = MaterialTheme.typography.bodySmall)
            }
          }
          Spacer(Modifier.width(18.dp))
          Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            o.assetHealth.forEach { h ->
              Row(verticalAlignment = Alignment.CenterVertically) { Dot(HEALTH[h.status] ?: Hx.Muted); Text("  ${label(h.status)}", Modifier.weight(1f), color = Hx.Text2); Text("${h.n}", fontWeight = FontWeight.Medium) }
            }
          }
        }
      }
    }
    item { SectionTitle("Live measurements", "All sensors") { nav.navigate("work") } }
    items(o.metrics.size) { i ->
      val m = o.metrics[i]
      HCard(Modifier.padding(bottom = 8.dp), onClick = { nav.navigate("sensor/${m.id}") }, padding = 14.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Column(Modifier.weight(1f)) {
            Text("${m.label} · ${m.assetTag ?: m.tag}", style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Row(verticalAlignment = Alignment.CenterVertically) { Dot(Hx.freshness(m.freshness), 7.dp); Text("  ${m.freshness} · ${ago(m.ts)}${if (m.source == "simulator") " · synthetic" else ""}", color = Hx.Muted, style = MaterialTheme.typography.bodySmall) }
          }
          Text(fmt(m.value, m.decimals), fontSize = 24.sp, fontWeight = FontWeight.SemiBold)
          Text(" ${if (m.unit == "pH") "" else m.unit}", color = Hx.Muted, style = MaterialTheme.typography.bodySmall)
        }
      }
    }
    item { SectionTitle("Recent alarms") }
    items(o.recentAlarms.size) { i ->
      val a = o.recentAlarms[i]
      HCard(Modifier.padding(bottom = 8.dp), onClick = { nav.navigate("alarm/${a.id}") }, accent = if (a.severity == "critical") Hx.Alert else null, padding = 14.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Dot(Hx.severity(a.severity), 10.dp)
          Column(Modifier.weight(1f).padding(start = 12.dp)) {
            Text(a.title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("${label(a.state)} · ${ago(a.triggeredAt)}", color = Hx.Muted, style = MaterialTheme.typography.bodySmall)
          }
          Chip(a.severity, Hx.severity(a.severity))
        }
      }
    }
    item { SectionTitle("Activity") }
    items(o.activity.take(8).size) { i ->
      val e = o.activity[i]
      Row(Modifier.padding(vertical = 6.dp), verticalAlignment = Alignment.Top) {
        Dot(Hx.SignalText, 6.dp)
        Column(Modifier.padding(start = 12.dp)) {
          Text(e.summary ?: label(e.action.replace('.', ' ')), style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
          Text("${e.actorName ?: e.actorLabel ?: "system"} · ${ago(e.at)}", color = Hx.Muted, style = MaterialTheme.typography.bodySmall)
        }
      }
    }
    item { Spacer(Modifier.height(24.dp)) }
  }
}

@Suppress("unused") private val unused: Color = Color.Unspecified
