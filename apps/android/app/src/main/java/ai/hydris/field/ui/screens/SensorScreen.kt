package ai.hydris.field.ui.screens

import ai.hydris.field.ui.components.Dot
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
  Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
    IconButton({ nav.popBackStack() }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back") }
    val h = l.data.value ?: run { if (l.error.value != null) ErrorNote(l.error.value!!) else Loading(); return@Column }
    val s = h.sensor
    Eyebrow("${s.tag} · ${s.label}")
    Text(s.name, style = MaterialTheme.typography.headlineSmall)
    Row(verticalAlignment = Alignment.Bottom) {
      Text(fmt(s.lastValue, s.decimals), fontSize = 44.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-1).sp)
      Text("  ${if (s.unit == "pH") "pH" else s.unit}", color = Hx.Muted, modifier = Modifier.padding(bottom = 10.dp))
    }
    Row(verticalAlignment = Alignment.CenterVertically) { Dot(Hx.freshness(s.freshness)); Text("  ${s.freshness} · ${h.totalReadings} readings", color = Hx.Muted, style = MaterialTheme.typography.bodySmall) }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      listOf(6 to "6 h", 24 to "24 h", 168 to "7 d").forEach { (hh, t) -> FilterChip(selected = hours == hh, onClick = { hours = hh }, label = { Text(t) }) }
    }
    HCard {
      val vals = h.points.map { it.v }
      val typical = s.typicalRange?.takeIf { it.size == 2 }?.let { it[0] to it[1] }
      LineChart(vals, Hx.Signal, typical, Modifier.fillMaxWidth().height(220.dp))
      Spacer(Modifier.height(8.dp))
      Row {
        Text("min ${fmt(vals.minOrNull(), s.decimals)}", color = Hx.Muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
        typical?.let { Text("typical ${fmt(it.first, s.decimals)}–${fmt(it.second, s.decimals)}", color = Hx.OkSoft, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f)) }
        Text("max ${fmt(vals.maxOrNull(), s.decimals)}", color = Hx.Muted, style = MaterialTheme.typography.bodySmall)
      }
      Text("${ago(h.from)} → now", color = Hx.Muted, style = MaterialTheme.typography.bodySmall)
    }
    s.explanation?.let { HCard { Eyebrow("What this measures"); Spacer(Modifier.height(6.dp)); Text(it, color = Hx.Text2) } }
  }
}
