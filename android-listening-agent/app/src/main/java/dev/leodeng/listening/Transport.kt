package dev.leodeng.listening

import java.io.IOException
import java.net.HttpURLConnection
import java.net.Proxy
import java.net.URL

class HttpFailure(val status: Int) : IOException(when(status) {
    401, 403 -> "Authentication failed. Check the destination token."
    429 -> "Server rate limit. Will retry."
    else -> "Server returned HTTP $status."
})
class Transport(private val connect: (URL) -> HttpURLConnection = { it.openConnection(Proxy.NO_PROXY) as HttpURLConnection }) {
    fun send(origin: String, path: String, token: String, method: String, body: ByteArray, type: String, history: Boolean = false): String {
        val base = Endpoint.origin(origin, history)
        val conn = connect(URL(base + path))
        try {
            conn.connectTimeout = 5000
            conn.readTimeout = 7000
            conn.instanceFollowRedirects = false
            conn.requestMethod = method
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.setRequestProperty("Content-Type", type)
            conn.setRequestProperty("Accept", "application/json")
            conn.setRequestProperty("User-Agent", "Listening-Android/1.0")
            conn.doOutput = true
            conn.setFixedLengthStreamingMode(body.size)
            conn.outputStream.use { it.write(body) }
            val status = conn.responseCode
            if (status !in 200..299) throw HttpFailure(status)
            return conn.inputStream.use {
                val out = java.io.ByteArrayOutputStream()
                val chunk = ByteArray(1024)
                while (true) {
                    val count = it.read(chunk)
                    if (count == -1) break
                    if (out.size() + count > 8192) throw IOException("Server response was too large.")
                    out.write(chunk, 0, count)
                }
                String(out.toByteArray(), Charsets.UTF_8)
            }
        } finally { conn.disconnect() }
    }
}
