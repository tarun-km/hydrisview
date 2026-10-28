package ai.hydris.field.data

import kotlinx.coroutines.delay
import kotlinx.serialization.builtins.ListSerializer

/** Everything the app reads and writes, all through the shared Hydris API (one account, every surface). */
class Repository(val api: HydrisApi, val outbox: Outbox) {
  /** A server view, or the last cached copy when offline ([cachedAt] set). */
  data class Fresh<T>(val value: T, val cachedAt: Long? = null)

  private suspend fun <T> cachedGet(key: String, path: String, de: kotlinx.serialization.KSerializer<T>): Fresh<T> = try {
    val text = api.raw(path)
    outbox.putCache(key, text)
    Fresh(api.json.decodeFromString(de, text))
  } catch (e: java.io.IOException) {
    if (e is ApiException && !e.retryable()) throw e
    val text = outbox.cacheText(key) ?: throw e
    Fresh(api.json.decodeFromString(de, text), outbox.cacheAge(key) ?: 0L)
  }

  // ---------------- field operator (/me/*)
  suspend fun shift(): Fresh<Shift> = cachedGet("shift", "/me/shift", Shift.serializer())
  suspend fun work(scope: String): Fresh<WorkView> = cachedGet("work_$scope", "/me/work?scope=$scope", WorkView.serializer())
  suspend fun profile(): Fresh<Profile> = cachedGet("profile", "/me/profile", ProfileEnvelope.serializer()).let { Fresh(it.value.profile, it.cachedAt) }

  // ---------------- rounds
  /** Latest server view of a round (cached for offline use); falls back to the cached copy when offline. */
  suspend fun inspection(id: String): Fresh<InspectionEnvelope> = try {
    val env = api.get<InspectionEnvelope>("/inspections/$id")
    outbox.saveInspection(env)
    Fresh(env)
  } catch (e: java.io.IOException) {
    if (e is ApiException && !e.retryable()) throw e
    Fresh(outbox.cachedInspection(id) ?: throw e, outbox.cacheAge("insp_$id") ?: 0L)
  }
  suspend fun sendResponses(id: String, ops: List<ResponseOp>): ResponseResult = api.post("/inspections/$id/responses", ResponseBatch(ops))
  suspend fun inspectionAction(id: String, action: String): InspectionDetail =
    api.json.decodeFromString(InspectionEnvelope.serializer(), api.raw("/inspections/$id/$action", "POST", "{}")).inspection
  suspend fun uploadAttachment(ownerType: String, ownerId: String, file: java.io.File): String =
    api.json.decodeFromString(AttachmentEnvelope.serializer(), api.upload("/attachments", mapOf("ownerType" to ownerType, "ownerId" to ownerId), file, "image/jpeg")).attachment.id

  // ---------------- maintenance
  suspend fun task(id: String): TaskEnvelope = api.get("/maintenance/$id")
  suspend fun taskAction(id: String, action: String, note: String? = null): Task =
    api.post<Map<String, String>, TaskEnvelope>("/maintenance/$id/$action", buildMap { note?.let { put("note", it) } }).task
  suspend fun alarmDetail(id: String): AlarmEnvelope = api.get("/alarms/$id")

  suspend fun overview(): Overview = api.get("/overview")
  suspend fun alarms(): List<Alarm> = api.get<AlarmList>("/alarms").alarms
  suspend fun alarm(id: String): Alarm = api.get<AlarmEnvelope>("/alarms/$id").alarm
  suspend fun alarmAction(id: String, action: String, note: String? = null): Alarm =
    api.post<Map<String, String>, AlarmEnvelope>("/alarms/$id/$action", buildMap { note?.let { put("note", it) } }).alarm

  suspend fun inspections(): List<InspectionSummary> = api.get<InspectionList>("/inspections").inspections
  suspend fun tasks(): List<Task> = api.get<TaskList>("/maintenance").tasks
  suspend fun toggleChecklist(taskId: String, itemId: String, done: Boolean) {
    api.raw("/maintenance/$taskId/checklist/$itemId", "POST", api.json.encodeToString(kotlinx.serialization.json.JsonObject.serializer(),
      kotlinx.serialization.json.buildJsonObject { put("done", kotlinx.serialization.json.JsonPrimitive(done)) }))
  }

  suspend fun sensors(): List<Sensor> = api.get<SensorList>("/sensors").sensors
  suspend fun history(sensorId: String, hours: Int = 24): SensorHistory {
    val from = java.time.Instant.now().minusSeconds(hours * 3600L).toString()
    return api.get("/telemetry/sensors/$sensorId/history?from=$from&points=144")
  }
  suspend fun notifications(): NotificationList = api.get("/notifications")

  suspend fun ask(text: String, history: List<Turn>): Answer = api.post("/assistant/ask", AskRequest(text, history))

  suspend fun auditDocs(): List<AuditDocSummary> = api.json.decodeFromString(ListSerializer(AuditDocSummary.serializer()), api.raw("/audit-docs"))

  /** Upload a scan. Taken with the glasses → sent with the glasses' device token (attributed to the device). */
  suspend fun uploadScan(upload: ScanUpload, viaGlasses: Boolean): AuditDocSummary {
    val body = api.json.encodeToString(ScanUpload.serializer(), upload)
    val doc = if (viaGlasses && api.hasDevice()) api.deviceCall("/audit-docs", "POST", body, AuditDocSummary.serializer())
    else api.json.decodeFromString(AuditDocSummary.serializer(), api.raw("/audit-docs", "POST", body))
    if (doc.aiStatus == "pending") runCatching { api.postEmpty("/audit-docs/${doc.id}/enhance") }
    return doc
  }

  /**
   * Register the connected glasses as a Hydris device for this account (same RFC 8628-style flow as the
   * console's QR pairing, but the signed-in user approves it directly). Re-registering the same glasses
   * reuses the console's device record.
   */
  suspend fun registerGlasses(hardwareId: String, name: String, model: String): DeviceRef {
    val ch: Challenge = api.json.decodeFromString(Challenge.serializer(), api.raw("/pairing/challenges", "POST",
      api.json.encodeToString(ChallengeRequest.serializer(), ChallengeRequest(hardwareId, DeviceInfo(kind = "hardware", name = name, model = model, appVersion = "android-1.0.0")))))
    val lookup: Lookup = api.get("/pairing/lookup?code=${ch.userCode}")
    val site = lookup.sites.firstOrNull() ?: throw ApiException(400, "no_site", "Your account has no site to assign the glasses to")
    api.raw("/pairing/approve", "POST", api.json.encodeToString(Approve.serializer(), Approve(ch.userCode, site.id, name)))
    repeat(20) {
      val r = api.json.decodeFromString(PollResult.serializer(), api.raw("/pairing/challenges/${ch.challengeId}/poll", "POST", api.json.encodeToString(PollRequest.serializer(), PollRequest(ch.pollSecret))))
      when (r.status) {
        "completed" -> {
          api.saveDeviceTokens(r.accessToken ?: error("no token"), r.refreshToken ?: error("no token"))
          api.deviceName = r.device?.name ?: name
          return r.device ?: DeviceRef("", name)
        }
        "pending", "approved", "slow_down" -> delay(ch.pollIntervalS * 1000L)
        else -> throw ApiException(400, r.status, "Pairing ${r.status}")
      }
    }
    throw ApiException(408, "timeout", "Pairing timed out")
  }

  suspend fun unregisterGlasses() {
    runCatching { api.deviceCall("/device/logout", "POST", "{}", kotlinx.serialization.json.JsonElement.serializer()) }
    api.forgetDevice()
  }
}
