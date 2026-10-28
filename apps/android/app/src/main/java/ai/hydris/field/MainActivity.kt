package ai.hydris.field

import ai.hydris.field.ui.Root
import ai.hydris.field.ui.theme.HydrisTheme
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts.RequestMultiplePermissions
import androidx.activity.result.contract.ActivityResultContracts.RequestPermission
import androidx.core.content.ContextCompat
import com.meta.wearable.dat.core.Wearables
import com.meta.wearable.dat.core.types.Permission
import com.meta.wearable.dat.core.types.PermissionStatus
import kotlin.coroutines.resume
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class MainActivity : ComponentActivity() {
  private val app get() = application as HydrisApp

  // Android runtime permissions needed before DAT can reach the glasses.
  private val basePermissions = registerForActivityResult(RequestMultiplePermissions()) { result ->
    if (result[Manifest.permission.BLUETOOTH_CONNECT] != false) app.glasses.initialize()
  }

  // Glasses permissions are granted in the Meta AI app (it opens, the user approves, it returns here).
  private var datCont: CancellableContinuation<PermissionStatus>? = null
  private val datPermission = registerForActivityResult(Wearables.RequestPermissionContract()) { result ->
    datCont?.resume(result.getOrDefault(PermissionStatus.Denied)); datCont = null
  }
  private val datMutex = Mutex()
  private suspend fun requestGlassesPermission(p: Permission): PermissionStatus = datMutex.withLock {
    suspendCancellableCoroutine { c -> datCont = c; c.invokeOnCancellation { datCont = null }; datPermission.launch(p) }
  }

  // Phone camera / microphone, asked in context.
  private var phoneCont: CancellableContinuation<Boolean>? = null
  private val phonePermission = registerForActivityResult(RequestPermission()) { granted -> phoneCont?.resume(granted); phoneCont = null }
  suspend fun ensurePhonePermission(permission: String): Boolean {
    if (ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED) return true
    return suspendCancellableCoroutine { c -> phoneCont = c; phonePermission.launch(permission) }
  }

  /**
   * Auth deep links: hydrisfield://auth-callback?magic=… (built-in magic link),
   * hydrisfield://auth-callback#access_token=… (Supabase magic link / invite) and
   * hydrisfield://login?email=… (from the web operator page). Root consumes and clears it.
   */
  val authLink = MutableStateFlow<Uri?>(null)

  private fun takeAuthLink(intent: Intent?) {
    val data = intent?.data ?: return
    if (data.scheme == "hydrisfield" && (data.host == "auth-callback" || data.host == "login")) authLink.value = data
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    takeAuthLink(intent)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    takeAuthLink(intent)
    // Dark UI everywhere: light status / navigation bar icons.
    enableEdgeToEdge(
      statusBarStyle = androidx.activity.SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
      navigationBarStyle = androidx.activity.SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
    )
    app.glasses.permissionRequester = ::requestGlassesPermission
    setContent { HydrisTheme { Root(activity = this) } }
  }

  override fun onStart() {
    super.onStart()
    basePermissions.launch(arrayOf(Manifest.permission.BLUETOOTH, Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.POST_NOTIFICATIONS))
  }
}
