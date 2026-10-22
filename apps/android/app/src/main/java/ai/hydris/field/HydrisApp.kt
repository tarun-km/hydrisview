package ai.hydris.field

import ai.hydris.field.data.HydrisApi
import ai.hydris.field.data.Repository
import ai.hydris.field.data.SecureStore
import ai.hydris.field.glasses.GlassesManager
import ai.hydris.field.voice.VoiceEngine
import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager

/** App-wide singletons (one API client, one glasses link, one voice engine). */
class HydrisApp : Application() {
  lateinit var api: HydrisApi; private set
  lateinit var repo: Repository; private set
  lateinit var glasses: GlassesManager; private set
  lateinit var voice: VoiceEngine; private set

  override fun onCreate() {
    super.onCreate()
    api = HydrisApi(SecureStore(this))
    repo = Repository(api)
    glasses = GlassesManager(this)
    voice = VoiceEngine(this, glasses)
    getSystemService(NotificationManager::class.java).createNotificationChannel(
      NotificationChannel(ALARMS_CHANNEL, "Plant alarms", NotificationManager.IMPORTANCE_HIGH).apply { description = "Critical and high alarms on your sites" },
    )
  }

  companion object { const val ALARMS_CHANNEL = "alarms" }
}
