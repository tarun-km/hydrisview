package ai.hydris.field.ui.components

import ai.hydris.field.ui.theme.Hx
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.Duration
import java.time.Instant

val CardShape = RoundedCornerShape(22.dp)

@Composable
fun HCard(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, accent: Color? = null, padding: Dp = 16.dp, content: @Composable ColumnScope.() -> Unit) {
  Column(
    modifier
      .clip(CardShape)
      .background(Hx.Surface)
      .border(1.dp, accent?.copy(alpha = 0.55f) ?: Hx.Line, CardShape)
      .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
      .padding(padding),
    content = content,
  )
}

@Composable
fun Eyebrow(text: String, color: Color = Hx.Muted) = Text(text.uppercase(), style = MaterialTheme.typography.labelSmall, color = color)

@Composable
fun SectionTitle(title: String, action: String? = null, onAction: (() -> Unit)? = null) {
  Row(Modifier.fillMaxWidth().padding(top = 20.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
    Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
    if (action != null && onAction != null) Text(action, color = Hx.SignalText, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.clickable(onClick = onAction).padding(6.dp))
  }
}

@Composable
fun Chip(text: String, color: Color = Hx.Text2, filled: Boolean = false, modifier: Modifier = Modifier) {
  Text(
    text, color = if (filled) Color.White else color, fontSize = 12.sp, fontWeight = FontWeight.Medium, maxLines = 1,
    modifier = modifier.clip(RoundedCornerShape(50)).background(if (filled) color else color.copy(alpha = 0.14f)).padding(horizontal = 10.dp, vertical = 4.dp),
  )
}

@Composable
fun Dot(color: Color, size: Dp = 8.dp) = Box(Modifier.size(size).clip(CircleShape).background(color))

/** KPI tile: big number, label and a sub line; accent colours the number. */
@Composable
fun KpiTile(label: String, value: String, sub: String, modifier: Modifier = Modifier, accent: Color = Hx.Text, icon: ImageVector? = null, onClick: (() -> Unit)? = null) {
  HCard(modifier, onClick = onClick) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Text(label, color = Hx.Text2, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
      if (icon != null) Icon(icon, null, tint = Hx.Muted, modifier = Modifier.size(18.dp))
    }
    Spacer(Modifier.height(10.dp))
    Text(value, color = accent, fontSize = 34.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-1).sp)
    Text(sub, color = Hx.Muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
  }
}

@Composable
fun Loading(modifier: Modifier = Modifier) = Box(modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = Hx.Signal) }

@Composable
fun ErrorNote(text: String, modifier: Modifier = Modifier) {
  Text(text, color = Hx.High, style = MaterialTheme.typography.bodyMedium, modifier = modifier.clip(RoundedCornerShape(14.dp)).background(Hx.High.copy(alpha = 0.1f)).padding(12.dp))
}

@Composable
fun ProgressBar(fraction: Float, color: Color = Hx.Signal, modifier: Modifier = Modifier) {
  Box(modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(50)).background(Hx.Line)) {
    Box(Modifier.fillMaxWidth(fraction.coerceIn(0f, 1f)).height(6.dp).clip(RoundedCornerShape(50)).background(color))
  }
}

@Composable
fun Row2(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) = Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), content = content)

// ------------------------------------------------------------------ charts (Canvas, no chart library)

/** Compact line for list rows. */
@Composable
fun Sparkline(values: List<Double>, color: Color, modifier: Modifier = Modifier) {
  Canvas(modifier) {
    if (values.size < 2) return@Canvas
    val lo = values.min(); val hi = values.max(); val span = (hi - lo).takeIf { it > 1e-9 } ?: 1.0
    val path = Path()
    values.forEachIndexed { i, v ->
      val x = size.width * i / (values.size - 1)
      val y = size.height - (((v - lo) / span) * size.height * 0.85 + size.height * 0.075).toFloat()
      if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
    }
    drawPath(path, color, style = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round))
  }
}

/** Time-series chart with the measurand's typical range shaded and min/max labels. */
@Composable
fun LineChart(values: List<Double>, color: Color, typical: Pair<Double, Double>?, modifier: Modifier = Modifier) {
  Canvas(modifier) {
    if (values.size < 2) return@Canvas
    var lo = values.min(); var hi = values.max()
    typical?.let { lo = minOf(lo, it.first); hi = maxOf(hi, it.second) }
    val pad = (hi - lo).takeIf { it > 1e-9 }?.times(0.08) ?: 1.0
    lo -= pad; hi += pad
    fun y(v: Double) = (size.height - (v - lo) / (hi - lo) * size.height).toFloat()
    typical?.let { (a, b) -> drawRect(Hx.OkSoft.copy(alpha = 0.08f), Offset(0f, y(b)), Size(size.width, y(a) - y(b))) }
    for (g in 1..3) drawLine(Hx.Line, Offset(0f, size.height * g / 4), Offset(size.width, size.height * g / 4), strokeWidth = 1f)
    val path = Path(); val fill = Path()
    values.forEachIndexed { i, v ->
      val x = size.width * i / (values.size - 1)
      if (i == 0) { path.moveTo(x, y(v)); fill.moveTo(x, size.height); fill.lineTo(x, y(v)) } else { path.lineTo(x, y(v)); fill.lineTo(x, y(v)) }
    }
    fill.lineTo(size.width, size.height); fill.close()
    drawPath(fill, Brush.verticalGradient(listOf(color.copy(alpha = 0.28f), Color.Transparent)))
    drawPath(path, color, style = Stroke(width = 2.5.dp.toPx(), cap = StrokeCap.Round))
    drawCircle(color, 4.dp.toPx(), Offset(size.width, y(values.last())))
  }
}

/** Daily bars (alarm trend). */
@Composable
fun Bars(values: List<Int>, color: Color, modifier: Modifier = Modifier) {
  Canvas(modifier) {
    if (values.isEmpty()) return@Canvas
    val max = (values.maxOrNull() ?: 1).coerceAtLeast(1)
    val gap = 4.dp.toPx()
    val w = (size.width - gap * (values.size - 1)) / values.size
    values.forEachIndexed { i, v ->
      val h = (size.height * v / max).coerceAtLeast(2.dp.toPx())
      drawRoundRect(if (i == values.lastIndex) color else color.copy(alpha = 0.45f), Offset(i * (w + gap), size.height - h), Size(w, h), CornerRadius(4.dp.toPx()))
    }
  }
}

/** Donut for compositions (asset health). */
@Composable
fun Donut(parts: List<Pair<Float, Color>>, modifier: Modifier = Modifier, thickness: Dp = 14.dp, center: @Composable () -> Unit = {}) {
  Box(modifier, contentAlignment = Alignment.Center) {
    Canvas(Modifier.fillMaxSize()) {
      val total = parts.sumOf { it.first.toDouble() }.toFloat().takeIf { it > 0 } ?: 1f
      val stroke = thickness.toPx()
      val inset = stroke / 2
      var start = -90f
      parts.forEach { (v, c) ->
        val sweep = 360f * v / total
        drawArc(c, start, (sweep - 2f).coerceAtLeast(0.5f), false, Offset(inset, inset), Size(size.width - stroke, size.height - stroke), style = Stroke(stroke, cap = StrokeCap.Butt))
        start += sweep
      }
    }
    center()
  }
}

// ------------------------------------------------------------------ formatting
fun ago(iso: String?): String {
  if (iso == null) return "never"
  val s = runCatching { Duration.between(Instant.parse(iso), Instant.now()).seconds }.getOrNull() ?: return ""
  return when {
    s < 10 -> "just now"
    s < 90 -> "${s}s ago"
    s < 5400 -> "${s / 60}m ago"
    s < 129600 -> "${s / 3600}h ago"
    else -> "${s / 86400}d ago"
  }
}
fun fmt(v: Double?, decimals: Int = 2): String = v?.let { "%.${decimals.coerceIn(0, 3)}f".format(it) } ?: "—"
fun label(s: String) = s.replace('_', ' ').replaceFirstChar { it.uppercase() }
fun Modifier.widthFraction(f: Float) = this.fillMaxWidth(f)
@Suppress("unused") private val keep = Modifier.width(0.dp)
