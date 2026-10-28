package ai.hydris.field.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

// Shapes mirror the Hydris API (apps/api/src/modules). Unknown keys are ignored, so the API can grow.

@Serializable data class User(val id: String, val name: String, val email: String, val isPlatformAdmin: Boolean = false, val mfaEnabled: Boolean = false)
@Serializable data class Membership(val orgId: String, val orgName: String, val role: String, val isDemo: Boolean = false, val allSites: Boolean = true)
@Serializable data class OrgRef(val id: String, val name: String, val isDemo: Boolean = false)
@Serializable data class Session(
  val accessToken: String? = null,
  val user: User,
  val memberships: List<Membership> = emptyList(),
  val org: OrgRef? = null,
  val role: String? = null,
  val permissions: List<String> = emptyList(),
  val mfaRequired: Boolean = false,
  val mfaToken: String? = null,
  /** "admin" (console + glasses) or "operator" (this app + glasses). Admins may use the app for glasses too. */
  val accountType: String? = null,
)
@Serializable data class MagicLinkRequest(val email: String, val client: String)
@Serializable data class ExchangeRequest(val accessToken: String? = null, val magicToken: String? = null)

// ---------------- overview (console dashboard)
@Serializable data class Overview(
  val generatedAt: String,
  val alarms: AlarmCounts,
  val inspections: InspectionCounts,
  val maintenance: MaintenanceCounts,
  val devices: DeviceCounts,
  val activeOperators: Int = 0,
  val sites: List<SiteSummary> = emptyList(),
  val assetHealth: List<AssetHealth> = emptyList(),
  val metrics: List<Metric> = emptyList(),
  val recentAlarms: List<RecentAlarm> = emptyList(),
  val activity: List<Activity> = emptyList(),
  val alarmTrend: List<DayCount> = emptyList(),
)
@Serializable data class AlarmCounts(val active: Int = 0, val critical: Int = 0, val open: Int = 0, val last24h: Int = 0)
@Serializable data class InspectionCounts(val due: Int = 0, val overdue: Int = 0, val review: Int = 0, val done7d: Int = 0)
@Serializable data class MaintenanceCounts(val open: Int = 0, val urgent: Int = 0)
@Serializable data class DeviceCounts(val registered: Int = 0, val connected: Int = 0)
@Serializable data class SiteSummary(val id: String, val name: String, val code: String, val assets: Int = 0, val degraded: Int = 0, val openAlarms: Int = 0, val criticalAlarms: Int = 0)
@Serializable data class AssetHealth(val status: String, val n: Int)
@Serializable data class Metric(val id: String, val tag: String, val name: String, val assetTag: String? = null, val measurand: String, val label: String, val unit: String, val decimals: Int = 2, val value: Double? = null, val ts: String? = null, val source: String? = null, val freshness: String = "no_data")
@Serializable data class RecentAlarm(val id: String, val title: String, val severity: String, val state: String, val triggeredAt: String, val assetTag: String? = null, val synthetic: Boolean = false)
@Serializable data class Activity(val id: String, val action: String, val summary: String? = null, val at: String, val actorName: String? = null, val actorLabel: String? = null)
@Serializable data class DayCount(val day: String, val n: Int)

// ---------------- alarms
@Serializable data class AlarmList(val alarms: List<Alarm>)
@Serializable data class AlarmEnvelope(val alarm: Alarm, val allowedActions: List<String> = emptyList(), val history: List<AlarmHistory> = emptyList())
@Serializable data class AlarmHistory(val id: String, val action: String, val note: String? = null, val at: String, val actorName: String? = null, val toState: String? = null)
@Serializable data class Alarm(
  val id: String, val severity: String, val condition: String? = null, val state: String, val title: String,
  val description: String? = null, val recommendedAction: String? = null, val triggerValue: Double? = null, val threshold: Double? = null,
  val unit: String? = null, val peakValue: Double? = null, val triggeredAt: String, val clearedAt: String? = null,
  val acknowledgedAt: String? = null, val assetTag: String? = null, val assetName: String? = null, val sensorTag: String? = null, val assigneeName: String? = null,
  val synthetic: Boolean = false, val siteId: String? = null, val siteName: String? = null, val assignedTo: String? = null, val resolutionNote: String? = null,
  /** Only from /me/work and /me/shift: assigned to the caller, and the transitions the caller may perform now. */
  val mine: Boolean = false, val allowedActions: List<String> = emptyList(),
)

// ---------------- work
@Serializable data class InspectionList(val inspections: List<InspectionSummary>)
@Serializable data class InspectionSummary(
  val id: String, val title: String, val status: String, val priority: String = "normal", val dueAt: String? = null,
  val stepCount: Int = 0, val answered: Int = 0, val assetTag: String? = null, val assetName: String? = null, val assigneeName: String? = null, val siteName: String? = null,
  val siteId: String? = null, val assignedTo: String? = null, val mine: Boolean = false, val startedAt: String? = null, val submittedAt: String? = null,
)
@Serializable data class TaskList(val tasks: List<Task>)
@Serializable data class Task(
  val id: String, val title: String, val description: String? = null, val kind: String = "corrective", val priority: String = "medium", val status: String,
  val checklist: List<ChecklistItem> = emptyList(), val dueAt: String? = null, val assetTag: String? = null, val assetName: String? = null, val assigneeName: String? = null, val siteName: String? = null,
  val siteId: String? = null, val assignedTo: String? = null, val completionNote: String? = null, val mine: Boolean = false, val allowedActions: List<String> = emptyList(),
)
@Serializable data class TaskEnvelope(val task: Task, val activity: List<TaskActivity> = emptyList(), val permissions: TaskPerms = TaskPerms())
@Serializable data class TaskActivity(val id: String, val action: String, val note: String? = null, val at: String, val actorName: String? = null)
@Serializable data class TaskPerms(val manage: Boolean = false, val execute: Boolean = false)

// ---------------- rounds (inspection execution, same contract as the glasses)
@Serializable data class InspectionEnvelope(val inspection: InspectionDetail, val permissions: InspectionPerms = InspectionPerms())
@Serializable data class InspectionPerms(val execute: Boolean = false, val manage: Boolean = false, val review: Boolean = false)
@Serializable data class InspectionDetail(
  val id: String, val title: String, val status: String, val priority: String = "normal", val dueAt: String? = null, val siteId: String? = null,
  val steps: List<Step> = emptyList(), val safetyNotices: List<String> = emptyList(), val asset: AssetRef? = null, val assignedTo: String? = null,
  val responses: Map<String, StepResponse> = emptyMap(), val revision: Int = 0, val reviewNote: String? = null, val submittedAt: String? = null,
)
@Serializable data class AssetRef(val id: String, val tag: String, val name: String, val type: String? = null, val status: String? = null)
@Serializable data class Step(
  val id: String, val kind: String, val title: String, val instruction: String? = null, val caution: String? = null, val required: Boolean = false,
  val measurand: String? = null, val unit: String? = null, val expectedMin: Double? = null, val expectedMax: Double? = null,
  val options: List<String> = emptyList(), val abnormalOptions: List<String> = emptyList(),
)
@Serializable data class StepResponse(val value: kotlinx.serialization.json.JsonObject, val outcome: String = "ok", val note: String? = null, val recordedAt: String? = null)
@Serializable data class ResponseOp(val opId: String, val stepId: String, val value: kotlinx.serialization.json.JsonObject, val note: String? = null, val recordedAt: String)
@Serializable data class ResponseBatch(val ops: List<ResponseOp>)
@Serializable data class OpConflict(val opId: String, val reason: String)
@Serializable data class ResponseResult(val applied: Int = 0, val duplicates: Int = 0, val conflicts: List<OpConflict> = emptyList(), val inspection: InspectionDetail)
@Serializable data class AttachmentEnvelope(val attachment: AttachmentRef)
@Serializable data class AttachmentRef(val id: String, val filename: String? = null)

// ---------------- field operator ("My shift", /me/*)
@Serializable data class ProfileEnvelope(val profile: Profile)
@Serializable data class Profile(
  val user: ProfileUser, val accountType: String = "operator", val org: ProfileOrg, val title: String? = null, val employeeId: String? = null,
  val phone: String? = null, val shiftLabel: String? = null, val allSites: Boolean = true, val sites: List<SiteRef> = emptyList(), val glasses: List<AssignedGlasses> = emptyList(),
)
@Serializable data class ProfileUser(val id: String, val name: String, val email: String)
@Serializable data class ProfileOrg(val id: String, val name: String, val isDemo: Boolean = false, val timezone: String = "UTC")
@Serializable data class AssignedGlasses(val id: String, val name: String, val model: String? = null, val status: String = "active", val lastSeenAt: String? = null)
@Serializable data class Shift(
  val profile: Profile, val generatedAt: String, val progress: ShiftProgress = ShiftProgress(), val nextRound: InspectionSummary? = null,
  val rounds: List<InspectionSummary> = emptyList(), val alarms: ShiftAlarms = ShiftAlarms(), val tasks: ShiftTasks = ShiftTasks(), val plant: List<PlantReading> = emptyList(),
)
@Serializable data class ShiftProgress(val done: Int = 0, val assigned: Int = 0, val inProgress: Int = 0, val overdue: Int = 0)
@Serializable data class ShiftAlarms(val items: List<Alarm> = emptyList(), val open: Int = 0, val mine: Int = 0, val critical: Int = 0)
@Serializable data class ShiftTasks(val items: List<Task> = emptyList(), val open: Int = 0)
@Serializable data class PlantReading(
  val id: String, val tag: String, val name: String, val measurand: String, val unit: String, val value: Double? = null, val ts: String? = null, val source: String? = null,
  val siteName: String? = null, val assetTag: String? = null, val openAlarms: Int = 0, val freshness: String = "no_data",
)
@Serializable data class WorkView(val scope: String = "mine", val sites: List<SiteRef> = emptyList(), val alarms: List<Alarm> = emptyList(), val inspections: List<InspectionSummary> = emptyList(), val tasks: List<Task> = emptyList())
@Serializable data class ChecklistItem(val id: String, val label: String, val done: Boolean)

// ---------------- telemetry
@Serializable data class SensorList(val sensors: List<Sensor>)
@Serializable data class Sensor(
  val id: String, val tag: String, val name: String, val measurand: String, val unit: String, val lastValue: Double? = null, val lastTs: String? = null,
  val lastSource: String? = null, val assetTag: String? = null, val assetName: String? = null, val openAlarms: Int = 0, val freshness: String = "no_data",
)
@Serializable data class SensorHistory(val sensor: HistorySensor, val from: String, val to: String, val totalReadings: Int = 0, val points: List<Point> = emptyList())
@Serializable data class HistorySensor(val id: String, val tag: String, val name: String, val unit: String, val label: String = "", val decimals: Int = 2, val typicalRange: List<Double>? = null, val lastValue: Double? = null, val freshness: String = "no_data", val explanation: String? = null)
@Serializable data class Point(val t: String, val v: Double, val min: Double? = null, val max: Double? = null, val n: Int = 1)

// ---------------- notifications
@Serializable data class NotificationList(val notifications: List<Notice> = emptyList(), val unread: Int = 0)
@Serializable data class Notice(val id: String, val title: String, val body: String? = null, val severity: String = "info", val readAt: String? = null, val createdAt: String, val kind: String = "")

// ---------------- assistant
@Serializable data class AskRequest(val text: String, val history: List<Turn> = emptyList())
@Serializable data class Turn(val role: String, val text: String)
@Serializable data class Answer(val answer: String, val intent: String, val engine: String, val facts: List<Fact> = emptyList())
@Serializable data class Fact(val label: String, val value: String, val unit: String? = null, val at: String? = null, val source: String? = null, val ref: String? = null)

// ---------------- audit documents (OCR)
@Serializable data class OcrWord(val text: String, val conf: Double, val bbox: List<Double>)
@Serializable data class OcrLine(val text: String, val conf: Double, val bbox: List<Double>, val words: List<OcrWord>)
@Serializable data class OcrReading(val engine: String, val text: String, val conf: Double, val lines: List<OcrLine>)
@Serializable data class ScanPage(val mime: String, val data: String, val width: Int, val height: Int, val readings: List<OcrReading>)
@Serializable data class ScanUpload(val title: String? = null, val pages: List<ScanPage>, val source: String? = "mobile")
@Serializable data class ReviewProgress(val total: Int = 0, val done: Int = 0, val flagged: Int = 0, val pending: Int = 0, val complete: Boolean = false)
@Serializable data class AuditDocSummary(
  val id: String, val title: String, val docType: String = "general", val status: String, val pageCount: Int = 0, val capturedVia: String = "console",
  val capturedBy: String? = null, val createdAt: String, val agreement: Double? = null, val fields: Int = 0, val tables: Int = 0, val figures: Int = 0,
  val review: ReviewProgress = ReviewProgress(), val attention: Int = 0, val aiStatus: String = "none", val siteName: String? = null,
)

// ---------------- device pairing (register the glasses as a Hydris device)
@Serializable data class DeviceInfo(val kind: String, val name: String? = null, val model: String? = null, val appVersion: String? = null)
@Serializable data class ChallengeRequest(val hardwareId: String, val device: DeviceInfo)
@Serializable data class Challenge(val challengeId: String, val userCode: String, val pollSecret: String, val expiresAt: String, val pollIntervalS: Int = 3)
@Serializable data class PollRequest(val pollSecret: String)
@Serializable data class PollResult(val status: String, val accessToken: String? = null, val refreshToken: String? = null, val device: DeviceRef? = null)
@Serializable data class DeviceRef(val id: String, val name: String)
@Serializable data class Lookup(val sites: List<SiteRef> = emptyList(), val organization: String? = null)
@Serializable data class SiteRef(val id: String, val name: String, val code: String)
@Serializable data class Approve(val code: String, val siteId: String, val deviceName: String? = null)
@Serializable data class DeviceRefresh(val refreshToken: String)
@Serializable data class DeviceTokens(val accessToken: String, val refreshToken: String)

@Serializable data class ApiErrorBody(val error: ApiErrorDetail? = null)
@Serializable data class ApiErrorDetail(val code: String? = null, val message: String? = null, val detail: JsonElement? = null)
