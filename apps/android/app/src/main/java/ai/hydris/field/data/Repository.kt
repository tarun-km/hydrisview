package ai.hydris.field.data

import kotlinx.coroutines.delay
import kotlinx.serialization.builtins.ListSerializer

/** Everything the app reads and writes, all through the shared Hydris API (one account, every surface). */
class Repository(val api: HydrisApi) {
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
