package ai.hydris.field.ui.screens

import ai.hydris.field.HydrisApp
import ai.hydris.field.data.Session
import ai.hydris.field.ui.components.Bars
import ai.hydris.field.ui.components.BrandCard
import ai.hydris.field.ui.components.Chip
import ai.hydris.field.ui.components.CountUp
import ai.hydris.field.ui.components.Donut
import ai.hydris.field.ui.components.Dot
import ai.hydris.field.ui.components.ErrorNote
import ai.hydris.field.ui.components.Eyebrow
import ai.hydris.field.ui.components.HCard
import ai.hydris.field.ui.components.HIconButton
import ai.hydris.field.ui.components.HydrisLogo
import ai.hydris.field.ui.components.KpiTile
import ai.hydris.field.ui.components.LivePill
import ai.hydris.field.ui.components.Loading
import ai.hydris.field.ui.components.NavSpacer
import ai.hydris.field.ui.components.Row2
import ai.hydris.field.ui.components.SectionTitle
import ai.hydris.field.ui.components.SeverityChip
import ai.hydris.field.ui.components.ago
import ai.hydris.field.ui.components.appear
import ai.hydris.field.ui.components.fmt
import ai.hydris.field.ui.components.label
import ai.hydris.field.ui.components.pressable
import ai.hydris.field.ui.theme.Hx
import ai.hydris.field.ui.theme.HxType
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
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
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter

/** Asset-health palette exactly as the console overview (OK fill, medium, critical, cobalt, muted). */
private val HEALTH = mapOf("operational" to Hx.OkFill, "degraded" to Hx.Medium, "down" to Hx.Critical, "maintenance" to Hx.Purple, "standby" to Hx.Muted)

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
      // Top bar (console Shell on phones): logo disc, org name, Live pill, account action.
      Row(Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 18.dp), verticalAlignment = Alignment.CenterVertically) {
        HydrisLogo(44.dp)
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
          Text(session.org?.name ?: "Hydris", style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
          if (session.org?.isDemo == true) Text("Demo tenant", color = Hx.PurpleText, fontSize = 12.sp)
        }
        LivePill()
        Spacer(Modifier.width(8.dp))
        HIconButton(Icons.AutoMirrored.Outlined.Logout, "Sign out", onSignOut, size = 40.dp)
      }
      Column(Modifier.appear()) {
        Eyebrow("Overview · updated ${o?.let { ago(it.generatedAt) } ?: "now"}")
        Spacer(Modifier.height(12.dp))
        Text("$greet, ${session.user.name.substringBefore(' ')}.", style = HxType.Page)
        if (o != null) {
          val crit = o.alarms.critical
          Text(
            if (crit > 0) "$crit critical alarm${if (crit > 1) "s need" else " needs"} attention." else if (o.alarms.open > 0) "${o.alarms.open} open alarms, none critical." else "All quiet on your sites.",
            style = HxType.Page, color = Hx.Muted,
          )
        }
      }
      Spacer(Modifier.height(22.dp))
    }
    if (o == null) {
      item { if (ov.error.value != null) ErrorNote(ov.error.value!!) else Loading() }
      return@LazyColumn
    }
    item {
      Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row2(Modifier.height(IntrinsicSize.Min).appear(1)) {
          KpiTile("Open alarms", "${o.alarms.open}", "${o.alarms.critical} critical · ${o.alarms.active} unacknowledged", Modifier.weight(1f).fillMaxHeight(), if (o.alarms.critical > 0) Hx.Critical else Hx.Text) { nav.navigate("work") }
          KpiTile("Inspections due", "${o.inspections.due}", "${o.inspections.overdue} overdue · ${o.inspections.review} awaiting review", Modifier.weight(1f).fillMaxHeight(), if (o.inspections.overdue > 0) Hx.High else Hx.Text) { nav.navigate("work") }
        }
        Row2(Modifier.height(IntrinsicSize.Min).appear(2)) {
          KpiTile("Open maintenance", "${o.maintenance.open}", "${o.maintenance.urgent} high or urgent priority", Modifier.weight(1f).fillMaxHeight()) { nav.navigate("work") }
          KpiTile("Field glasses connected", "${o.devices.connected}/${o.devices.registered}", if (glasses.registered) "${glasses.deviceName ?: "Ray-Ban Meta"} linked" else "${o.activeOperators} operators with assigned glasses", Modifier.weight(1f).fillMaxHeight()) { nav.navigate("glasses") }
        }
      }
    }
    // Process snapshot - the focal Hydris-blue panel.
    if (o.metrics.isNotEmpty()) item {
      Spacer(Modifier.height(12.dp))
      BrandCard(Modifier.fillMaxWidth().appear(3)) {
        Text("Process snapshot", style = HxType.Section, color = Color.White)
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          if (o.metrics.any { it.source == "simulator" }) Chip("Synthetic demo data", Color.White, filled = true, modifier = Modifier)
          Chip("All sensors", Color.White, filled = true, modifier = Modifier.pressable { nav.navigate("work") })
        }
        Spacer(Modifier.height(18.dp))
        o.metrics.take(6).chunked(2).forEach { pair ->
          Row(Modifier.fillMaxWidth().padding(bottom = 16.dp)) {
            pair.forEach { m ->
              Column(Modifier.weight(1f).pressable { nav.navigate("sensor/${m.id}") }) {
                Row(verticalAlignment = Alignment.Bottom) {
                  Text(fmt(m.value, m.decimals), style = HxType.KpiSm, color = Color.White)
                  Text(" ${m.unit}", fontSize = 13.sp, color = Color.White.copy(alpha = 0.84f), modifier = Modifier.padding(bottom = 3.dp))
                }
                Text("${m.label} · ${m.assetTag ?: m.tag}", fontSize = 13.sp, fontWeight = FontWeight.Medium, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Row(verticalAlignment = Alignment.CenterVertically) {
                  Dot(if (m.freshness == "live") Color.White.copy(alpha = 0.84f) else Hx.Medium, 5.dp)
                  Text("  observed ${ago(m.ts)}", fontSize = 12.sp, color = Color.White.copy(alpha = 0.84f), maxLines = 1)
                }
              }
            }
            if (pair.size == 1) Spacer(Modifier.weight(1f))
          }
        }
      }
    }
    item {
      Spacer(Modifier.height(12.dp))
      HCard(Modifier.fillMaxWidth().appear(4)) {
        val days = o.alarmTrend.takeLast(14)
        Row(verticalAlignment = Alignment.CenterVertically) {
          Text("Alarm frequency", style = HxType.Section, modifier = Modifier.weight(1f))
          Text("last 14 days", style = HxType.Label, color = Hx.Muted)
        }
        Spacer(Modifier.height(10.dp))
        CountUp("${o.alarms.last24h}", HxType.Kpi, Hx.Text)
        Text("raised in the last 24 h", style = HxType.Label, color = Hx.Muted, modifier = Modifier.padding(top = 4.dp))
        Spacer(Modifier.height(14.dp))
        val peak = days.maxByOrNull { it.n }
        if (peak != null && peak.n > 0) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
          Text("${peak.n}", fontSize = 11.5.sp, fontWeight = FontWeight.Medium, color = Hx.Text)
          Text(" · ${dayLabel(peak.day)}", fontSize = 11.5.sp, color = Hx.Muted)
        }
        Spacer(Modifier.height(4.dp))
        Bars(days.map { it.n }, Hx.Surface3, Modifier.fillMaxWidth().height(78.dp), highlight = Hx.Critical)
        Row(Modifier.fillMaxWidth().padding(top = 6.dp)) {
          Text(days.firstOrNull()?.let { dayLabel(it.day) } ?: "", fontSize = 11.sp, color = Hx.Muted, modifier = Modifier.weight(1f))
          Text("today", fontSize = 11.sp, color = Hx.Muted)
        }
      }
    }
    item {
      Spacer(Modifier.height(12.dp))
      HCard(Modifier.fillMaxWidth().appear(5)) {
        Text("Asset health", style = HxType.Section)
        Spacer(Modifier.height(16.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
          val total = o.assetHealth.sumOf { it.n }
          Donut(o.assetHealth.map { it.n.toFloat() to (HEALTH[it.status] ?: Hx.Muted) }, Modifier.size(124.dp)) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
              CountUp("$total", HxType.KpiSm, Hx.Text)
              Text("assets", color = Hx.Muted, style = HxType.Label)
            }
          }
          Spacer(Modifier.width(20.dp))
          Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            o.assetHealth.forEach { h ->
              Row(verticalAlignment = Alignment.CenterVertically) {
                Dot(HEALTH[h.status] ?: Hx.Muted)
                Text("  ${label(h.status)}", Modifier.weight(1f), color = Hx.Text2, fontSize = 13.5.sp)
                Text("${h.n}", fontWeight = FontWeight.Medium, style = HxType.Num)
              }
            }
          }
        }
      }
    }
    item { SectionTitle("Live measurements", "All sensors") { nav.navigate("work") } }
    items(o.metrics.size) { i ->
      val m = o.metrics[i]
      HCard(Modifier.fillMaxWidth().padding(bottom = 10.dp).appear(i), onClick = { nav.navigate("sensor/${m.id}") }, padding = 16.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Column(Modifier.weight(1f)) {
            Text("${m.label} · ${m.assetTag ?: m.tag}", style = HxType.Card, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
              Dot(Hx.freshness(m.freshness), 7.dp, pulse = m.freshness == "live")
              Text("  ${m.freshness} · ${ago(m.ts)}", color = Hx.Muted, style = HxType.Label)
              if (m.source == "simulator") { Spacer(Modifier.width(8.dp)); Text("Synthetic", color = Hx.PurpleText, fontSize = 12.sp) }
            }
          }
          Text(fmt(m.value, m.decimals), style = HxType.KpiSm)
          Text(" ${if (m.unit == "pH") "pH" else m.unit}", color = Hx.Muted, style = HxType.Label)
        }
      }
    }
    item { SectionTitle("Recent alarms") }
    items(o.recentAlarms.size) { i ->
      val a = o.recentAlarms[i]
      HCard(Modifier.fillMaxWidth().padding(bottom = 10.dp).appear(i), onClick = { nav.navigate("alarm/${a.id}") }, accent = if (a.severity == "critical" && a.state == "active") Hx.Critical else null, padding = 16.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Dot(Hx.severity(a.severity), 10.dp)
          Column(Modifier.weight(1f).padding(start = 12.dp, end = 8.dp)) {
            Text(a.title, style = HxType.Card, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("${label(a.state)} · ${ago(a.triggeredAt)}", color = Hx.Muted, style = HxType.Label)
          }
          SeverityChip(a.severity)
        }
      }
    }
    item { SectionTitle("Activity") }
    item {
      HCard(Modifier.fillMaxWidth()) {
        o.activity.take(8).forEachIndexed { i, e ->
          Row(Modifier.padding(vertical = 7.dp), verticalAlignment = Alignment.Top) {
            Dot(if (i == 0) Hx.Signal else Hx.Surface3, 8.dp)
            Column(Modifier.padding(start = 12.dp).weight(1f)) {
              Text(e.summary ?: label(e.action.replace('.', ' ')), style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
              Text("${e.actorName ?: e.actorLabel ?: "system"} · ${ago(e.at)}", color = Hx.Muted, style = HxType.Label)
            }
          }
        }
      }
    }
    item { Spacer(Modifier.height(8.dp)); NavSpacer() }
  }
}

private fun dayLabel(day: String): String = runCatching { LocalDate.parse(day.take(10)).format(DateTimeFormatter.ofPattern("dd MMM")) }.getOrDefault(day)
