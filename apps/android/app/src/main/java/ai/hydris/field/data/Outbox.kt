package ai.hydris.field.data

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import java.io.File
import java.io.IOException
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/**
 * One queued change made in the field. Response ops carry a client op id, the same idempotency key the
 * glasses use (`POST /inspections/:id/responses` ignores replays of an op id it already applied), and the
 * time the operator recorded it, so a round finished offline keeps its real timeline.
 */
@Serializable
data class OutboxEntry(
  val id: String,
  /** "response" (a step answer) or "action" (start / submit). */
  val kind: String,
  val inspectionId: String,
  val stepId: String? = null,
  val value: JsonObject? = null,
  val note: String? = null,
  val recordedAt: String,
  /** Photo step: local JPEG waiting to be uploaded; [attachmentId] is set once it is (so a retry never uploads twice). */
  val photoFile: String? = null,
  val attachmentId: String? = null,
  val action: String? = null,
  /** "pending" or "conflict" (the server refused it; kept so the operator sees why). */
  val state: String = "pending",
  val error: String? = null,
  val attempts: Int = 0,
)

/**
 * Offline-first store for rounds: a durable outbox of changes plus a cache of the last server views
 * (rounds, shift, work) so the app opens and rounds continue without a connection. JSON files in
 * app-private storage, written atomically, the same simple pattern as the captures gallery.
 */
class Outbox(context: Context) {
  private val dir = File(context.filesDir, "outbox").apply { mkdirs() }
  val photoDir = File(dir, "photos").apply { mkdirs() }
  private val cacheDir = File(dir, "cache").apply { mkdirs() }
  private val index = File(dir, "outbox.json")
  private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = false }
  private val ser = ListSerializer(OutboxEntry.serializer())
  private val _entries = MutableStateFlow(load())
  val entries: StateFlow<List<OutboxEntry>> = _entries.asStateFlow()
  private val _syncing = MutableStateFlow(false)
  val syncing: StateFlow<Boolean> = _syncing.asStateFlow()
  private val _lastSync = MutableStateFlow<Long?>(null)
  val lastSync: StateFlow<Long?> = _lastSync.asStateFlow()
  /** Bumped whenever a cached inspection changes (screens re-read their local view). */
  val revision = MutableStateFlow(0)
  private val flushLock = Mutex()

  private fun load(): List<OutboxEntry> = runCatching { json.decodeFromString(ser, index.readText()) }.getOrDefault(emptyList())

  @Synchronized private fun write(list: List<OutboxEntry>) {
    val tmp = File(dir, "outbox.json.tmp")
    tmp.writeText(json.encodeToString(ser, list))
    if (!tmp.renameTo(index)) { index.delete(); tmp.renameTo(index) }
    _entries.value = list
  }

  @Synchronized private fun mutate(f: (List<OutboxEntry>) -> List<OutboxEntry>) = write(f(_entries.value))

  fun pendingFor(inspectionId: String) = _entries.value.filter { it.inspectionId == inspectionId }
  val pendingCount get() = _entries.value.count { it.state == "pending" }

  // ------------------------------------------------------------------ recording
  fun recordStep(inspectionId: String, stepId: String, value: JsonObject, note: String?, photoFile: File? = null): OutboxEntry {
    val e = OutboxEntry(
      id = UUID.randomUUID().toString(), kind = "response", inspectionId = inspectionId, stepId = stepId, value = value,
      note = note?.trim()?.ifEmpty { null }, recordedAt = Instant.now().toString(), photoFile = photoFile?.name,
    )
    mutate { it + e }
    revision.value++
    return e
  }

  fun queueAction(inspectionId: String, action: String) {
    // One start / submit per round is enough; a re-tap must not queue twice.
    if (_entries.value.any { it.inspectionId == inspectionId && it.action == action && it.state == "pending" }) return
    mutate { it + OutboxEntry(UUID.randomUUID().toString(), "action", inspectionId, action = action, recordedAt = Instant.now().toString()) }
    revision.value++
  }

  /** Drop a refused change (after the operator has seen the reason). */
  fun discard(id: String) {
    _entries.value.firstOrNull { it.id == id }?.photoFile?.let { File(photoDir, it).delete() }
    mutate { l -> l.filterNot { it.id == id } }
    revision.value++
  }

  fun newPhotoFile(): File = File(photoDir, "step_${System.currentTimeMillis()}_${UUID.randomUUID().toString().take(6)}.jpg")

  // ------------------------------------------------------------------ cache of server views
  fun putCache(key: String, text: String) { File(cacheDir, "$key.json").writeText(text) }
  fun cacheText(key: String): String? = File(cacheDir, "$key.json").takeIf { it.exists() }?.readText()
  fun cacheAge(key: String): Long? = File(cacheDir, "$key.json").takeIf { it.exists() }?.lastModified()

  fun cachedInspection(id: String): InspectionEnvelope? = cacheText("insp_$id")?.let { runCatching { json.decodeFromString(InspectionEnvelope.serializer(), it) }.getOrNull() }
  fun saveInspection(env: InspectionEnvelope) { putCache("insp_${env.inspection.id}", json.encodeToString(InspectionEnvelope.serializer(), env)); revision.value++ }
  private fun updateCachedInspection(detail: InspectionDetail) {
    val cur = cachedInspection(detail.id)
    saveInspection(InspectionEnvelope(detail, cur?.permissions ?: InspectionPerms(execute = true)))
  }

  // ------------------------------------------------------------------ replay
  data class FlushResult(val sent: Int, val conflicts: Int, val offline: Boolean)

  /**
   * Replay everything pending, oldest first, per round: photos are uploaded, step answers are sent as one
   * idempotent batch, then start / submit. A network failure stops the replay (retried later) and leaves the
   * queue intact; server refusals become visible conflicts instead of being retried forever.
   */
  suspend fun flush(repo: Repository): FlushResult = flushLock.withLock {
    withContext(Dispatchers.IO) {
      val work = _entries.value.filter { it.state == "pending" }
      if (work.isEmpty()) return@withContext FlushResult(0, 0, false)
      _syncing.value = true
      var sent = 0
      var conflicts = 0
      try {
        for ((inspectionId, group) in work.groupBy { it.inspectionId }) {
          // 1) photos
          val ready = mutableListOf<OutboxEntry>()
          for (e in group.filter { it.kind == "response" }) {
            var cur = e
            if (cur.photoFile != null && cur.attachmentId == null) {
              val f = File(photoDir, cur.photoFile!!)
              if (!f.exists()) { markConflict(cur.id, "photo_missing"); conflicts++; continue }
              try {
                val id = repo.uploadAttachment("inspection", inspectionId, f)
                cur = cur.copy(attachmentId = id, value = buildJsonObject { put("kind", JsonPrimitive("photo")); put("attachmentId", JsonPrimitive(id)) })
                val updated = cur
                mutate { l -> l.map { if (it.id == updated.id) updated else it } }
              } catch (x: ApiException) { if (x.retryable()) throw x; markConflict(cur.id, x.message); conflicts++; continue }
            }
            ready += cur
          }
          // 2) step answers (idempotent by op id)
          if (ready.isNotEmpty()) {
            try {
              val r = repo.sendResponses(inspectionId, ready.map { ResponseOp(it.id, it.stepId!!, it.value!!, it.note, it.recordedAt) })
              val refused = r.conflicts.associate { it.opId to it.reason }
              mutate { l -> l.mapNotNull { e -> if (ready.none { it.id == e.id }) e else refused[e.id]?.let { e.copy(state = "conflict", error = it) } } }
              ready.filter { it.id !in refused }.forEach { e -> e.photoFile?.let { File(photoDir, it).delete() } }
              sent += ready.size - refused.size
              conflicts += refused.size
              updateCachedInspection(r.inspection)
            } catch (x: ApiException) {
              if (x.retryable()) throw x
              ready.forEach { markConflict(it.id, x.message) }; conflicts += ready.size; continue
            }
          }
          // 3) start / submit, in the order they were made
          for (e in group.filter { it.kind == "action" }) {
            try {
              val d = repo.inspectionAction(inspectionId, e.action!!)
              mutate { l -> l.filterNot { it.id == e.id } }
              updateCachedInspection(d)
              sent++
            } catch (x: ApiException) {
              if (x.retryable()) throw x
              // Starting a round that the answers already started is not a conflict.
              if (e.action == "start" && x.code == "invalid_transition") mutate { l -> l.filterNot { it.id == e.id } }
              else { markConflict(e.id, x.message); conflicts++ }
            }
          }
        }
        _lastSync.value = System.currentTimeMillis()
        FlushResult(sent, conflicts, false)
      } catch (x: IOException) {
        mutate { l -> l.map { if (it.state == "pending") it.copy(attempts = it.attempts + 1) else it } }
        FlushResult(sent, conflicts, true)
      } finally {
        _syncing.value = false
        revision.value++
      }
    }
  }

  private fun markConflict(id: String, reason: String?) = mutate { l -> l.map { if (it.id == id) it.copy(state = "conflict", error = reason ?: "refused") else it } }
}

/** Session expiry, rate limits and server errors are retried later; other refusals are conflicts. */
fun ApiException.retryable() = status == 401 || status == 408 || status == 429 || status >= 500

/** Device connectivity as a flow (drives the offline banner and immediate replay when the network returns). */
class Connectivity(context: Context) {
  private val cm = context.getSystemService(ConnectivityManager::class.java)
  private val _online = MutableStateFlow(current())
  val online: StateFlow<Boolean> = _online.asStateFlow()

  private fun current(): Boolean = cm.getNetworkCapabilities(cm.activeNetwork)?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true

  /** Follows the system default network: lost (airplane mode, Wi-Fi and data off) means offline. */
  fun start(onOnline: () -> Unit) {
    cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
      private fun set(v: Boolean) { val was = _online.value; _online.value = v; if (v && !was) onOnline() }
      override fun onAvailable(network: Network) = set(true)
      override fun onLost(network: Network) = set(false)
      override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = set(caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET))
    })
  }
}
