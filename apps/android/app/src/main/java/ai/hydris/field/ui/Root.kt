package ai.hydris.field.ui

import ai.hydris.field.HydrisApp
import ai.hydris.field.MainActivity
import ai.hydris.field.R
import ai.hydris.field.data.Session
import ai.hydris.field.ui.components.Loading
import ai.hydris.field.ui.screens.AlarmDetailScreen
import ai.hydris.field.ui.screens.AskScreen
import ai.hydris.field.ui.screens.GlassesScreen
import ai.hydris.field.ui.screens.HomeScreen
import ai.hydris.field.ui.screens.LoginScreen
import ai.hydris.field.ui.screens.ScanScreen
import ai.hydris.field.ui.screens.SensorScreen
import ai.hydris.field.ui.screens.WorkScreen
import ai.hydris.field.ui.theme.Hx
import android.annotation.SuppressLint
import android.app.NotificationManager
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.DocumentScanner
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.WorkOutline
import androidx.compose.material3.Icon
import ai.hydris.field.ui.components.pressable
import ai.hydris.field.ui.components.sheen
import ai.hydris.field.ui.theme.HxMotion
import ai.hydris.field.ui.theme.HxShape
import ai.hydris.field.ui.theme.LocalReducedMotion
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.chrisbanes.haze.HazeProgressive
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.HazeStyle
import dev.chrisbanes.haze.HazeTint
import dev.chrisbanes.haze.hazeEffect
import dev.chrisbanes.haze.hazeSource
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.core.app.NotificationCompat
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import kotlinx.coroutines.launch
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

@Composable
fun Root(activity: MainActivity) {
  val app = LocalContext.current.applicationContext as HydrisApp
  var session by remember { mutableStateOf<Session?>(null) }
  var restoring by remember { mutableStateOf(true) }
  val scope = rememberCoroutineScope()

  LaunchedEffect(Unit) {
    session = runCatching { app.api.resume() }.getOrNull()
    restoring = false
    app.api.onSessionLost = { session = null }
  }

  Box(Modifier.fillMaxSize().background(Hx.Midnight)) {
    when {
      restoring -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { ai.hydris.field.ui.components.HydrisLogo(72.dp) }
      session == null -> LoginScreen(onSignedIn = { session = it })
      else -> Main(activity, session!!, onSignOut = { scope.launch { app.voice.stop(); app.api.logout(); session = null } })
    }
  }
}

private data class Tab(val route: String, val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector)
private val TABS = listOf(
  Tab("home", "Home", Icons.Outlined.Dashboard),
  Tab("work", "Work", Icons.Outlined.WorkOutline),
  Tab("scan", "Scan", Icons.Outlined.DocumentScanner),
  Tab("ask", "Hydris", Icons.Outlined.AutoAwesome),
  Tab("glasses", "Glasses", Icons.Outlined.Visibility),
)

@SuppressLint("MissingPermission")
@Composable
private fun Main(activity: MainActivity, session: Session, onSignOut: () -> Unit) {
  val app = LocalContext.current.applicationContext as HydrisApp
  val nav = rememberNavController()
  val current by nav.currentBackStackEntryAsState()
  val route = current?.destination?.route

  // Live view: while these glasses are registered as a Hydris device, mirror the current tab (and the
  // glasses camera while scanning) to the control room over the device-token channel.
  val liveRoute by rememberUpdatedState(route)
  LaunchedEffect(session.user.id) { ai.hydris.field.data.LiveShare(app.api).run({ liveRoute }, app.glasses.frame) }

  // Realtime: alarms created anywhere on the account → system notification + live refresh.
  LaunchedEffect(session.user.id) {
    val nm = activity.getSystemService(NotificationManager::class.java)
    app.api.events().collect { (event, data) ->
      if (event != "alarm.created") return@collect
      val o = runCatching { app.api.json.parseToJsonElement(data).jsonObject }.getOrNull() ?: return@collect
      val state = o["state"]?.jsonPrimitive?.content
      val sev = o["severity"]?.jsonPrimitive?.content
      val title = o["title"]?.jsonPrimitive?.content ?: "Alarm"
      if (state == "active" && (sev == "critical" || sev == "high")) {
        nm.notify(title.hashCode(), NotificationCompat.Builder(activity, HydrisApp.ALARMS_CHANNEL)
          .setSmallIcon(R.drawable.ic_hydris_mark).setContentTitle("${sev.replaceFirstChar { it.uppercase() }} alarm").setContentText(title)
          .setPriority(NotificationCompat.PRIORITY_HIGH).setAutoCancel(true).build())
      }
    }
  }

  val hazeState = remember { HazeState() }
  val reduced = LocalReducedMotion.current
  val dur = if (reduced) 0 else HxMotion.Page
  val navInset = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
  val bottomPad = navInset + 12.dp + 60.dp + 16.dp
  CompositionLocalProvider(LocalNavPadding provides bottomPad) {
    Box(Modifier.fillMaxSize().background(Hx.Bg)) {
      // page-enter: opacity + small rise, 360 ms --ease-out; exit is a quick fade.
      NavHost(
        nav, startDestination = "home", modifier = Modifier.fillMaxSize().hazeSource(hazeState),
        enterTransition = { fadeIn(tween(dur, easing = HxMotion.EaseOut)) + slideInVertically(tween(dur, easing = HxMotion.EaseOut)) { (it * 0.02f).toInt() } },
        exitTransition = { fadeOut(tween(if (reduced) 0 else HxMotion.Fast)) },
        popEnterTransition = { fadeIn(tween(dur, easing = HxMotion.EaseOut)) },
        popExitTransition = { fadeOut(tween(if (reduced) 0 else HxMotion.Fast)) + slideOutVertically(tween(dur, easing = HxMotion.EaseOut)) { (it * 0.02f).toInt() } },
      ) {
        composable("home") { HomeScreen(session, nav, onSignOut) }
        composable("work") { WorkScreen(nav) }
        composable("scan") { ScanScreen(activity) }
        composable("ask") { AskScreen(activity) }
        composable("glasses") { GlassesScreen(activity) }
        composable("alarm/{id}", listOf(navArgument("id") { type = NavType.StringType })) { AlarmDetailScreen(it.arguments!!.getString("id")!!, nav) }
        composable("sensor/{id}", listOf(navArgument("id") { type = NavType.StringType })) { SensorScreen(it.arguments!!.getString("id")!!, nav) }
      }
      // Edge blur: content scrolling under the status bar and under the floating navigation is progressively
      // blurred and dimmed (strongest at the screen edge, fading to clear), like the web's sticky glass header.
      val statusInset = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
      Box(
        Modifier.fillMaxWidth().height(statusInset + 28.dp).align(Alignment.TopCenter)
          .hazeEffect(hazeState) {
            blurRadius = 18.dp; noiseFactor = 0f; backgroundColor = Hx.Bg
            tints = listOf(HazeTint(Hx.Bg.copy(alpha = 0.55f)))
            progressive = HazeProgressive.verticalGradient(startIntensity = 1f, endIntensity = 0f)
          },
      )
      Box(
        Modifier.fillMaxWidth().height(navInset + 12.dp + 60.dp + 36.dp).align(Alignment.BottomCenter)
          .hazeEffect(hazeState) {
            blurRadius = 18.dp; noiseFactor = 0f; backgroundColor = Hx.Bg
            tints = listOf(HazeTint(Hx.Bg.copy(alpha = 0.6f)))
            progressive = HazeProgressive.verticalGradient(startIntensity = 0f, endIntensity = 1f)
          },
      )
      val tabRoute = when {
        route == null -> "home"
        route.startsWith("alarm") || route.startsWith("sensor") -> nav.previousBackStackEntry?.destination?.route ?: "work"
        else -> route
      }
      GlassNav(
        selected = TABS.indexOfFirst { it.route == tabRoute }.coerceAtLeast(0), hazeState = hazeState,
        modifier = Modifier.align(Alignment.BottomCenter).padding(start = 12.dp, end = 12.dp, bottom = navInset + 12.dp),
      ) { t -> if (route != t.route) nav.navigate(t.route) { popUpTo("home") { saveState = true }; launchSingleTop = true; restoreState = true } }
    }
  }
}

/** Bottom space every screen leaves so its last item clears the floating navigation. */
val LocalNavPadding = staticCompositionLocalOf { 0.dp }

/**
 * The web console's mobile navigation (Shell.tsx MobileNav): a floating rounded-full bar inset 12 dp from the edges,
 * surface at ~72% over a 24 dp backdrop blur (backdrop-blur-xl), line-2 border, top sheen and shadow-3; the selected tab
 * is a Signal Blue pill (bg-lime) that slides between tabs.
 */
@Composable
private fun GlassNav(selected: Int, hazeState: HazeState, modifier: Modifier = Modifier, onSelect: (Tab) -> Unit) {
  val reduced = LocalReducedMotion.current
  val shape = HxShape.Pill
  BoxWithConstraints(
    modifier.fillMaxWidth().height(60.dp)
      .shadow(24.dp, shape, ambientColor = Color.Black, spotColor = Color.Black)
      .clip(shape)
      .hazeEffect(hazeState, HazeStyle(backgroundColor = Hx.Bg, tints = listOf(HazeTint(Hx.Surface.copy(alpha = 0.72f))), blurRadius = 24.dp, noiseFactor = 0f))
      .border(1.dp, Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.2f), Hx.Line2)), shape)
      .sheen(shape, Color.White.copy(alpha = 0.08f))
      .padding(6.dp),
  ) {
    val itemW = maxWidth / TABS.size
    val x by animateDpAsState(itemW * selected, if (reduced) tween(0) else spring(dampingRatio = 0.78f, stiffness = 420f), label = "pill")
    Box(Modifier.offset(x = x).width(itemW).fillMaxHeight().clip(shape).background(Hx.Signal).sheen(shape, Color.White.copy(alpha = 0.45f)))
    Row(Modifier.fillMaxSize()) {
      TABS.forEachIndexed { i, t ->
        val on = i == selected
        val fg by animateColorAsState(if (on) Color.White else Hx.Text2, tween(HxMotion.Base, easing = HxMotion.EaseOut), label = "fg")
        val s by animateFloatAsState(if (on && !reduced) 1.06f else 1f, tween(HxMotion.Base, easing = HxMotion.EaseSpring), label = "icon")
        Column(
          Modifier.weight(1f).fillMaxHeight().pressable(scale = 0.95f, role = Role.Tab) { onSelect(t) }.semantics { this.selected = on },
          horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
        ) {
          Icon(t.icon, null, tint = fg, modifier = Modifier.size(20.dp).graphicsLayer { scaleX = s; scaleY = s })
          Spacer(Modifier.height(3.dp))
          Text(t.label, color = fg, fontSize = 10.5.sp, lineHeight = 11.sp, fontWeight = FontWeight.Medium, maxLines = 1)
        }
      }
    }
  }
}

@Suppress("unused") fun NavHostController.go(route: String) = navigate(route)
