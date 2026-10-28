package ai.hydris.glassesbridge

import java.security.MessageDigest

/**
 * Canonical Hydris hardware id of Ray-Ban Meta glasses. KEEP IDENTICAL in both apps:
 *   apps/android/.../glasses/GlassesId.kt            (Hydris Field: auto-registration, POST /devices/claim)
 *   apps/glasses-bridge-android/.../GlassesId.kt     (WebView bridge: HydrisNative.hardwareId() → pairing challenge)
 * so the native app and the bridge resolve the same glasses to one device record (server: canonicalHardwareId).
 *
 * "rbm-" + hex of the first 16 bytes of SHA-256("hydris-glasses:" + DAT device identifier). Non-reversible,
 * lower case, stable for the same glasses.
 */
object GlassesId {
  fun canonical(datDeviceId: String): String {
    val h = MessageDigest.getInstance("SHA-256").digest("hydris-glasses:$datDeviceId".toByteArray())
    return "rbm-" + h.take(16).joinToString("") { "%02x".format(it) }
  }
}
