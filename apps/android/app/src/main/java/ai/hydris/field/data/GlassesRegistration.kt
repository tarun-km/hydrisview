package ai.hydris.field.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** What the Glasses tab shows about the Hydris registration of the linked Ray-Ban Meta. */
data class RegistrationState(
  /** idle | registering | active | pending | denied | transferred | error */
  val status: String = "idle",
  val ownerName: String? = null,
  val deviceName: String? = null,
  val message: String? = null,
)

/**
 * Auto-registration (Phase 4): while someone is signed in and the glasses are linked through DAT, the app
 * registers them to that person with one call (POST /devices/claim) - no button, no code. Under the org
 * policy "Require device approval" the claim stays pending; this polls (and reacts to the
 * device.claim_approved event) until an administrator decides.
 */
class GlassesRegistration(private val repo: Repository) {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
  private val _state = MutableStateFlow(RegistrationState(status = if (repo.api.hasDevice()) "active" else "idle", deviceName = repo.api.deviceName, ownerName = repo.api.deviceOwner))
  val state: StateFlow<RegistrationState> = _state.asStateFlow()
  private var job: Job? = null
  private var last: Triple<String, String, String?>? = null
  private var lastModel: String? = null

  /** Register [hardwareId] to the signed-in user (idempotent; safe to call on every sign-in / link). */
  fun claim(hardwareId: String, name: String, model: String?, firmware: String?, manual: Boolean = false) {
    if (manual) repo.api.releasedHardwareId = null
    else if (repo.api.releasedHardwareId == hardwareId) return
    val key = Triple(hardwareId, name, firmware)
    if (job?.isActive == true && last == key) return
    last = key; lastModel = model
    job?.cancel()
    job = scope.launch {
      if (_state.value.status != "active") _state.value = _state.value.copy(status = "registering", message = null)
      var attempt = 0
      while (true) {
        val r = runCatching { repo.claimGlasses(hardwareId, name, model, firmware) }
        val res = r.getOrNull()
        if (res == null) {
          val e = r.exceptionOrNull()
          val code = (e as? ApiException)?.code
          _state.value = _state.value.copy(status = if (repo.api.hasDevice()) "active" else "error", message = when (code) {
            "device_owned_elsewhere" -> "These glasses belong to another organization."
            "device_suspended" -> "These glasses are suspended. Contact your administrator."
            else -> e?.message ?: "Could not register the glasses"
          })
          if (code == "device_owned_elsewhere" || code == "device_suspended" || code == "forbidden") return@launch
          delay(minOf(60_000L, 5_000L * (1 shl attempt.coerceAtMost(4)))); attempt++
          continue
        }
        when (res.status) {
          "active" -> { _state.value = RegistrationState("active", res.owner?.name, res.device.name, if (res.transferred) "Transferred to you" else null); return@launch }
          "denied" -> { _state.value = RegistrationState("denied", null, res.device.name, "An administrator declined this registration."); return@launch }
          else -> { _state.value = RegistrationState("pending", res.owner?.name, res.device.name, "Waiting for administrator approval"); delay(res.pollIntervalS * 1000L) }
        }
      }
    }
  }

  /** device.claim_approved (realtime): finish now instead of waiting for the next poll. */
  fun retry() { last?.let { (hw, name, fw) -> last = null; claim(hw, name, lastModel, fw) } }

  /** Another person took these glasses over (device.transferred) or the user unregistered. */
  fun dropped(message: String?, hardwareId: String? = null) {
    (hardwareId ?: last?.first)?.let { repo.api.releasedHardwareId = it }
    job?.cancel(); last = null
    repo.api.forgetDevice()
    _state.value = RegistrationState(if (message != null) "transferred" else "idle", message = message)
  }

  fun signedOut() { job?.cancel(); last = null; _state.value = RegistrationState(status = if (repo.api.hasDevice()) "active" else "idle") }
}
