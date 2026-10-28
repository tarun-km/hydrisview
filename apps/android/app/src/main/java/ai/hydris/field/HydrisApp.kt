package ai.hydris.field

import ai.hydris.field.data.HydrisApi
import ai.hydris.field.data.Repository
import ai.hydris.field.data.SecureStore
import ai.hydris.field.glasses.CaptureStore
import ai.hydris.field.glasses.GlassesManager
import ai.hydris.field.glasses.GlassesPrefs
import kotlinx.coroutines.flow.MutableStateFlow
import ai.hydris.field.voice.VoiceEngine
import android.app.Application
import kotlinx.coroutines.launch
import android.app.NotificationChannel
import android.app.NotificationManager

/** App-wide singletons (one API client, one glasses link, one voice engine). */
class HydrisApp : Application() {
  lateinit var api: HydrisApi; private set
  lateinit var repo: Repository; private set
  lateinit var glasses: GlassesManager; private set
  lateinit var voice: VoiceEngine; private set
  lateinit var prefs: GlassesPrefs; private set
  lateinit var captures: CaptureStore; private set
  lateinit var registration: ai.hydris.field.data.GlassesRegistration; private set
  lateinit var outbox: ai.hydris.field.data.Outbox; private set
  lateinit var connectivity: ai.hydris.field.data.Connectivity; private set
  private val appScope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.SupervisorJob() + kotlinx.coroutines.Dispatchers.Main)

  /** Replay the round outbox now (if online) and schedule a WorkManager retry for whatever remains. */
  fun sync() {
    if (outbox.pendingCount == 0) return
    ai.hydris.field.data.SyncWorker.enqueue(this)
    if (connectivity.online.value && api.accessToken != null) appScope.launch { runCatching { outbox.flush(repo) } }
  }
  /** Hand-off to the Scan tab from elsewhere (Glasses quick action, gallery "Send to audit scan"). */
  val scanRequest = MutableStateFlow<ScanRequest?>(null)

  override fun onCreate() {
    super.onCreate()
    api = HydrisApi(SecureStore(this))
    outbox = ai.hydris.field.data.Outbox(this)
    repo = Repository(api, outbox)
    registration = ai.hydris.field.data.GlassesRegistration(repo)
    connectivity = ai.hydris.field.data.Connectivity(this)
    connectivity.start { sync() }
    prefs = GlassesPrefs(this)
    captures = CaptureStore(this)
    glasses = GlassesManager(this, prefs)
    voice = VoiceEngine(this, glasses)
    getSystemService(NotificationManager::class.java).createNotificationChannel(
      NotificationChannel(ALARMS_CHANNEL, "Plant alarms", NotificationManager.IMPORTANCE_HIGH).apply { description = "Critical and high alarms on your sites" },
    )
  }

  companion object { const val ALARMS_CHANNEL = "alarms" }
}

/** What the Scan tab should start with when opened from another screen. */
sealed interface ScanRequest {
  data object GlassesCamera : ScanRequest
  data class FromCapture(val captureId: String) : ScanRequest
}
