package ai.hydris.field.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** Hydris brand tokens (same palette as the website, console and glasses HUD). */
object Hx {
  val Midnight = Color(0xFF081116) // Deep Midnight - background
  val Surface = Color(0xFF0E1A21)
  val Surface2 = Color(0xFF13222B)
  val Line = Color(0x1FFFFFFF)
  val Signal = Color(0xFF1954F1) // Signal Blue - primary
  val Core = Color(0xFF1746E4) // Core Blue
  val SignalText = Color(0xFF6F93FF)
  val Alert = Color(0xFFFF2800) // Alert Orange - critical
  val High = Color(0xFFF26414)
  val Medium = Color(0xFFF5B83D)
  val Ok = Color(0xFF00FE21) // Active Green
  val OkSoft = Color(0xFF34D27A)
  val Insight = Color(0xFF8A60F0) // Insight Purple - AI
  val Text = Color(0xFFF2F5F7)
  val Text2 = Color(0xFFB7C2CA)
  val Muted = Color(0xFF7D8B95)

  fun severity(s: String): Color = when (s) { "critical" -> Alert; "high" -> High; "medium" -> Medium; else -> SignalText }
  fun freshness(f: String): Color = when (f) { "live" -> OkSoft; "delayed" -> Medium; "stale" -> High; else -> Muted }
}

private val scheme = darkColorScheme(
  primary = Hx.Signal, onPrimary = Color.White, primaryContainer = Hx.Core, onPrimaryContainer = Color.White,
  secondary = Hx.Insight, onSecondary = Color.White, tertiary = Hx.OkSoft,
  background = Hx.Midnight, onBackground = Hx.Text, surface = Hx.Surface, onSurface = Hx.Text,
  surfaceVariant = Hx.Surface2, onSurfaceVariant = Hx.Text2, outline = Hx.Line, error = Hx.Alert, onError = Color.White,
  surfaceContainer = Hx.Surface, surfaceContainerHigh = Hx.Surface2, surfaceContainerLow = Hx.Midnight,
)

private val type = Typography(
  displaySmall = TextStyle(fontSize = 34.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.8).sp, lineHeight = 38.sp),
  headlineSmall = TextStyle(fontSize = 24.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.4).sp),
  titleLarge = TextStyle(fontSize = 20.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.2).sp),
  titleMedium = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.Medium),
  bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 22.sp),
  bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
  bodySmall = TextStyle(fontSize = 12.5.sp, lineHeight = 17.sp),
  labelSmall = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Medium, letterSpacing = 1.4.sp),
)

@Composable
fun HydrisTheme(content: @Composable () -> Unit) = MaterialTheme(colorScheme = scheme, typography = type) {
  // Default text/icon colour for everything not inside a Material surface.
  androidx.compose.runtime.CompositionLocalProvider(androidx.compose.material3.LocalContentColor provides Hx.Text, content = content)
}
