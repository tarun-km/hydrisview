package ai.hydris.field.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Small encrypted key/value store for credentials (refresh cookies, glasses device tokens).
 * Values are AES-256-GCM encrypted with a non-exportable Android Keystore key; only ciphertext
 * reaches SharedPreferences. Nothing secret is ever written in plain text.
 */
class SecureStore(context: Context) {
  private val prefs = context.getSharedPreferences("hydris.secure", Context.MODE_PRIVATE)
  private val alias = "hydris.secure.v1"

  private fun key(): SecretKey {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (ks.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    gen.init(
      KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build(),
    )
    return gen.generateKey()
  }

  @Synchronized fun put(name: String, value: String?) {
    if (value == null) { prefs.edit().remove(name).apply(); return }
    val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
    val payload = c.iv + c.doFinal(value.toByteArray(Charsets.UTF_8))
    prefs.edit().putString(name, Base64.encodeToString(payload, Base64.NO_WRAP)).apply()
  }

  @Synchronized fun get(name: String): String? {
    val raw = prefs.getString(name, null) ?: return null
    return runCatching {
      val bytes = Base64.decode(raw, Base64.NO_WRAP)
      val c = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes, 0, 12)) }
      String(c.doFinal(bytes, 12, bytes.size - 12), Charsets.UTF_8)
    }.getOrNull()
  }

  fun clear(vararg names: String) = names.forEach { put(it, null) }
}
