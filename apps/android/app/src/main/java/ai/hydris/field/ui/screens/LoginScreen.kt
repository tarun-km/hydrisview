package ai.hydris.field.ui.screens

import ai.hydris.field.BuildConfig
import ai.hydris.field.HydrisApp
import ai.hydris.field.R
import ai.hydris.field.data.Session
import ai.hydris.field.ui.components.BrandCard
import ai.hydris.field.ui.components.ErrorNote
import ai.hydris.field.ui.components.Eyebrow
import ai.hydris.field.ui.components.HButton
import ai.hydris.field.ui.components.HField
import ai.hydris.field.ui.components.HSecondaryButton
import ai.hydris.field.ui.components.HydrisLogo
import ai.hydris.field.ui.components.appear
import ai.hydris.field.ui.theme.Hx
import ai.hydris.field.ui.theme.HxMotion
import ai.hydris.field.ui.theme.HxShape
import ai.hydris.field.ui.theme.HxType
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

/** Kept for callers: the brand disc with the favicon mark. */
@Composable
fun HydrisMark(size: Int = 40) = HydrisLogo(size.dp)

@Composable
fun LoginScreen(onSignedIn: (Session) -> Unit) {
  val api = (LocalContext.current.applicationContext as HydrisApp).api
  var email by remember { mutableStateOf("") }
  var password by remember { mutableStateOf("") }
  var name by remember { mutableStateOf("") }
  var demo by remember { mutableStateOf(false) }
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  val scope = rememberCoroutineScope()

  fun run(block: suspend () -> Session) = scope.launch {
    busy = true; error = null
    runCatching { block() }.onSuccess { s -> if (s.mfaRequired) error = "This account uses two-step verification - sign in on the web console first." else onSignedIn(s) }
      .onFailure { error = it.message }
    busy = false
  }

  Column(Modifier.fillMaxSize().systemBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 16.dp)) {
    // AuthFrame's brand aside, as a hero panel: radial Hydris blue, outline mark texture, hero line, chips.
    BrandCard(Modifier.fillMaxWidth().appear(), padding = 24.dp) {
      Box(Modifier.fillMaxWidth()) {
        Image(painterResource(R.drawable.hydris_mark_white), null, Modifier.align(Alignment.BottomEnd).offset(x = 60.dp, y = 70.dp).size(220.dp).alpha(0.1f))
        Column {
          Row(verticalAlignment = Alignment.CenterVertically) {
            Image(painterResource(R.drawable.hydris_mark_white), "Hydris", Modifier.size(26.dp))
            Text("  Hydris", fontSize = 20.sp, style = HxType.Section, color = Color.White)
          }
          Spacer(Modifier.height(36.dp))
          Eyebrow("Hydris Field Glasses", Color.White.copy(alpha = 0.85f))
          Spacer(Modifier.height(10.dp))
          Text("Plant context, in view.", style = HxType.Page.copy(fontSize = 34.sp, lineHeight = 36.sp), color = Color.White)
          Spacer(Modifier.height(12.dp))
          Text("Live telemetry, guided inspections and approved procedures - on smart glasses and on this phone.", color = Color.White.copy(alpha = 0.9f), fontSize = 15.sp, lineHeight = 22.sp)
          Spacer(Modifier.height(18.dp))
          Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("Ray-Ban Meta", "Offline-ready", "Audit trail").forEach {
              Text(it, color = Color.White, fontSize = 12.5.sp, modifier = Modifier.clip(HxShape.Pill).border(1.dp, Color.White.copy(alpha = 0.3f), HxShape.Pill)
                .padding(horizontal = 12.dp, vertical = 5.dp))
            }
          }
        }
      }
    }
    Spacer(Modifier.height(32.dp))
    AnimatedContent(demo, transitionSpec = { (fadeIn(tween(HxMotion.Page, easing = HxMotion.EaseOut)) + slideInVertically(tween(HxMotion.Page, easing = HxMotion.EaseOut)) { it / 30 }) togetherWith fadeOut(tween(HxMotion.Fast)) }, label = "login") { isDemo ->
      Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(if (isDemo) "Enter demo mode" else "Sign in", style = HxType.Page)
        Text(if (isDemo) "Pick a name to see on the glasses." else "Use the same account as the Hydris console. Your plants, alarms and work follow you to the phone and the glasses.", color = Hx.Text2, fontSize = 15.sp, lineHeight = 22.sp)
        Spacer(Modifier.height(4.dp))
        if (!isDemo) {
          HField("Work email", email, { email = it }, keyboardType = KeyboardType.Email)
          HField("Password", password, { password = it }, password = true)
          error?.let { ErrorNote(it) }
          HButton({ run { api.login(email.trim(), password) } }, Modifier.fillMaxWidth().height(52.dp), enabled = !busy && email.isNotBlank() && password.isNotEmpty()) { Text(if (busy) "Signing in…" else "Sign in") }
          HSecondaryButton({ demo = true; error = null }, Modifier.fillMaxWidth().height(52.dp)) { Text("Enter demo mode") }
        } else {
          Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).border(1.dp, Hx.Line, RoundedCornerShape(20.dp)).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Demo mode creates a personal account with synthetic plant data, your own inspections and maintenance tasks. Pair glasses with it to see your name and work on the glasses.", color = Hx.Text2, fontSize = 14.sp, lineHeight = 20.sp)
            HField("Your name", name, { name = it })
            error?.let { ErrorNote(it) }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
              HSecondaryButton({ demo = false; error = null }, Modifier.weight(1f)) { Text("Cancel") }
              HButton({ run { api.demo(name.trim()) } }, Modifier.weight(1f), enabled = !busy && name.trim().length >= 2) { Text(if (busy) "Starting…" else "Start demo") }
            }
          }
        }
      }
    }
    Spacer(Modifier.height(24.dp))
    Text("Server: ${BuildConfig.HYDRIS_URL}", color = Hx.Muted, style = HxType.Label)
  }
}
