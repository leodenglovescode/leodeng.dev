package dev.leodeng.listening

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.net.URI
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class Config(val enabled: Boolean = false, val website: String = "https://leodeng.dev", val nowToken: String = "",
    val historyOrigin: String = "", val historyToken: String = "")

class Settings(context: Context) {
    private val prefs = context.getSharedPreferences("settings", Context.MODE_PRIVATE)
    private val alias = "listening.credentials.v1"
    @Synchronized private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        return Base64.encodeToString(cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    }
    private fun decrypt(value: String?): String {
        if (value.isNullOrEmpty()) return ""
        val data = Base64.decode(value, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, data.copyOfRange(0, 12)))
        return String(cipher.doFinal(data.copyOfRange(12, data.size)), Charsets.UTF_8)
    }
    @Synchronized fun load(): Config = Config(prefs.getBoolean("enabled", false), prefs.getString("website", "https://leodeng.dev")!!,
        decrypt(prefs.getString("nowToken", null)), prefs.getString("historyOrigin", "")!!, decrypt(prefs.getString("historyToken", null)))
    @Synchronized fun save(c: Config) {
        require(c.nowToken.length <= 1024 && c.historyToken.length <= 1024) { "Token is too long." }
        if (c.nowToken.isNotBlank()) Endpoint.origin(c.website, false)
        if (c.historyToken.isNotBlank()) Endpoint.origin(c.historyOrigin, true)
        require(!c.enabled || c.nowToken.isNotBlank() || c.historyToken.isNotBlank()) { "Configure at least one destination first." }
        check(prefs.edit().putBoolean("enabled", c.enabled).putString("website", c.website.trim().trimEnd('/'))
            .putString("historyOrigin", c.historyOrigin.trim().trimEnd('/')).putString("nowToken", encrypt(c.nowToken.trim()))
            .putString("historyToken", encrypt(c.historyToken.trim())).commit()) { "Could not save settings." }
    }
}

object Endpoint {
    fun origin(input: String, allowPrivateHttp: Boolean): String {
        val text = input.trim().trimEnd('/')
        val uri = runCatching { URI(text) }.getOrElse { throw IllegalArgumentException("Enter a valid server origin.") }
        require(uri.host != null && uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null &&
            uri.rawPath.orEmpty().isEmpty() && (uri.port == -1 || uri.port in 1..65535)) { "Use only scheme, host and optional port." }
        require(uri.scheme == "https" || (uri.scheme == "http" && allowPrivateHttp && privateIpv4(uri.host))) {
            "Use HTTPS, or an HTTP private IP for the history server."
        }
        return text
    }
    private fun privateIpv4(host: String): Boolean {
        val parts = host.split('.')
        if (parts.size != 4 || parts.any { it.isEmpty() || it.length > 3 || it.any { c -> c !in '0'..'9' } || (it.length > 1 && it[0] == '0') }) return false
        val p = parts.map { it.toInt() }
        if (p.any { it !in 0..255 }) return false
        return p[0] == 10 || (p[0] == 172 && p[1] in 16..31) || (p[0] == 192 && p[1] == 168) ||
            (p[0] == 100 && p[1] in 64..127)
    }
}
