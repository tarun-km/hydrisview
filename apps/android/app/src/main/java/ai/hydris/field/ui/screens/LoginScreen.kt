package ai.hydris.field.ui.screens

import ai.hydris.field.BuildConfig
import ai.hydris.field.HydrisApp
import ai.hydris.field.R
import ai.hydris.field.data.ApiException
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
import androidx.compose.foundation.background
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
fun LoginScreen(
  onSignedIn: (Session) -> Unit,
  initialEmail: String? = null,
  initialError: String? = null,
  /** account_suspended / account_removed returned by sign-in. */
  onBlocked: (String) -> Unit = {},
) {
  val api = (LocalContext.current.applicationContext as HydrisApp).api
  var email by remember(initialEmail) { mutableStateOf(initialEmail.orEmpty()) }
  var password by remember { mutableStateOf("") }
  var name by remember { mutableStateOf("") }
  /** null = sign-in form; "admin" / "operator" = demo form for that account type. */
  var demo by remember { mutableStateOf<String?>(null) }
  var busy by remember { mutableStateOf(false) }
  var error by remember(initialError) { mutableStateOf(initialError) }
  var notice by remember { mutableStateOf<String?>(null) }
  val scope = rememberCoroutineScope()

  fun run(block: suspend () -> Session) = scope.launch {
    busy = true; error = null; notice = null
    runCatching { block() }.onSuccess { s -> if (s.mfaRequired) error = "This account uses two-step verification - sign in on the web console first." else onSignedIn(s) }
      .onFailure { e ->
        val code = (e as? ApiException)?.code
        if (code == "account_suspended" || code == "account_removed") onBlocked(code) else error = e.message
      }
    busy = false
  }

  fun magicLink() = scope.launch {
    if (!email.contains('@')) { error = "Enter your work email first."; return@launch }
    busy = true; error = null
    runCatching { api.requestMagicLink(email.trim()) }
      .onSuccess { notice = "If ${email.trim()} has a Hydris account, a sign-in link is on its way. Open it on this phone." }
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
    AnimatedContent(demo, transitionSpec = { (fadeIn(tween(HxMotion.Page, easing = HxMotion.EaseOut)) + slideInVertically(tween(HxMotion.Page, easing = HxMotion.EaseOut)) { it / 30 }) togetherWith fadeOut(tween(HxMotion.Fast)) }, label = "login") { demoType ->
      Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(when (demoType) { "admin" -> "Try as Administrator"; "operator" -> "Try as Field Operator"; else -> "Sign in" }, style = HxType.Page)
        Text(
          if (demoType == null) "Field Operators: use the email and password from your invitation. Administrators can sign in too, to use their glasses."
          else "Pick a name to see on the glasses.",
          color = Hx.Text2, fontSize = 15.sp, lineHeight = 22.sp,
        )
        Spacer(Modifier.height(4.dp))
        if (demoType == null) {
          HField("Work email", email, { email = it }, keyboardType = KeyboardType.Email)
          HField("Password", password, { password = it }, password = true)
          notice?.let { Text(it, color = Hx.Text2, fontSize = 14.sp, lineHeight = 20.sp) }
          error?.let { ErrorNote(it) }
          HButton({ run { api.login(email.trim(), password) } }, Modifier.fillMaxWidth().height(52.dp), enabled = !busy && email.isNotBlank() && password.isNotEmpty()) { Text(if (busy) "Signing in…" else "Sign in") }
          HSecondaryButton({ magicLink() }, Modifier.fillMaxWidth().height(52.dp), enabled = !busy) { Text("Email me a sign-in link") }
          Spacer(Modifier.height(4.dp))
          Eyebrow("Explore the demo plant")
          Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            HSecondaryButton({ demo = "operator"; error = null }, Modifier.weight(1f).height(52.dp)) { Text("Field Operator", maxLines = 1) }
            HSecondaryButton({ demo = "admin"; error = null }, Modifier.weight(1f).height(52.dp)) { Text("Administrator", maxLines = 1) }
          }
        } else {
          Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).border(1.dp, Hx.Line, RoundedCornerShape(20.dp)).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(
              if (demoType == "admin") "Demo mode creates a personal Administrator account in the shared demo plant with synthetic data. Administrators can use this app for their glasses."
              else "Demo mode creates a personal Field Operator account with synthetic plant data, your own inspections and maintenance tasks. Pair glasses with it to see your name and work on the glasses.",
              color = Hx.Text2, fontSize = 14.sp, lineHeight = 20.sp,
            )
            HField("Your name", name, { name = it })
            error?.let { ErrorNote(it) }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
              HSecondaryButton({ demo = null; error = null }, Modifier.weight(1f)) { Text("Cancel") }
              HButton({ run { api.demo(name.trim(), demoType) } }, Modifier.weight(1f), enabled = !busy && name.trim().length >= 2) { Text(if (busy) "Starting…" else "Start demo") }
            }
          }
        }
      }
    }
    Spacer(Modifier.height(24.dp))
    Text("Server: ${BuildConfig.HYDRIS_URL}", color = Hx.Muted, style = HxType.Label)
  }
}

/** Shown when the administrator suspended or removed this account: every credential has been cleared. */
@Composable
fun AccountEndedScreen(code: String, onBack: () -> Unit) {
  val removed = code == "account_removed"
  Column(
    Modifier.fillMaxSize().background(Hx.Bg).systemBarsPadding().padding(horizontal = 24.dp, vertical = 32.dp),
    verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
  ) {
    HydrisLogo(56.dp)
    Eyebrow(if (removed) "Access removed" else "Account suspended")
    Text(if (removed) "Your access has been removed" else "Your account is suspended", style = HxType.Page)
    Text(
      if (removed) "Your administrator removed you from this organization. You have been signed out of this app and your glasses."
      else "Your administrator suspended your account. You have been signed out of this app and your glasses. Contact your administrator to have it reactivated.",
      color = Hx.Text2, fontSize = 15.sp, lineHeight = 22.sp,
    )
    Spacer(Modifier.height(8.dp))
    HSecondaryButton(onBack, Modifier.fillMaxWidth().height(52.dp)) { Text("Back to sign in") }
  }
}
