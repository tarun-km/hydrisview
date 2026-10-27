package ai.hydris.field.ui.components

import ai.hydris.field.ui.theme.Hx
import ai.hydris.field.ui.theme.HxMotion
import ai.hydris.field.ui.theme.HxShape
import ai.hydris.field.ui.theme.HxType
import ai.hydris.field.ui.theme.LocalReducedMotion
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.automirrored.outlined.CallMade
import androidx.compose.material3.ButtonColors
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldColors
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.addOutline
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.Duration
import java.time.Instant

val CardShape = HxShape.Xl

// ------------------------------------------------------------------ motion helpers

/** Press feedback (.btn:active scale .97 / .icon-btn:active .92). Returns a modifier + the interaction source to pass to clickable. */
@Composable
fun rememberPress(scale: Float = 0.97f): Pair<MutableInteractionSource, Modifier> {
  val src = remember { MutableInteractionSource() }
  val pressed by src.collectIsPressedAsState()
  val reduced = LocalReducedMotion.current
  val s by animateFloatAsState(if (pressed && !reduced) scale else 1f, tween(HxMotion.Fast, easing = HxMotion.EaseOut), label = "press")
  return src to Modifier.graphicsLayer { scaleX = s; scaleY = s }
}

/** Clickable with the web press-scale; no ripple (the web uses scale + colour, not ink). */
fun Modifier.pressable(enabled: Boolean = true, scale: Float = 0.97f, role: Role = Role.Button, onClick: () -> Unit): Modifier = composed {
  val (src, mod) = rememberPress(scale)
  this.then(mod).clickable(src, indication = null, enabled = enabled, role = role, onClick = onClick)
}

/** .fade-in / .stagger: opacity + 6dp rise, 420 ms ease-out, optional delay (index * 40 ms, capped at 200 ms). */
fun Modifier.appear(index: Int = 0): Modifier = composed {
  val reduced = LocalReducedMotion.current
  val a = remember { Animatable(if (reduced) 1f else 0f) }
  LaunchedEffect(Unit) { if (!reduced) a.animateTo(1f, tween(420, delayMillis = (index * 40).coerceAtMost(200), easing = HxMotion.EaseOut)) }
  this.graphicsLayer { alpha = a.value; translationY = (1f - a.value) * 6.dp.toPx() }
}

/** 0 → 1 progress for chart draw-in (.chart-bar / .chart-arc, 700 ms ease-out); keyed so new data re-animates only on first show. */
@Composable
fun rememberDrawIn(ms: Int = HxMotion.Chart): Float {
  val reduced = LocalReducedMotion.current
  val a = remember { Animatable(if (reduced) 1f else 0f) }
  LaunchedEffect(Unit) { if (!reduced) a.animateTo(1f, tween(ms, easing = HxMotion.EaseOut)) }
  return a.value
}

// ------------------------------------------------------------------ surfaces

/** The top-edge sheen (--sheen: inset 0 1px 0 rgb(255 255 255 / .045)). */
fun Modifier.sheen(shape: Shape = CardShape, color: Color = Color(0x0BFFFFFF)): Modifier = drawBehind {
  val o = shape.createOutline(size, layoutDirection, this)
  val p = Path().apply { addOutline(o) }
  clipRect(bottom = 1.dp.toPx() + 1f) { drawPath(p, color, style = Stroke(2.dp.toPx())) }
}

/** .card - graphite surface, hairline border, 24 dp radius, sheen. accent tints the border (critical rows). */
@Composable
fun HCard(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, accent: Color? = null, padding: Dp = 20.dp, content: @Composable ColumnScope.() -> Unit) {
  Column(
    modifier
      .then(if (onClick != null) Modifier.pressable(scale = 0.985f, onClick = onClick) else Modifier)
      .clip(CardShape)
      .background(Hx.Surface)
      .sheen()
      .border(1.dp, accent?.copy(alpha = 0.5f) ?: Hx.Line, CardShape)
      .padding(padding),
    content = content,
  )
}

/** .card-paper - light island on the dark canvas (KPI tiles). */
@Composable
fun PaperCard(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, padding: Dp = 20.dp, content: @Composable ColumnScope.() -> Unit) {
  CompositionLocalProvider(LocalContentColor provides Hx.Ink) {
    Column(
      modifier
        .then(if (onClick != null) Modifier.pressable(scale = 0.985f, onClick = onClick) else Modifier)
        .clip(CardShape)
        .background(Hx.Paper)
        .sheen(color = Color(0xB3FFFFFF))
        .padding(padding),
      content = content,
    )
  }
}

/** .card-lime - the focal Hydris-blue panel: radial gradient from the top-right, white type. */
@Composable
fun BrandCard(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, padding: Dp = 20.dp, content: @Composable ColumnScope.() -> Unit) {
  CompositionLocalProvider(LocalContentColor provides Color.White) {
    Column(
      modifier
        .then(if (onClick != null) Modifier.pressable(scale = 0.985f, onClick = onClick) else Modifier)
        .clip(CardShape)
        .drawBehind {
          drawRect(Brush.radialGradient(
            0f to Hx.BrandGlow, 0.45f to Hx.Brand, 1f to Hx.BrandLow,
            center = Offset(size.width, 0f), radius = maxOf(size.width, size.height) * 1.3f,
          ))
        }
        .sheen(color = Color(0x2EFFFFFF))
        .padding(padding),
      content = content,
    )
  }
}

/** .card-inset - recessed row inside a card. */
@Composable
fun InsetRow(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, content: @Composable RowScope.() -> Unit) {
  Row(
    modifier.fillMaxWidth()
      .then(if (onClick != null) Modifier.pressable(scale = 0.985f, onClick = onClick) else Modifier)
      .clip(HxShape.Lg).background(Hx.Bg2).border(1.dp, Hx.Line, HxShape.Lg).padding(horizontal = 14.dp, vertical = 12.dp),
    verticalAlignment = Alignment.CenterVertically, content = content,
  )
}

// ------------------------------------------------------------------ type roles

@Composable
fun Eyebrow(text: String, color: Color = Hx.Muted, modifier: Modifier = Modifier) =
  Text(text.uppercase(), style = HxType.Eyebrow, color = color, modifier = modifier, maxLines = 2, overflow = TextOverflow.Ellipsis)

/** Page header: eyebrow, t-page title and an optional muted second line (web console page heads). */
@Composable
fun PageHeader(eyebrow: String?, title: String, sub: String? = null, subColor: Color = Hx.Muted, modifier: Modifier = Modifier, trailing: @Composable RowScope.() -> Unit = {}) {
  Column(modifier.fillMaxWidth().padding(top = 8.dp, bottom = 16.dp).appear()) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Column(Modifier.weight(1f)) {
        if (eyebrow != null) { Eyebrow(eyebrow); Spacer(Modifier.height(10.dp)) }
        Text(title, style = HxType.Page)
      }
      trailing()
    }
    if (sub != null) Text(sub, style = HxType.Page.copy(fontSize = 22.sp, lineHeight = 26.sp), color = subColor, modifier = Modifier.padding(top = 2.dp))
  }
}

@Composable
fun SectionTitle(title: String, action: String? = null, onAction: (() -> Unit)? = null) {
  Row(Modifier.fillMaxWidth().padding(top = 26.dp, bottom = 12.dp), verticalAlignment = Alignment.CenterVertically) {
    Text(title, style = HxType.Section, modifier = Modifier.weight(1f))
    if (action != null && onAction != null) Chip(action, Hx.Text2, modifier = Modifier.pressable(onClick = onAction), trailingIcon = Icons.AutoMirrored.Outlined.CallMade)
    else if (action != null) Text(action, style = HxType.Label, color = Hx.Muted)
  }
}

// ------------------------------------------------------------------ chips, dots, pills

/**
 * .chip - 28 dp pill, 12.5 sp medium. A semantic colour gives the tinted variant (.chip-critical etc: 12% fill, 40% border,
 * text tint); Hx.Text2 / default is the neutral graphite chip; filled = solid.
 */
@Composable
fun Chip(text: String, color: Color = Hx.Text2, filled: Boolean = false, modifier: Modifier = Modifier, trailingIcon: ImageVector? = null) {
  val neutral = color == Hx.Text2 || color == Hx.Text
  val textColor = when { filled && color == Color.White -> Hx.Brand; filled -> if (color == Hx.Medium || color == Hx.Ok || color == Hx.High) Hx.Ink else Color.White; neutral -> Hx.Text2; else -> tintFor(color) }
  val bg = when { filled -> color; neutral -> Hx.Surface2; else -> color.copy(alpha = 0.13f) }
  val br = when { filled -> Color.Transparent; neutral -> Hx.Line; else -> color.copy(alpha = 0.4f) }
  Row(
    modifier.height(28.dp).clip(HxShape.Pill).background(bg).border(1.dp, br, HxShape.Pill).padding(horizontal = 12.dp),
    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
  ) {
    Text(text, color = textColor, fontSize = 12.5.sp, fontWeight = FontWeight.Medium, maxLines = 1, style = LocalTextStyle.current)
    if (trailingIcon != null) Icon(trailingIcon, null, tint = textColor, modifier = Modifier.size(13.dp))
  }
}

private fun tintFor(c: Color): Color = when (c) {
  Hx.Critical -> Hx.CriticalText; Hx.High -> Hx.HighText; Hx.Medium -> Hx.MediumText; Hx.Low -> Hx.LowText
  Hx.OkFill, Hx.Ok -> Hx.OkText; Hx.Purple -> Hx.PurpleText; Hx.Signal, Hx.Brand -> Hx.Accent
  else -> c
}

@Composable
fun SeverityChip(severity: String, modifier: Modifier = Modifier) = Chip(severity.replaceFirstChar { it.uppercase() }, Hx.severity(severity), modifier = modifier)

@Composable
fun Dot(color: Color, size: Dp = 8.dp, pulse: Boolean = false) {
  val reduced = LocalReducedMotion.current
  val a = if (pulse && !reduced) {
    val t = rememberInfiniteTransition(label = "pulse")
    t.animateFloat(1f, 0.35f, infiniteRepeatable(tween(900, easing = LinearEasing), RepeatMode.Reverse), label = "pulse").value
  } else 1f
  Box(Modifier.size(size).graphicsLayer { alpha = a }.clip(CircleShape).background(color))
}

/** The console's "Live" status pill: 44 dp graphite capsule, pulsing green dot. */
@Composable
fun LivePill(text: String = "Live", color: Color = Hx.Ok, modifier: Modifier = Modifier) {
  Row(
    modifier.height(36.dp).clip(HxShape.Pill).background(Hx.Surface).border(1.dp, Hx.Line, HxShape.Pill).padding(horizontal = 14.dp),
    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
  ) { Dot(color, pulse = color == Hx.Ok); Text(text, fontSize = 13.sp, color = Hx.Text2) }
}

/** Circular icon action (.icon-btn, 44 dp; variants: graphite, outline, brand, on-paper). */
@Composable
fun HIconButton(icon: ImageVector, contentDescription: String?, onClick: () -> Unit, modifier: Modifier = Modifier, size: Dp = 44.dp, variant: String = "default", tint: Color? = null, enabled: Boolean = true) {
  val (bg, br, fg) = when (variant) {
    "brand" -> Triple(Hx.Signal, Color.Transparent, Color.White)
    "outline" -> Triple(Color.Transparent, Hx.Line2, Hx.Text)
    "paper" -> Triple(Color.Transparent, Color(0x2E081116), Hx.Ink)
    "light" -> Triple(Color.White, Color.Transparent, Hx.Ink)
    else -> Triple(Hx.Surface2, Hx.Line, Hx.Text)
  }
  Box(
    modifier.size(size).pressable(enabled, 0.92f, onClick = onClick).graphicsLayer { alpha = if (enabled) 1f else 0.4f }
      .clip(CircleShape).background(bg).border(1.dp, br, CircleShape),
    contentAlignment = Alignment.Center,
  ) { Icon(icon, contentDescription, tint = tint ?: fg, modifier = Modifier.size(size * 0.42f)) }
}

@Composable
fun BackButton(onClick: () -> Unit) = HIconButton(Icons.AutoMirrored.Outlined.ArrowBack, "Back", onClick, Modifier.padding(top = 8.dp, bottom = 8.dp))

// ------------------------------------------------------------------ buttons (.btn: pill, 44-52 dp, 14 sp medium, scale .97 on press)

private val BtnPad = PaddingValues(horizontal = 20.dp)

@Composable
private fun BtnBase(onClick: () -> Unit, modifier: Modifier, enabled: Boolean, bg: Color, fg: Color, border: BorderStroke?, highlight: Boolean, content: @Composable RowScope.() -> Unit) {
  Row(
    modifier.heightIn(min = 48.dp).pressable(enabled, onClick = onClick).clip(HxShape.Pill).background(bg)
      .then(if (border != null) Modifier.border(border, HxShape.Pill) else Modifier)
      .then(if (highlight) Modifier.sheen(HxShape.Pill, Color(0x2EFFFFFF)) else Modifier)
      .padding(BtnPad),
    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically,
  ) {
    CompositionLocalProvider(LocalContentColor provides fg, LocalTextStyle provides MaterialTheme.typography.labelLarge.copy(color = fg, fontSize = 15.sp)) { content() }
  }
}

/** .btn-primary - Signal Blue; disabled reads "not yet" (surface-3 + muted text). `colors` is accepted for call-site compatibility and ignored. */
@Composable
fun HButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, @Suppress("UNUSED_PARAMETER") colors: ButtonColors? = null, content: @Composable RowScope.() -> Unit) =
  BtnBase(onClick, modifier, enabled, if (enabled) Hx.Signal else Hx.Surface3, if (enabled) Color.White else Hx.Muted, null, enabled, content)

/** .btn-secondary - graphite capsule with hairline border. */
@Composable
fun HSecondaryButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, content: @Composable RowScope.() -> Unit) =
  BtnBase(onClick, modifier.graphicsLayer { alpha = if (enabled) 1f else 0.5f }, enabled, Hx.Surface2, Hx.Text, BorderStroke(1.dp, Hx.Line), true, content)

/** .btn-light - white pill (on the blue focal panel). */
@Composable
fun HLightButton(onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, content: @Composable RowScope.() -> Unit) =
  BtnBase(onClick, modifier, enabled, Color.White, Hx.Ink, null, false, content)

/** .capsule - segmented switch; selected = white pill sliding between options. */
@Composable
fun <T> Capsule(options: List<Pair<T, String>>, selected: T, onSelect: (T) -> Unit, modifier: Modifier = Modifier) {
  Row(modifier.clip(HxShape.Pill).background(Hx.Surface).border(1.dp, Hx.Line, HxShape.Pill).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
    options.forEach { (v, t) ->
      val on = v == selected
      val bg by androidx.compose.animation.animateColorAsState(if (on) Hx.Pill else Color.Transparent, tween(HxMotion.Base, easing = HxMotion.EaseOut), label = "cap")
      val fg by androidx.compose.animation.animateColorAsState(if (on) Hx.PillInk else Hx.Text2, tween(HxMotion.Fast), label = "capf")
      Box(Modifier.height(36.dp).pressable(onClick = { onSelect(v) }, role = Role.Tab).clip(HxShape.Pill).background(bg).padding(horizontal = 16.dp), contentAlignment = Alignment.Center) {
        Text(t, color = fg, fontSize = 14.sp, fontWeight = if (on) FontWeight.Medium else FontWeight.Normal, maxLines = 1)
      }
    }
  }
}

/** .input - 14 dp radius field, line-2 border, Signal Blue focus. */
@Composable
fun fieldColors(): TextFieldColors = OutlinedTextFieldDefaults.colors(
  focusedBorderColor = Hx.Signal, unfocusedBorderColor = Hx.Line2, disabledBorderColor = Hx.Line,
  focusedContainerColor = Hx.FieldFocus, unfocusedContainerColor = Hx.Field, disabledContainerColor = Hx.Field,
  focusedLabelColor = Hx.Accent, unfocusedLabelColor = Hx.Muted, focusedPlaceholderColor = Hx.Placeholder, unfocusedPlaceholderColor = Hx.Placeholder,
  cursorColor = Hx.Accent, focusedTextColor = Hx.Text, unfocusedTextColor = Hx.Text,
)
val FieldShape = HxShape.Md

// ------------------------------------------------------------------ KPI tile

/** Count-up for the leading integer of a KPI value ("7", "1/4", "92%"); other text is kept as is. */
@Composable
fun CountUp(value: String, style: androidx.compose.ui.text.TextStyle, color: Color, modifier: Modifier = Modifier, unitStyleFrom: Int = -1) {
  val m = Regex("""^(\d+)(.*)$""").find(value)
  val reduced = LocalReducedMotion.current
  if (m == null) { Text(value, style = style, color = color, modifier = modifier); return }
  val target = m.groupValues[1].toInt()
  val anim = remember { Animatable(if (reduced) target.toFloat() else 0f) }
  LaunchedEffect(target) { if (reduced) anim.snapTo(target.toFloat()) else anim.animateTo(target.toFloat(), tween(900, easing = HxMotion.EaseOut)) }
  val rest = m.groupValues[2]
  Row(modifier, verticalAlignment = Alignment.Bottom) {
    Text("${anim.value.toInt()}", style = style, color = color)
    if (rest.isNotEmpty()) Text(rest, style = style.copy(fontSize = style.fontSize * 0.6f), color = color.copy(alpha = 0.5f), modifier = Modifier.padding(bottom = 2.dp))
  }
  @Suppress("UNUSED_EXPRESSION") unitStyleFrom
}

/** KPI tile (web KpiCard, tone 'paper'): label + open arrow, large light numeral with semantic accent, sub line. */
@Composable
fun KpiTile(label: String, value: String, sub: String, modifier: Modifier = Modifier, accent: Color = Hx.Text, icon: ImageVector? = null, onClick: (() -> Unit)? = null) {
  val numColor = when (accent) { Hx.Critical -> Hx.CriticalOnPaper; Hx.High -> Hx.HighOnPaper; Hx.Ok, Hx.OkFill -> Hx.OkOnPaper; Hx.Accent, Hx.Signal -> Hx.Signal; else -> Hx.Ink }
  PaperCard(modifier.heightIn(min = 148.dp), onClick = onClick, padding = 18.dp) {
    Row(verticalAlignment = Alignment.Top) {
      Text(label, fontSize = 13.5.sp, lineHeight = 18.sp, color = Hx.Ink.copy(alpha = 0.75f), modifier = Modifier.weight(1f).padding(top = 4.dp), maxLines = 2, overflow = TextOverflow.Ellipsis)
      if (onClick != null) Box(Modifier.size(34.dp).clip(CircleShape).border(1.dp, Color(0x2E081116), CircleShape), contentAlignment = Alignment.Center) {
        Icon(Icons.AutoMirrored.Outlined.CallMade, null, tint = Hx.Ink, modifier = Modifier.size(15.dp))
      } else if (icon != null) Icon(icon, null, tint = Hx.Ink2, modifier = Modifier.size(18.dp))
    }
    Spacer(Modifier.weight(1f).height(14.dp))
    CountUp(value, HxType.Kpi, numColor)
    Spacer(Modifier.height(8.dp))
    Text(sub, fontSize = 13.sp, lineHeight = 17.sp, color = Hx.Ink.copy(alpha = 0.7f), maxLines = 2, overflow = TextOverflow.Ellipsis)
  }
}

// ------------------------------------------------------------------ states

/** .skeleton shimmer blocks (the web's loading state). */
@Composable
fun Skeleton(modifier: Modifier = Modifier, shape: Shape = HxShape.Sm) {
  val reduced = LocalReducedMotion.current
  val x = if (reduced) 0.5f else rememberInfiniteTransition(label = "sk").animateFloat(1.2f, -1.2f, infiniteRepeatable(tween(1600, easing = HxMotion.EaseOut)), label = "sk").value
  Box(modifier.clip(shape).drawBehind {
    val w = size.width
    drawRect(Brush.linearGradient(
      0f to Hx.Surface2, 0.4f to Hx.SkeletonHi, 0.6f to Hx.Surface2,
      start = Offset(w * x, 0f), end = Offset(w * x + w * 1.1f, size.height * 0.4f),
    ))
  })
}

@Composable
fun Loading(modifier: Modifier = Modifier) {
  Column(modifier.fillMaxWidth().padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
      Skeleton(Modifier.weight(1f).height(132.dp), CardShape); Skeleton(Modifier.weight(1f).height(132.dp), CardShape)
    }
    Skeleton(Modifier.fillMaxWidth().height(76.dp), CardShape)
    Skeleton(Modifier.fillMaxWidth().height(76.dp), CardShape)
  }
}

/** Error note: critical-tinted inset with the .field-error dot. */
@Composable
fun ErrorNote(text: String, modifier: Modifier = Modifier) {
  Row(
    modifier.fillMaxWidth().clip(HxShape.Lg).background(Hx.Critical.copy(alpha = 0.1f)).border(1.dp, Hx.Critical.copy(alpha = 0.35f), HxShape.Lg).padding(14.dp),
    verticalAlignment = Alignment.Top,
  ) {
    Box(Modifier.padding(top = 7.dp).size(6.dp).clip(CircleShape).background(Hx.Critical))
    Text(text, color = Hx.CriticalText, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(start = 10.dp))
  }
}

/** EmptyState: dashed-border panel with the concentric "empty art" and a signal-blue dot. */
@Composable
fun EmptyState(title: String, body: String? = null, icon: ImageVector = Icons.Outlined.Inbox, modifier: Modifier = Modifier) {
  Column(
    modifier.fillMaxWidth().appear().clip(CardShape)
      .drawBehind {
        drawRoundRect(Hx.Line2, cornerRadius = CornerRadius(24.dp.toPx()), style = Stroke(1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 6f))))
        drawRect(Brush.radialGradient(listOf(Hx.Tint, Color.Transparent), center = Offset(size.width / 2, 0f), radius = size.width * 0.6f))
      }
      .padding(vertical = 36.dp, horizontal = 24.dp),
    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    Box(Modifier.size(88.dp).drawBehind {
      drawCircle(Hx.Line2, style = Stroke(1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(5f, 5f))))
      drawCircle(Hx.Line, radius = size.minDimension / 2 - 14.dp.toPx(), style = Stroke(1.dp.toPx()))
    }, contentAlignment = Alignment.Center) {
      Box(Modifier.size(44.dp).clip(CircleShape).background(Hx.Surface2), contentAlignment = Alignment.Center) { Icon(icon, null, tint = Hx.Text2, modifier = Modifier.size(20.dp)) }
      Box(Modifier.align(Alignment.TopEnd).padding(top = 9.dp, end = 13.dp).size(9.dp).clip(CircleShape).background(Hx.Signal))
    }
    Text(title, style = HxType.Card)
    if (body != null) Text(body, color = Hx.Muted, style = MaterialTheme.typography.bodyMedium, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
  }
}

@Composable
fun ProgressBar(fraction: Float, color: Color = Hx.Signal, modifier: Modifier = Modifier) {
  val reduced = LocalReducedMotion.current
  val f by animateFloatAsState(fraction.coerceIn(0f, 1f), if (reduced) tween(0) else tween(600, easing = HxMotion.EaseOut), label = "bar")
  Box(modifier.fillMaxWidth().height(6.dp).clip(HxShape.Pill).background(Hx.ChartTrack)) {
    Box(Modifier.fillMaxWidth(f).height(6.dp).clip(HxShape.Pill).background(color))
  }
}

@Composable
fun Row2(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) = Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), content = content)

// ------------------------------------------------------------------ charts (Canvas; styled after ui/charts.tsx + Recharts TrendChart)

private fun linePath(values: List<Double>, w: Float, y: (Double) -> Float): Path = Path().apply {
  values.forEachIndexed { i, v -> val x = w * i / (values.size - 1); if (i == 0) moveTo(x, y(v)) else lineTo(x, y(v)) }
}

/** Compact line (MiniTrend): 1.8 dp stroke, 22% gradient wash, end dot; draws in left → right. */
@Composable
fun Sparkline(values: List<Double>, color: Color, modifier: Modifier = Modifier) {
  val p = rememberDrawIn()
  Canvas(modifier) {
    if (values.size < 2) return@Canvas
    val lo = values.min(); val hi = values.max(); val span = (hi - lo).takeIf { it > 1e-9 } ?: 1.0
    fun y(v: Double) = size.height - (((v - lo) / span) * size.height * 0.8 + size.height * 0.1).toFloat()
    val line = linePath(values, size.width, ::y)
    val fill = Path().apply { addPath(line); lineTo(size.width, size.height); lineTo(0f, size.height); close() }
    clipRect(right = size.width * p) {
      drawPath(fill, Brush.verticalGradient(listOf(color.copy(alpha = 0.22f), Color.Transparent)))
      drawPath(line, color, style = Stroke(1.8.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
    if (p > 0.98f) drawCircle(color, 3.dp.toPx(), Offset(size.width, y(values.last())))
  }
}

/** TrendChart: horizontal grid (chart-grid), typical band (ok 8%) with dotted edges, 28% → 0 gradient area, 1.8 dp line. */
@Composable
fun LineChart(values: List<Double>, color: Color, typical: Pair<Double, Double>?, modifier: Modifier = Modifier) {
  val p = rememberDrawIn(900)
  Canvas(modifier) {
    if (values.size < 2) return@Canvas
    var lo = values.min(); var hi = values.max()
    typical?.let { lo = minOf(lo, it.first); hi = maxOf(hi, it.second) }
    val pad = (hi - lo).takeIf { it > 1e-9 }?.times(0.1) ?: 1.0
    lo -= pad; hi += pad
    fun y(v: Double) = (size.height - (v - lo) / (hi - lo) * size.height).toFloat()
    for (g in 0..4) { val gy = size.height * g / 4; drawLine(Hx.ChartGrid, Offset(0f, gy), Offset(size.width, gy), 1.dp.toPx()) }
    typical?.let { (a, b) ->
      drawRect(Hx.Ok.copy(alpha = 0.08f), Offset(0f, y(b)), Size(size.width, y(a) - y(b)))
      val dash = PathEffect.dashPathEffect(floatArrayOf(2.dp.toPx(), 6.dp.toPx()))
      drawLine(Hx.Ok.copy(alpha = 0.5f), Offset(0f, y(a)), Offset(size.width, y(a)), 1.dp.toPx(), pathEffect = dash)
      drawLine(Hx.Ok.copy(alpha = 0.5f), Offset(0f, y(b)), Offset(size.width, y(b)), 1.dp.toPx(), pathEffect = dash)
    }
    val line = linePath(values, size.width, ::y)
    val fill = Path().apply { addPath(line); lineTo(size.width, size.height); lineTo(0f, size.height); close() }
    clipRect(right = size.width * p) {
      drawPath(fill, Brush.verticalGradient(listOf(color.copy(alpha = 0.28f), color.copy(alpha = 0f))))
      drawPath(line, color, style = Stroke(1.8.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
    if (p > 0.98f) {
      val e = Offset(size.width - 1.dp.toPx(), y(values.last()))
      drawCircle(color.copy(alpha = 0.25f), 7.dp.toPx(), e); drawCircle(color, 3.5.dp.toPx(), e)
    }
  }
}

/**
 * Sparkbars: graphite (surface-3) bars with 4 dp tops / 1 dp bottoms, the peak in `highlight`, a line-2 baseline,
 * zero days as 3 dp stubs at 35% opacity; bars grow up on first show.
 */
@Composable
fun Bars(values: List<Int>, color: Color, modifier: Modifier = Modifier, highlight: Color = Hx.Critical, base: Color = Hx.Surface3) {
  val p = rememberDrawIn()
  Canvas(modifier) {
    if (values.isEmpty()) return@Canvas
    val max = (values.maxOrNull() ?: 1).coerceAtLeast(1)
    val peak = values.indexOf(values.max()).takeIf { values.max() > 0 } ?: -1
    val gap = 4.dp.toPx()
    val w = (size.width - gap * (values.size - 1)) / values.size
    values.forEachIndexed { i, v ->
      val full = if (v == 0) 3.dp.toPx() else (size.height * v / max).coerceAtLeast(size.height * 0.06f)
      val h = full * p
      val c = when { i == peak -> highlight; v == 0 -> base.copy(alpha = 0.35f); else -> base }
      val path = Path().apply {
        addRoundRect(RoundRect(i * (w + gap), size.height - h, i * (w + gap) + w, size.height,
          topLeftCornerRadius = CornerRadius(4.dp.toPx()), topRightCornerRadius = CornerRadius(4.dp.toPx()),
          bottomLeftCornerRadius = CornerRadius(1.dp.toPx()), bottomRightCornerRadius = CornerRadius(1.dp.toPx())))
      }
      drawPath(path, c)
    }
    drawLine(Hx.Line2, Offset(0f, size.height - 0.5f), Offset(size.width, size.height - 0.5f), 1.dp.toPx())
    @Suppress("UNUSED_EXPRESSION") color
  }
}

/** Donut: chart-track ring, round-capped segments with small gaps, sweeping in clockwise (.chart-arc 700 ms). */
@Composable
fun Donut(parts: List<Pair<Float, Color>>, modifier: Modifier = Modifier, thickness: Dp = 12.dp, center: @Composable () -> Unit = {}) {
  val p = rememberDrawIn()
  Box(modifier, contentAlignment = Alignment.Center) {
    Canvas(Modifier.fillMaxSize()) {
      val total = parts.sumOf { it.first.toDouble() }.toFloat().takeIf { it > 0 } ?: 1f
      val stroke = thickness.toPx()
      val inset = stroke / 2
      val arcSize = Size(size.width - stroke, size.height - stroke)
      drawArc(Hx.ChartTrack, 0f, 360f, false, Offset(inset, inset), arcSize, style = Stroke(stroke))
      val gapDeg = Math.toDegrees((stroke * 1.1 / (arcSize.width / 2)).toDouble()).toFloat()
      var start = -90f
      parts.filter { it.first > 0 }.forEach { (v, c) ->
        val sweep = 360f * v / total * p
        val drawn = (sweep - gapDeg).coerceAtLeast(0.1f)
        drawArc(c, start + gapDeg / 2, drawn, false, Offset(inset, inset), arcSize, style = Stroke(stroke, cap = StrokeCap.Round))
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

/** Brand logo button (Shell.tsx): Hydris Core Blue disc with the white favicon mark and a soft blue glow. */
@Composable
fun HydrisLogo(size: Dp = 44.dp, modifier: Modifier = Modifier) {
  Box(
    modifier.size(size).shadow(size * 0.4f, CircleShape, ambientColor = Hx.Brand, spotColor = Hx.Brand).clip(CircleShape).background(Hx.Brand),
    contentAlignment = Alignment.Center,
  ) {
    androidx.compose.foundation.Image(androidx.compose.ui.res.painterResource(ai.hydris.field.R.drawable.hydris_mark_white), "Hydris", Modifier.size(size * 0.52f))
  }
}

/** Spacer that clears the floating navigation bar. */
@Composable
fun NavSpacer() = Spacer(Modifier.height(ai.hydris.field.ui.LocalNavPadding.current))

/** .field: 13 sp label above a 14 dp-radius input (line-2 border, Signal Blue focus). */
@Composable
fun HField(
  label: String?, value: String, onValueChange: (String) -> Unit, modifier: Modifier = Modifier, placeholder: String? = null,
  singleLine: Boolean = true, minLines: Int = 1, password: Boolean = false,
  keyboardType: androidx.compose.ui.text.input.KeyboardType = androidx.compose.ui.text.input.KeyboardType.Text,
) {
  Column(modifier, verticalArrangement = Arrangement.spacedBy(7.dp)) {
    if (label != null) Text(label, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = Hx.Text2)
    androidx.compose.material3.OutlinedTextField(
      value, onValueChange, Modifier.fillMaxWidth(), singleLine = singleLine, minLines = minLines, shape = FieldShape, colors = fieldColors(),
      textStyle = MaterialTheme.typography.bodyLarge.copy(fontSize = 15.sp),
      placeholder = placeholder?.let { { Text(it, fontSize = 15.sp) } },
      visualTransformation = if (password) androidx.compose.ui.text.input.PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
      keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = if (password) androidx.compose.ui.text.input.KeyboardType.Password else keyboardType),
    )
  }
}
