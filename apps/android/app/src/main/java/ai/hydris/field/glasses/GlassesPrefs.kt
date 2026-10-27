package ai.hydris.field.glasses

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Lens preview quality: how often and how large the camera preview is pushed to the Meta Ray-Ban Display. */
enum class LensQuality(val label: String, val intervalMs: Long, val sizePx: Int) {
  BALANCED("Balanced", 400L, 400),
  SHARP("Sharp", 200L, 600),
}

data class GlassesSettings(
  val lensPreview: Boolean = true,
  val lensQuality: LensQuality = LensQuality.SHARP,
  val autoCapture: Boolean = true,
  val shareLive: Boolean = true,
  val heyHydris: Boolean = false,
)

/** Persisted Glasses preferences (plain SharedPreferences; nothing secret). */
class GlassesPrefs(context: Context) {
  private val sp = context.getSharedPreferences("glasses_prefs", Context.MODE_PRIVATE)
  private val _settings = MutableStateFlow(load())
  val settings: StateFlow<GlassesSettings> = _settings.asStateFlow()
  val value: GlassesSettings get() = _settings.value

  private fun load() = GlassesSettings(
    lensPreview = sp.getBoolean("lensPreview", true),
    lensQuality = runCatching { LensQuality.valueOf(sp.getString("lensQuality", null) ?: "SHARP") }.getOrDefault(LensQuality.SHARP),
    autoCapture = sp.getBoolean("autoCapture", true),
    shareLive = sp.getBoolean("shareLive", true),
    heyHydris = sp.getBoolean("heyHydris", false),
  )

  fun update(block: (GlassesSettings) -> GlassesSettings) {
    val n = block(_settings.value)
    sp.edit()
      .putBoolean("lensPreview", n.lensPreview).putString("lensQuality", n.lensQuality.name)
      .putBoolean("autoCapture", n.autoCapture).putBoolean("shareLive", n.shareLive).putBoolean("heyHydris", n.heyHydris)
      .apply()
    _settings.value = n
  }
}
