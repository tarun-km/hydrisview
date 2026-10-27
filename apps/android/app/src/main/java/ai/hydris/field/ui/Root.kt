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
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
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
      restoring -> Loading(Modifier.fillMaxSize())
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

  Scaffold(
    containerColor = Hx.Midnight,
    // Screens handle the status bar themselves; the navigation bar handles its own inset.
    contentWindowInsets = androidx.compose.foundation.layout.WindowInsets(0, 0, 0, 0),
    bottomBar = {
      NavigationBar(containerColor = Hx.Surface, tonalElevation = androidx.compose.ui.unit.Dp(0f)) {
        TABS.forEach { t ->
          NavigationBarItem(
            selected = route == t.route,
            onClick = { if (route != t.route) nav.navigate(t.route) { popUpTo("home") { saveState = true }; launchSingleTop = true; restoreState = true } },
            icon = { Icon(t.icon, t.label) },
            label = { Text(t.label) },
            colors = NavigationBarItemDefaults.colors(selectedIconColor = Hx.SignalText, selectedTextColor = Hx.SignalText, indicatorColor = Hx.Signal.copy(alpha = 0.18f), unselectedIconColor = Hx.Muted, unselectedTextColor = Hx.Muted),
          )
        }
      }
    },
  ) { pad ->
    NavHost(nav, startDestination = "home", modifier = Modifier.padding(pad)) {
      composable("home") { HomeScreen(session, nav, onSignOut) }
      composable("work") { WorkScreen(nav) }
      composable("scan") { ScanScreen(activity) }
      composable("ask") { AskScreen(activity) }
      composable("glasses") { GlassesScreen(activity) }
      composable("alarm/{id}", listOf(navArgument("id") { type = NavType.StringType })) { AlarmDetailScreen(it.arguments!!.getString("id")!!, nav) }
      composable("sensor/{id}", listOf(navArgument("id") { type = NavType.StringType })) { SensorScreen(it.arguments!!.getString("id")!!, nav) }
    }
  }
}

@Suppress("unused") fun NavHostController.go(route: String) = navigate(route)
