package ai.hydris.field.ui.components

import ai.hydris.field.HydrisApp
import ai.hydris.field.ui.theme.Hx
import ai.hydris.field.ui.theme.HxMotion
import ai.hydris.field.ui.theme.HxShape
import ai.hydris.field.ui.theme.LocalReducedMotion
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CloudDone
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.CloudSync
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Connection + outbox status, shown at the top of field screens: offline (with what is waiting), syncing,
 * or refused changes. Hidden when online with nothing queued. [cachedAt] marks a view served from cache.
 */
@Composable
fun OfflineBanner(modifier: Modifier = Modifier, cachedAt: Long? = null) {
  val app = LocalContext.current.applicationContext as HydrisApp
  val online by app.connectivity.online.collectAsState()
  val entries by app.outbox.entries.collectAsState()
  val syncing by app.outbox.syncing.collectAsState()
  val pending = entries.count { it.state == "pending" }
  val conflicts = entries.count { it.state == "conflict" }
  val reduced = LocalReducedMotion.current
  val (icon, color, title, body) = when {
    !online -> Quad(Icons.Outlined.CloudOff, Hx.High, "You are offline", buildString {
      append(if (pending > 0) "$pending change${if (pending == 1) "" else "s"} saved on this phone. " else "Rounds keep working. ")
      append("They sync when you are back online.")
      if (cachedAt != null && cachedAt > 0) append(" Showing data from ${ago(java.time.Instant.ofEpochMilli(cachedAt).toString())}.")
    })
    syncing -> Quad(Icons.Outlined.CloudSync, Hx.Accent, "Syncing", "Sending $pending change${if (pending == 1) "" else "s"} to Hydris…")
    conflicts > 0 -> Quad(Icons.Outlined.ErrorOutline, Hx.Critical, "$conflicts change${if (conflicts == 1) "" else "s"} not accepted", "Open the round to see why and discard or redo them.")
    pending > 0 -> Quad(Icons.Outlined.CloudSync, Hx.Accent, "Waiting to sync", "$pending change${if (pending == 1) "" else "s"} queued.")
    else -> null
  } ?: Quad(Icons.Outlined.CloudDone, Hx.Ok, "", "")
  val visible = !online || syncing || conflicts > 0 || pending > 0
  AnimatedVisibility(
    visible, modifier,
    enter = if (reduced) fadeIn(tween(0)) else fadeIn(tween(HxMotion.Base)) + expandVertically(tween(HxMotion.Base, easing = HxMotion.EaseOut)),
    exit = if (reduced) fadeOut(tween(0)) else fadeOut(tween(HxMotion.Fast)) + shrinkVertically(tween(HxMotion.Base, easing = HxMotion.EaseOut)),
  ) {
    Row(
      Modifier.fillMaxWidth().padding(bottom = 12.dp).clip(HxShape.Lg).background(color.copy(alpha = 0.12f)).border(1.dp, color.copy(alpha = 0.4f), HxShape.Lg)
        .padding(horizontal = 14.dp, vertical = 12.dp).semantics { liveRegion = LiveRegionMode.Polite },
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Icon(icon, null, tint = color, modifier = Modifier.size(22.dp))
      Spacer(Modifier.width(12.dp))
      Column(Modifier.weight(1f)) {
        Text(title, fontSize = 14.5.sp, fontWeight = FontWeight.SemiBold, color = Hx.Text)
        Text(body, fontSize = 13.sp, lineHeight = 18.sp, color = Hx.Text2)
      }
    }
  }
}

private data class Quad(val a: androidx.compose.ui.graphics.vector.ImageVector, val b: Color, val c: String, val d: String)

/** Initials disc for the signed-in person (opens Profile from the Home header). */
@Composable
fun Avatar(name: String, size: Dp = 44.dp, modifier: Modifier = Modifier) {
  val initials = name.split(' ').filter { it.isNotBlank() }.take(2).joinToString("") { it.first().uppercase() }.ifEmpty { "?" }
  Box(
    modifier.size(size).clip(CircleShape).background(Brush.linearGradient(listOf(Hx.BrandGlow, Hx.BrandDeep))).border(1.dp, Color.White.copy(alpha = 0.22f), CircleShape),
    contentAlignment = Alignment.Center,
  ) { Text(initials, color = Color.White, fontSize = (size.value * 0.36f).sp, fontWeight = FontWeight.SemiBold) }
}

/** Compact label/value line used in profile and detail cards. */
@Composable
fun InfoLine(label: String, value: String?, modifier: Modifier = Modifier) {
  Row(modifier.fillMaxWidth().padding(vertical = 9.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
    Text(label, color = Hx.Muted, fontSize = 14.sp)
    Spacer(Modifier.width(16.dp))
    Text(value?.takeIf { it.isNotBlank() } ?: "—", color = Hx.Text, fontSize = 14.5.sp, fontWeight = FontWeight.Medium, maxLines = 2)
  }
}
