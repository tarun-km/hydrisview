package ai.hydris.field.ui.components

import ai.hydris.field.ui.theme.Hx
import ai.hydris.field.ui.theme.LocalReducedMotion
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics

/** How the illustration is lit: matches the console's device states. */
enum class GlassesLook { Connected, Linked, Offline, Revoked }

/**
 * Hydris' own field-glasses render, ported from the web console's GlassesArt (apps/web/src/console/admin/glasses.tsx,
 * a 320 x 150 SVG). Graphite frame, tinted lenses, a waveguide card in the right lens and a status light. When
 * connected, the ambient glow and the status light breathe (static with reduced motion).
 */
@Composable
fun GlassesArt(look: GlassesLook, modifier: Modifier = Modifier, description: String = "Field glasses") {
  val target = when (look) {
    GlassesLook.Connected -> Hx.BrandGlow
    GlassesLook.Linked -> Hx.Medium
    GlassesLook.Offline -> Hx.Muted
    GlassesLook.Revoked -> Hx.Critical
  }
  val glow by animateColorAsState(target, tween(600), label = "glow")
  val live = look == GlassesLook.Connected
  val dim = look == GlassesLook.Revoked
  val reduced = LocalReducedMotion.current
  val breathe = if (live && !reduced) {
    val t = rememberInfiniteTransition(label = "glasses")
    t.animateFloat(0.55f, 1f, infiniteRepeatable(tween(1800, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "breathe").value
  } else 1f

  Canvas(modifier.aspectRatio(320f / 150f).semantics { contentDescription = description }) {
    val k = size.width / 320f
    scale(k, k, pivot = Offset.Zero) { drawGlasses(glow, live, dim, breathe) }
  }
}

private val FrameBrush = Brush.verticalGradient(listOf(Color(0xFF4A4B48), Color(0xFF232423), Color(0xFF121312)), startY = 30f, endY = 115f)

private fun DrawScope.drawGlasses(glow: Color, live: Boolean, dim: Boolean, breathe: Float) {
  // floor shadow
  drawOval(Brush.radialGradient(listOf(Color.Black.copy(alpha = 0.55f), Color.Transparent), center = Offset(160f, 132f), radius = 138f),
    topLeft = Offset(22f, 122f), size = Size(276f, 20f))
  // ambient glow behind the display lens
  val ga = (if (live) 0.35f else 0.12f) * breathe
  drawOval(Brush.radialGradient(listOf(glow.copy(alpha = ga), Color.Transparent), center = Offset(226f, 70f), radius = 70f),
    topLeft = Offset(156f, 22f), size = Size(140f, 96f))
  // temples receding
  val temple = Color(0xFF2A2B29)
  drawLine(temple, Offset(22f, 52f), Offset(4f, 40f), 8f, StrokeCap.Round)
  drawLine(temple, Offset(298f, 52f), Offset(316f, 40f), 8f, StrokeCap.Round)
  // lenses
  val lens = Brush.linearGradient(
    0f to glow.copy(alpha = if (dim) 0.05f else 0.22f), 0.6f to Hx.Bg.copy(alpha = 0.55f), 1f to glow.copy(alpha = if (dim) 0.02f else 0.1f),
    start = Offset(24f, 36f), end = Offset(296f, 110f),
  )
  val r = CornerRadius(28f, 28f)
  for (x in listOf(24f, 182f)) drawRoundRect(lens, Offset(x, 36f), Size(114f, 74f), r)
  // frame
  for (x in listOf(24f, 182f)) drawRoundRect(FrameBrush, Offset(x, 36f), Size(114f, 74f), r, style = Stroke(9f))
  val hi = Color(0xFF55574F).copy(alpha = 0.7f)
  drawPath(Path().apply { moveTo(30f, 40f); quadraticTo(81f, 26f, 134f, 40f) }, hi, style = Stroke(2f, cap = StrokeCap.Round))
  drawPath(Path().apply { moveTo(186f, 40f); quadraticTo(239f, 26f, 290f, 40f) }, hi, style = Stroke(2f, cap = StrokeCap.Round))
  // bridge
  drawPath(Path().apply { moveTo(138f, 56f); quadraticTo(160f, 40f, 182f, 56f) }, FrameBrush, style = Stroke(8f, cap = StrokeCap.Round))
  // waveguide display card in the right lens
  val wa = if (dim) 0.25f else if (live) 1f else 0.55f
  drawRoundRect(glow.copy(alpha = 0.14f * wa), Offset(222f, 52f), Size(48f, 30f), CornerRadius(5f, 5f))
  drawRoundRect(glow.copy(alpha = 0.7f * wa), Offset(222f, 52f), Size(48f, 30f), CornerRadius(5f, 5f), style = Stroke(1.2f))
  drawRoundRect(glow.copy(alpha = wa), Offset(228f, 58f), Size(22f, 3f), CornerRadius(1.5f, 1.5f))
  drawRoundRect(glow.copy(alpha = 0.6f * wa), Offset(228f, 65f), Size(34f, 2.5f), CornerRadius(1.25f, 1.25f))
  drawRoundRect(glow.copy(alpha = 0.6f * wa), Offset(228f, 71f), Size(16f, 2.5f), CornerRadius(1.25f, 1.25f))
  // camera
  drawCircle(Hx.Bg, 4f, Offset(40f, 44f))
  drawCircle(Color(0xFF5C5E58), 4f, Offset(40f, 44f), style = Stroke(1.2f))
  drawCircle(Color(0xFF7FA6FF).copy(alpha = 0.8f), 1.4f, Offset(40f, 44f))
  // status light
  if (live) drawCircle(glow.copy(alpha = 0.35f * breathe), 7f, Offset(282f, 44f))
  drawCircle(glow.copy(alpha = if (live) 0.6f + 0.4f * breathe else 1f), 3.6f, Offset(282f, 44f))
  if (dim) drawLine(Hx.Critical.copy(alpha = 0.5f), Offset(60f, 120f), Offset(260f, 26f), 2f, pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 6f)))
}

/** Empty-gallery illustration: a stack of three photo frames with the glasses' lens card on top (Hydris-drawn). */
@Composable
fun EmptyCapturesArt(modifier: Modifier = Modifier) {
  Canvas(modifier.aspectRatio(1.6f)) {
    val w = size.width; val h = size.height
    val cw = w * 0.42f; val ch = h * 0.62f
    val c = Offset(w / 2, h * 0.52f)
    listOf(-12f to 0.35f, 10f to 0.55f, 0f to 1f).forEachIndexed { i, (deg, a) ->
      rotate(deg, c) {
        val tl = Offset(c.x - cw / 2, c.y - ch / 2)
        drawRoundRect(Hx.Surface2.copy(alpha = a), tl, Size(cw, ch), CornerRadius(18f, 18f))
        drawRoundRect(Hx.Line2.copy(alpha = a), tl, Size(cw, ch), CornerRadius(18f, 18f), style = Stroke(2f))
        if (i == 2) {
          // horizon + sun, drawn like a photo placeholder
          val p = Path().apply {
            moveTo(tl.x + cw * 0.1f, tl.y + ch * 0.8f); lineTo(tl.x + cw * 0.38f, tl.y + ch * 0.5f); lineTo(tl.x + cw * 0.56f, tl.y + ch * 0.68f)
            lineTo(tl.x + cw * 0.7f, tl.y + ch * 0.56f); lineTo(tl.x + cw * 0.9f, tl.y + ch * 0.8f); close()
          }
          drawPath(p, Brush.verticalGradient(listOf(Hx.Signal.copy(alpha = 0.55f), Hx.BrandDeep.copy(alpha = 0.25f)), startY = tl.y + ch * 0.5f, endY = tl.y + ch * 0.8f))
          drawCircle(Hx.Accent.copy(alpha = 0.8f), cw * 0.07f, Offset(tl.x + cw * 0.72f, tl.y + ch * 0.28f))
        }
      }
    }
  }
}

