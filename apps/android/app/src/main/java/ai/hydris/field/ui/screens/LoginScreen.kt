package ai.hydris.field.ui.screens

import ai.hydris.field.BuildConfig
import ai.hydris.field.HydrisApp
import ai.hydris.field.data.Session
import ai.hydris.field.ui.components.ErrorNote
import ai.hydris.field.ui.components.Eyebrow
import ai.hydris.field.ui.theme.Hx
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

@Composable
fun HydrisMark(size: Int = 40) {
  Canvas(Modifier.size(size.dp)) {
    val w = this.size.width
    val p = Path().apply { moveTo(w * 0.18f, w * 0.12f); lineTo(w * 0.82f, w * 0.12f); lineTo(w * 0.5f, w * 0.74f); close() }
    drawPath(p, Hx.Signal)
    drawRect(Hx.Signal, Offset(w * 0.18f, w * 0.8f), androidx.compose.ui.geometry.Size(w * 0.64f, w * 0.1f))
  }
}

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
  val fieldColors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Hx.Signal, unfocusedBorderColor = Hx.Line, focusedContainerColor = Hx.Surface, unfocusedContainerColor = Hx.Surface)

  fun run(block: suspend () -> Session) = scope.launch {
    busy = true; error = null
    runCatching { block() }.onSuccess { s -> if (s.mfaRequired) error = "This account uses two-step verification - sign in on the web console first." else onSignedIn(s) }
      .onFailure { error = it.message }
    busy = false
  }

  Column(Modifier.fillMaxSize().systemBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
    Spacer(Modifier.height(24.dp))
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
      HydrisMark(36)
      Text("Hydris Field", style = MaterialTheme.typography.titleLarge)
    }
    Spacer(Modifier.height(8.dp))
    Eyebrow("Field glasses · console · one account", Hx.SignalText)
    Text("Sign in", style = MaterialTheme.typography.displaySmall)
    Text("Use the same account as the Hydris console. Your plants, alarms and work follow you to the phone and the glasses.", color = Hx.Text2)
    if (!demo) {
      OutlinedTextField(email, { email = it }, label = { Text("Work email") }, singleLine = true, modifier = Modifier.fillMaxWidth(), colors = fieldColors,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), shape = RoundedCornerShape(16.dp))
      OutlinedTextField(password, { password = it }, label = { Text("Password") }, singleLine = true, modifier = Modifier.fillMaxWidth(), colors = fieldColors,
        visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), shape = RoundedCornerShape(16.dp))
      error?.let { ErrorNote(it) }
      Button({ run { api.login(email.trim(), password) } }, enabled = !busy && email.isNotBlank() && password.isNotEmpty(), modifier = Modifier.fillMaxWidth().height(54.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Hx.Signal)) { Text(if (busy) "Signing in…" else "Sign in") }
      OutlinedButton({ demo = true; error = null }, modifier = Modifier.fillMaxWidth().height(54.dp)) { Text("Enter demo mode") }
    } else {
      Text("Demo mode creates a personal account with synthetic plant data, your own inspections and tasks.", color = Hx.Text2)
      OutlinedTextField(name, { name = it }, label = { Text("Your name") }, singleLine = true, modifier = Modifier.fillMaxWidth(), colors = fieldColors, shape = RoundedCornerShape(16.dp))
      error?.let { ErrorNote(it) }
      Button({ run { api.demo(name.trim()) } }, enabled = !busy && name.trim().length >= 2, modifier = Modifier.fillMaxWidth().height(54.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Hx.Signal)) { Text(if (busy) "Starting…" else "Start demo") }
      OutlinedButton({ demo = false; error = null }, modifier = Modifier.fillMaxWidth().height(54.dp)) { Text("Back to sign in") }
    }
    Spacer(Modifier.height(12.dp))
    Text("Server: ${BuildConfig.HYDRIS_URL}", color = Hx.Muted, style = MaterialTheme.typography.bodySmall)
  }
}
