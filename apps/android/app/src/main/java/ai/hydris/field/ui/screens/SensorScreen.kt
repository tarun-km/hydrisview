package ai.hydris.field.ui.screens

import ai.hydris.field.ui.components.Dot
import ai.hydris.field.ui.components.BackButton
import ai.hydris.field.ui.components.Capsule
import ai.hydris.field.ui.components.NavSpacer
import ai.hydris.field.ui.components.PaperCard
import ai.hydris.field.ui.theme.HxType
import androidx.compose.runtime.key

import ai.hydris.field.ui.components.ErrorNote
import ai.hydris.field.ui.components.Eyebrow
import ai.hydris.field.ui.components.HCard
import ai.hydris.field.ui.components.LineChart
import ai.hydris.field.ui.components.Loading
import ai.hydris.field.ui.components.ago
import ai.hydris.field.ui.components.fmt
import ai.hydris.field.ui.theme.Hx
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController

@Composable
fun SensorScreen(id: String, nav: NavController) {
  var hours by rememberSaveable { mutableIntStateOf(24) }
  val l = rememberLoad(id, hours, refreshMs = 15_000) { history(id, hours) }
  Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
    BackButton { nav.popBackStack() }
    val h = l.data.value ?: run { if (l.error.value != null) ErrorNote(l.error.value!!) else Loading(); return@Column }
    val s = h.sensor
    Eyebrow("${s.tag} · ${s.label}")
    Text(s.name, style = HxType.Page)
    PaperCard(Modifier.fillMaxWidth()) {
      Text("Latest reading", fontSize = 13.5.sp, color = Hx.Ink.copy(alpha = 0.75f))
      Spacer(Modifier.height(12.dp))
      Row(verticalAlignment = Alignment.Bottom) {
        Text(fmt(s.lastValue, s.decimals), style = HxType.Kpi, color = Hx.Ink)
        Text("  ${if (s.unit == "pH") "pH" else s.unit}", fontSize = 15.sp, color = Hx.Ink.copy(alpha = 0.6f), modifier = Modifier.padding(bottom = 4.dp))
      }
      Spacer(Modifier.height(10.dp))
      Row(verticalAlignment = Alignment.CenterVertically) { Dot(if (s.freshness == "live") Hx.OkOnPaper else Hx.freshness(s.freshness), pulse = s.freshness == "live"); Text("  ${s.freshness} · ${h.totalReadings} readings", color = Hx.Ink.copy(alpha = 0.7f), fontSize = 13.sp) }
    }
    Capsule(listOf(6 to "6 h", 24 to "24 h", 168 to "7 d"), hours, { hours = it })
    HCard(Modifier.fillMaxWidth()) {
      Text("Trend", style = HxType.Section)
      Spacer(Modifier.height(14.dp))
      val vals = h.points.map { it.v }
      val typical = s.typicalRange?.takeIf { it.size == 2 }?.let { it[0] to it[1] }
      key(hours) { LineChart(vals, Hx.Accent, typical, Modifier.fillMaxWidth().height(220.dp)) }
      Spacer(Modifier.height(8.dp))
      Row {
        Text("min ${fmt(vals.minOrNull(), s.decimals)}", color = Hx.Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
        typical?.let { Text("typical ${fmt(it.first, s.decimals)}–${fmt(it.second, s.decimals)}", color = Hx.OkText, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f)) }
        Text("max ${fmt(vals.maxOrNull(), s.decimals)}", color = Hx.Muted, style = MaterialTheme.typography.bodySmall)
      }
      Text("${ago(h.from)} → now", color = Hx.Muted, style = MaterialTheme.typography.bodySmall)
    }
    s.explanation?.let { HCard(Modifier.fillMaxWidth()) { Eyebrow("What this measures"); Spacer(Modifier.height(10.dp)); Text(it, color = Hx.Text2, fontSize = 15.sp, lineHeight = 22.sp) } }
    NavSpacer()
  }
}
