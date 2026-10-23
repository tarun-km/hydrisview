package ai.hydris.field.data

import ai.hydris.field.BuildConfig
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.serializer
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

class ApiException(val status: Int, val code: String?, override val message: String) : IOException(message)

/**
 * Client for the Hydris API - the same API the console and glasses use, so one account and one
 * tenant's data everywhere. Sessions follow the web contract: a short-lived bearer access token in
 * memory plus the rotating `hg_refresh` cookie (and the demo-mode session cookie), persisted
 * encrypted. 401s refresh once and retry. A second credential channel carries the paired glasses'
 * device token, so scans taken with the glasses are attributed to that device in the console.
 */
class HydrisApi(private val store: SecureStore, val baseUrl: String = BuildConfig.HYDRIS_URL) {
  val json = Json { ignoreUnknownKeys = true; explicitNulls = false; encodeDefaults = true }
  private val jsonType = "application/json".toMediaType()

  @Volatile var accessToken: String? = null
  @Volatile var onSessionLost: (() -> Unit)? = null
  private val refreshLock = Mutex()

  private val cookieJar = object : CookieJar {
    private val host = baseUrl.toHttpUrl().host
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
      val kept = load().associateBy { it.name }.toMutableMap()
      cookies.forEach { c -> if (c.expiresAt < System.currentTimeMillis()) kept.remove(c.name) else kept[c.name] = c }
      store.put("cookies", kept.values.joinToString("\n") { it.toString() })
    }
    override fun loadForRequest(url: HttpUrl): List<Cookie> = if (url.host == host) load().filter { it.matches(url) } else emptyList()
    private fun load(): List<Cookie> {
      val url = baseUrl.toHttpUrl()
      return store.get("cookies")?.lines()?.mapNotNull { Cookie.parse(url, it) }?.filter { it.expiresAt > System.currentTimeMillis() } ?: emptyList()
    }
  }

  val http: OkHttpClient = OkHttpClient.Builder()
    .cookieJar(cookieJar)
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(90, TimeUnit.SECONDS) // OCR uploads and vision extraction can take a while
    .build()
  private val sse: OkHttpClient = http.newBuilder().readTimeout(0, TimeUnit.MILLISECONDS).build()

  fun clearSession() {
    accessToken = null
    store.clear("cookies")
  }

  // ------------------------------------------------------------------ core
  private fun request(path: String, method: String, body: String?, token: String?): Request {
    val b = Request.Builder().url("$baseUrl/api$path").header("accept", "application/json")
    token?.let { b.header("authorization", "Bearer $it") }
    val rb = body?.toRequestBody(jsonType) ?: if (method == "GET") null else "{}".toRequestBody(jsonType)
    return b.method(method, rb).build()
  }

  private fun Response.textOrThrow(): String {
    val text = body?.string().orEmpty()
    if (isSuccessful) return text
    val err = runCatching { json.decodeFromString(ApiErrorBody.serializer(), text).error }.getOrNull()
    throw ApiException(code, err?.code, err?.message ?: "Request failed ($code)")
  }

  suspend fun raw(path: String, method: String = "GET", body: String? = null, retry: Boolean = true): String = withContext(Dispatchers.IO) {
    val res = http.newCall(request(path, method, body, accessToken)).execute()
    if (res.code == 401 && retry && !path.startsWith("/auth/login") && !path.startsWith("/auth/demo")) {
      res.close()
      if (refresh()) return@withContext raw(path, method, body, retry = false)
      onSessionLost?.invoke()
      throw ApiException(401, "unauthenticated", "Session ended. Please sign in again.")
    }
    res.use { it.textOrThrow() }
  }

  suspend inline fun <reified T> get(path: String): T = json.decodeFromString(serializer<T>(), raw(path))
  suspend inline fun <reified B, reified T> post(path: String, body: B): T = json.decodeFromString(serializer<T>(), raw(path, "POST", json.encodeToString(serializer<B>(), body)))
  suspend fun postEmpty(path: String): String = raw(path, "POST", "{}")

  /** Rotate the refresh cookie and get a new access token. Serialized so parallel 401s refresh once. */
  suspend fun refresh(): Boolean = refreshLock.withLock {
    withContext(Dispatchers.IO) {
      runCatching {
        http.newCall(request("/auth/refresh", "POST", "{}", null)).execute().use { res ->
          if (!res.isSuccessful) return@use false
          val s = json.decodeFromString(Session.serializer(), res.body!!.string())
          accessToken = s.accessToken
          s.accessToken != null
        }
      }.getOrDefault(false)
    }
  }

  // ------------------------------------------------------------------ auth
  suspend fun login(email: String, password: String): Session = post<Map<String, String>, Session>("/auth/login", mapOf("email" to email, "password" to password)).also { accessToken = it.accessToken }
  suspend fun demo(name: String): Session = post<Map<String, String>, Session>("/auth/demo", mapOf("name" to name)).also { accessToken = it.accessToken }
  suspend fun me(): Session = get("/auth/me")
  suspend fun logout() { runCatching { postEmpty("/auth/logout") }; clearSession() }

  /** Restore a session from the stored refresh cookie (app restart). */
  suspend fun resume(): Session? = if (refresh()) runCatching { me() }.getOrNull() else null

  // ------------------------------------------------------------------ device channel (paired glasses)
  suspend fun <T> deviceCall(path: String, method: String, body: String?, de: KSerializer<T>): T = withContext(Dispatchers.IO) {
    fun call(token: String?) = http.newCall(request(path, method, body, token)).execute()
    var res = call(store.get("device.access"))
    if (res.code == 401) {
      res.close()
      val rt = store.get("device.refresh") ?: throw ApiException(401, "not_paired", "The glasses are not registered")
      val tokens = http.newCall(request("/device/refresh", "POST", json.encodeToString(DeviceRefresh.serializer(), DeviceRefresh(rt)), null)).execute().use {
        json.decodeFromString(DeviceTokens.serializer(), it.textOrThrow())
      }
      store.put("device.access", tokens.accessToken)
      store.put("device.refresh", tokens.refreshToken)
      res = call(tokens.accessToken)
    }
    res.use { json.decodeFromString(de, it.textOrThrow()) }
  }
  fun saveDeviceTokens(access: String, refresh: String) { store.put("device.access", access); store.put("device.refresh", refresh) }
  fun forgetDevice() = store.clear("device.access", "device.refresh", "device.id", "device.name")
  fun hasDevice() = store.get("device.refresh") != null
  var deviceName: String?
    get() = store.get("device.name")
    set(v) = store.put("device.name", v)

  // ------------------------------------------------------------------ realtime (SSE)
  /** Server-sent domain events (alarm.raised, auditdoc.updated, …) for this account. Reconnects with Last-Event-ID. */
  fun events(): Flow<Pair<String, String>> = callbackFlow {
    var lastId: String? = null
    var stopped = false
    val worker = Thread {
      while (!stopped) {
        try {
          val token = accessToken ?: run { Thread.sleep(2000); null } ?: continue
          val req = Request.Builder().url("$baseUrl/api/events/stream").header("authorization", "Bearer $token").header("accept", "text/event-stream")
            .apply { lastId?.let { header("last-event-id", it) } }.build()
          sse.newCall(req).execute().use { res ->
            if (res.code == 401) { kotlinx.coroutines.runBlocking { refresh() }; return@use }
            val src = res.body?.source() ?: return@use
            var event = "message"
            val data = StringBuilder()
            while (!stopped) {
              val line = src.readUtf8Line() ?: break
              when {
                line.isEmpty() -> { if (data.isNotEmpty()) trySend(event to data.toString()); event = "message"; data.clear() }
                line.startsWith("event:") -> event = line.substringAfter(':').trim()
                line.startsWith("data:") -> data.append(line.substringAfter(':').trim())
                line.startsWith("id:") -> lastId = line.substringAfter(':').trim()
              }
            }
          }
        } catch (_: Exception) {
          if (!stopped) Thread.sleep(3000)
        }
      }
    }.apply { isDaemon = true; start() }
    awaitClose { stopped = true; worker.interrupt() }
  }.flowOn(Dispatchers.IO)
}
