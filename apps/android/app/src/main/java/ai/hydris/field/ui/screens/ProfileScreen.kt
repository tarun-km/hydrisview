package ai.hydris.field.ui.screens

import ai.hydris.field.BuildConfig
import ai.hydris.field.HydrisApp
import ai.hydris.field.data.Session
import ai.hydris.field.ui.components.Avatar
import ai.hydris.field.ui.components.BackButton
import ai.hydris.field.ui.components.Chip
import ai.hydris.field.ui.components.Dot
import ai.hydris.field.ui.components.ErrorNote
import ai.hydris.field.ui.components.Eyebrow
import ai.hydris.field.ui.components.HCard
import ai.hydris.field.ui.components.HSecondaryButton
import ai.hydris.field.ui.components.InfoLine
import ai.hydris.field.ui.components.NavSpacer
import ai.hydris.field.ui.components.OfflineBanner
import ai.hydris.field.ui.components.Skeleton
import ai.hydris.field.ui.components.ago
import ai.hydris.field.ui.components.appear
import ai.hydris.field.ui.components.label
import ai.hydris.field.ui.theme.Hx
import ai.hydris.field.ui.theme.HxShape
import ai.hydris.field.ui.theme.HxType
import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController

/** Profile (behind the avatar on Home): who I am, where I work, my glasses and captures, app version, sign out. */
@Composable
fun ProfileScreen(session: Session, nav: NavController, onSignOut: () -> Unit) {
  val app = LocalContext.current.applicationContext as HydrisApp
  val l = rememberLoad { profile() }
  val glasses by app.glasses.state.collectAsState()
  val captures by app.captures.items.collectAsState()
  val entries by app.outbox.entries.collectAsState()
  var confirm by remember { mutableStateOf(false) }
  val p = l.data.value?.value

  Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
    BackButton { nav.popBackStack() }
    OfflineBanner(cachedAt = l.data.value?.cachedAt)
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.appear()) {
      Avatar(p?.user?.name ?: session.user.name, 64.dp)
      Column(Modifier.padding(start = 16.dp)) {
        Text(p?.user?.name ?: session.user.name, style = HxType.Section)
        Text(p?.user?.email ?: session.user.email, color = Hx.Muted, fontSize = 13.5.sp)
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
          Chip(if ((p?.accountType ?: session.accountType) == "admin") "Administrator" else "Field Operator", Hx.Accent)
          if (p?.org?.isDemo == true || session.org?.isDemo == true) Chip("Demo", Hx.Purple)
        }
      }
    }
    if (p == null) {
      if (l.error.value != null) ErrorNote(l.error.value!!) else { Skeleton(Modifier.fillMaxWidth().height(180.dp), HxShape.Xl); Skeleton(Modifier.fillMaxWidth().height(120.dp), HxShape.Xl) }
    } else {
      HCard(Modifier.fillMaxWidth().appear(1), padding = 16.dp) {
        Eyebrow("Work")
        InfoLine("Organization", p.org.name)
        InfoLine("Role", p.title)
        InfoLine("Employee ID", p.employeeId)
        InfoLine("Phone", p.phone)
        InfoLine("Shift", p.shiftLabel)
      }
      HCard(Modifier.fillMaxWidth().appear(2), padding = 16.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Eyebrow("My sites", modifier = Modifier.weight(1f))
          if (p.allSites) Chip("All sites")
        }
        if (p.sites.isEmpty()) Text("No sites assigned yet. Ask your administrator.", color = Hx.Muted, fontSize = 14.sp, modifier = Modifier.padding(top = 8.dp))
        p.sites.forEach { s ->
          Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Dot(Hx.Signal, 7.dp)
            Text("  ${s.name}", color = Hx.Text, fontSize = 15.sp, modifier = Modifier.weight(1f))
            Text(s.code, color = Hx.Muted, fontSize = 13.sp)
          }
        }
      }
      HCard(Modifier.fillMaxWidth().appear(3), onClick = { nav.navigate("glasses") }, padding = 16.dp) {
        Eyebrow("My glasses")
        val connected = glasses.linkState?.contains("connect", true) == true && glasses.linkState?.contains("dis", true) != true
        Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
          Dot(if (connected) Hx.Ok else if (glasses.registered) Hx.Accent else Hx.Muted, 8.dp, pulse = connected)
          Text("  ${glasses.deviceName ?: if (glasses.registered) "Ray-Ban Meta" else "Not linked on this phone"}", color = Hx.Text, fontSize = 15.sp, modifier = Modifier.weight(1f))
          glasses.battery?.let { Text("$it%", color = Hx.Muted, fontSize = 13.sp) }
        }
        p.glasses.forEach { g ->
          Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Assigned: ${g.name}${g.model?.let { " · $it" } ?: ""}", color = Hx.Text2, fontSize = 13.5.sp, modifier = Modifier.weight(1f))
            Text(if (g.status == "active") g.lastSeenAt?.let { "seen ${ago(it)}" } ?: "" else label(g.status), color = Hx.Muted, fontSize = 12.5.sp)
          }
        }
        if (p.glasses.isEmpty()) Text("No glasses assigned to you in the console.", color = Hx.Muted, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp))
      }
      HCard(Modifier.fillMaxWidth().appear(4), onClick = { nav.navigate("captures") }, padding = 16.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Eyebrow("My captures", modifier = Modifier.weight(1f))
          Text("${captures.size}", color = Hx.Muted, fontSize = 13.sp)
        }
        if (captures.isEmpty()) Text("Photos taken with the glasses camera land here.", color = Hx.Muted, fontSize = 13.5.sp, modifier = Modifier.padding(top = 8.dp))
        else Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
          captures.take(4).forEach { c ->
            val bmp by produceState<Bitmap?>(null, c.id) { value = app.captures.thumbnail(c, 240) }
            Box(Modifier.weight(1f).aspectRatio(1f).clip(HxShape.Sm).background(Hx.Surface3)) {
              bmp?.let { Image(it.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop) }
            }
          }
          repeat((4 - captures.size).coerceAtLeast(0)) { Spacer(Modifier.weight(1f)) }
        }
      }
    }
    HCard(Modifier.fillMaxWidth(), padding = 16.dp) {
      Eyebrow("This phone")
      InfoLine("App version", "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})${if (BuildConfig.DEBUG) " · debug" else ""}")
      InfoLine("Server", BuildConfig.HYDRIS_URL.removePrefix("https://").removePrefix("http://"))
      InfoLine("Waiting to sync", "${entries.count { it.state == "pending" }} change(s)")
    }
    HSecondaryButton({ confirm = true }, Modifier.fillMaxWidth().height(52.dp)) {
      Icon(Icons.AutoMirrored.Outlined.Logout, null); Spacer(Modifier.width(8.dp)); Text("Sign out", fontWeight = FontWeight.SemiBold)
    }
    NavSpacer()
  }
  if (confirm) AlertDialog(
    onDismissRequest = { confirm = false }, containerColor = Hx.Surface2,
    title = { Text("Sign out?", style = HxType.Section) },
    text = {
      val n = entries.count { it.state == "pending" }
      Text(if (n > 0) "$n change(s) have not synced yet. They stay on this phone and sync after you sign in again with the same account." else "You can sign in again at any time.", color = Hx.Text2, fontSize = 15.sp)
    },
    confirmButton = { TextButton({ confirm = false; onSignOut() }) { Text("Sign out", color = Hx.CriticalText, fontWeight = FontWeight.SemiBold) } },
    dismissButton = { TextButton({ confirm = false }) { Text("Cancel", color = Hx.Text2) } },
  )
}
