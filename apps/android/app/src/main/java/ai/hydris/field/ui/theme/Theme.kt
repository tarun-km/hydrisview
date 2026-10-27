package ai.hydris.field.ui.theme

import ai.hydris.field.R
import android.provider.Settings
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/**
 * Hydris design tokens, ported 1:1 from apps/web/src/app/globals.css (@theme, dark - the web's default theme).
 * Legacy names (Midnight, Core, SignalText, Alert, OkSoft, Insight) are kept as aliases so screen code reads the same.
 */
object Hx {
  // neutrals: Deep Midnight base, graphite surfaces
  val Bg = Color(0xFF081116)
  val Bg2 = Color(0xFF0C161C)
  val Surface = Color(0xFF121A20)
  val Surface2 = Color(0xFF1A2229)
  val Surface3 = Color(0xFF252E35)
  val Line = Color(0x13FFFFFF) // rgb(255 255 255 / .075)
  val Line2 = Color(0x24FFFFFF) // rgb(255 255 255 / .14)
  val Text = Color(0xFFFFFFFF)
  val Text2 = Color(0xFFC5CCD2)
  val Muted = Color(0xFF8D979F)
  val Paper = Color(0xFFEEF1F4)
  val Paper2 = Color(0xFFDDE2E7)
  val Ink = Color(0xFF081116)
  val Ink2 = Color(0xFF4C5862)
  val Placeholder = Color(0xFF67727B)
  val Field = Color(0xFF0C161C)
  val FieldFocus = Color(0xFF0E1920)
  val Tint = Color(0x0AFFFFFF) // hover / pressed wash
  val Glass = Color(0xC71A2229) // rgb(26 34 41 / .78)
  val Pill = Color(0xFFFFFFFF)
  val PillInk = Color(0xFF081116)
  val ChartGrid = Color(0x12FFFFFF)
  val ChartTrack = Color(0x14FFFFFF)
  val SkeletonHi = Color(0xFF253039)

  // brand
  val Brand = Color(0xFF1746E4) // Hydris Core Blue
  val BrandDeep = Color(0xFF0C1E85) // Deep Intelligence Blue
  val Signal = Color(0xFF1954F1) // Signal Blue (primary fill)
  val Accent = Color(0xFF6F93FF) // accent TEXT on dark
  val BrandGlow = Color(0xFF2A63FF) // card-lime radial highlight
  val BrandLow = Color(0xFF1239C4) // card-lime radial edge

  // functional
  val Critical = Color(0xFFFF2800) // Alert Orange
  val High = Color(0xFFFF9F1C)
  val Medium = Color(0xFFF5C542)
  val Low = Color(0xFF8FB0FF)
  val Ok = Color(0xFF00FE21) // Active Green - dots & text only
  val OkFill = Color(0xFF13962B) // color-mix(ok 50%, surface-3) - used where the web needs a green fill
  val Purple = Color(0xFF8A60F0) // Hydris Insight Purple
  val PurpleText = Color(0xFFB69CFF)
  val CriticalText = Color(0xFFFF7A5C)
  val HighText = Color(0xFFFFB547)
  val MediumText = Color(0xFFF7D36E)
  val LowText = Color(0xFFB3C9FF)
  val OkText = Color(0xFF00FE21)
  // on paper (light) surfaces: the deepened KPI accents (.card-paper .kpi-accent-*)
  val CriticalOnPaper = Color(0xFFD4291D)
  val HighOnPaper = Color(0xFFC24A08)
  val OkOnPaper = Color(0xFF1F8A52)

  // legacy aliases
  val Midnight = Bg
  val Core = Brand
  val SignalText = Accent
  val Alert = Critical
  val OkSoft = OkFill
  val Insight = Purple

  /** Severity colour for dots, bars and fills (web --color-{severity}). */
  fun severity(s: String): Color = when (s) { "critical", "urgent" -> Critical; "high" -> High; "medium" -> Medium; else -> Low }
  /** Severity text tint (web --color-{severity}-text), AA on graphite. */
  fun severityText(s: String): Color = when (s) { "critical", "urgent" -> CriticalText; "high" -> HighText; "medium" -> MediumText; else -> LowText }
  fun freshness(f: String): Color = when (f) { "live" -> Ok; "delayed" -> Medium; "stale" -> High; else -> Muted }
}

/** Radii (web --radius-*) and motion (web --ease-out / --ease-spring, --speed-fast / --speed). */
object HxShape {
  val Xs = RoundedCornerShape(6.dp)
  val Sm = RoundedCornerShape(10.dp)
  val Md = RoundedCornerShape(14.dp)
  val Lg = RoundedCornerShape(18.dp)
  val Xl = RoundedCornerShape(24.dp)
  val X2l = RoundedCornerShape(32.dp)
  val Pill = RoundedCornerShape(percent = 50)
}

object HxMotion {
  val EaseOut = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)
  val EaseSpring = CubicBezierEasing(0.34f, 1.4f, 0.64f, 1f)
  const val Fast = 150
  const val Base = 240
  const val Page = 360
  const val Chart = 700
}

/** True when the system "Remove animations" / animator scale 0 is set - all Hydris motion collapses to instant. */
val LocalReducedMotion = staticCompositionLocalOf { false }

@OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)
private fun outfit(w: Int) = Font(R.font.outfit_variable, FontWeight(w), variationSettings = FontVariation.Settings(FontVariation.weight(w)))

/** Outfit - the web loads weights 300/400/500/600 through next/font. */
@OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)
val Outfit = FontFamily(outfit(300), outfit(400), outfit(500), outfit(600))

/** Web typography roles (.t-*). */
object HxType {
  val Page = TextStyle(fontFamily = Outfit, fontSize = 30.sp, lineHeight = 32.sp, letterSpacing = (-0.03).em, fontWeight = FontWeight.SemiBold)
  val Section = TextStyle(fontFamily = Outfit, fontSize = 21.sp, lineHeight = 26.sp, letterSpacing = (-0.02).em, fontWeight = FontWeight.SemiBold)
  val Card = TextStyle(fontFamily = Outfit, fontSize = 16.5.sp, lineHeight = 21.5.sp, letterSpacing = (-0.012).em, fontWeight = FontWeight.SemiBold)
  val Label = TextStyle(fontFamily = Outfit, fontSize = 13.sp, lineHeight = 17.5.sp, letterSpacing = 0.005.em)
  val Eyebrow = TextStyle(fontFamily = Outfit, fontSize = 11.5.sp, lineHeight = 16.sp, letterSpacing = 0.16.em, fontWeight = FontWeight.Medium)
  val Kpi = TextStyle(fontFamily = Outfit, fontSize = 44.sp, lineHeight = 42.sp, letterSpacing = (-0.045).em, fontWeight = FontWeight.Light, fontFeatureSettings = "tnum, lnum")
  val KpiSm = TextStyle(fontFamily = Outfit, fontSize = 28.sp, lineHeight = 30.sp, letterSpacing = (-0.035).em, fontWeight = FontWeight.Light, fontFeatureSettings = "tnum, lnum")
  val Num = TextStyle(fontFeatureSettings = "tnum, lnum")
}

private val scheme = darkColorScheme(
  primary = Hx.Signal, onPrimary = Color.White, primaryContainer = Hx.Brand, onPrimaryContainer = Color.White,
  secondary = Hx.Purple, onSecondary = Color.White, tertiary = Hx.Ok,
  background = Hx.Bg, onBackground = Hx.Text, surface = Hx.Surface, onSurface = Hx.Text,
  surfaceVariant = Hx.Surface2, onSurfaceVariant = Hx.Text2, outline = Hx.Line2, outlineVariant = Hx.Line, error = Hx.Critical, onError = Color.White,
  surfaceContainer = Hx.Surface, surfaceContainerHigh = Hx.Surface2, surfaceContainerHighest = Hx.Surface3, surfaceContainerLow = Hx.Bg2, surfaceContainerLowest = Hx.Bg,
  inverseSurface = Hx.Paper, inverseOnSurface = Hx.Ink,
)

private val base = TextStyle(fontFamily = Outfit)
private val type = Typography(
  displayLarge = HxType.Kpi,
  displayMedium = base.copy(fontSize = 36.sp, lineHeight = 38.sp, letterSpacing = (-0.035).em, fontWeight = FontWeight.SemiBold),
  displaySmall = HxType.Page,
  headlineLarge = HxType.Page,
  headlineMedium = HxType.Page.copy(fontSize = 26.sp, lineHeight = 29.sp),
  headlineSmall = HxType.Page,
  titleLarge = HxType.Section,
  titleMedium = HxType.Card,
  titleSmall = base.copy(fontSize = 14.sp, lineHeight = 19.sp, fontWeight = FontWeight.Medium),
  bodyLarge = base.copy(fontSize = 15.sp, lineHeight = 22.sp),
  bodyMedium = base.copy(fontSize = 14.sp, lineHeight = 20.sp),
  bodySmall = HxType.Label,
  labelLarge = base.copy(fontSize = 14.sp, lineHeight = 18.sp, letterSpacing = (-0.005).em, fontWeight = FontWeight.Medium),
  labelMedium = base.copy(fontSize = 12.5.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium),
  labelSmall = HxType.Eyebrow,
)

private val shapes = Shapes(extraSmall = HxShape.Xs, small = HxShape.Sm, medium = HxShape.Md, large = HxShape.Xl, extraLarge = HxShape.X2l)

@Composable
fun HydrisTheme(content: @Composable () -> Unit) {
  val ctx = LocalContext.current
  val reduced = remember { runCatching { Settings.Global.getFloat(ctx.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }.getOrDefault(false) }
  MaterialTheme(colorScheme = scheme, typography = type, shapes = shapes) {
    CompositionLocalProvider(LocalContentColor provides Hx.Text, LocalReducedMotion provides reduced, content = content)
  }
}
