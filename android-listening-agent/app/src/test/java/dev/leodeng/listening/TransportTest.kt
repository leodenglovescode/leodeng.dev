package dev.leodeng.listening

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL

class TransportTest {
    private class Connection(val code: Int = 200, val response: ByteArray = "{\"ok\":true}".toByteArray()) : HttpURLConnection(URL("https://example.com")) {
        val sent = ByteArrayOutputStream()
        var closed = false
        override fun connect() = Unit
        override fun disconnect() { closed = true }
        override fun usingProxy() = false
        override fun getResponseCode() = code
        override fun getOutputStream() = sent
        override fun getInputStream() = ByteArrayInputStream(response)
    }
    @Test fun refusesRedirectsAndAlwaysCloses() {
        val conn = Connection(302)
        val transport = Transport { conn }
        assertThrows(HttpFailure::class.java) { transport.send("https://example.com", "/test", "test-only-placeholder", "POST", byteArrayOf(), "application/json") }
        assertFalse(conn.instanceFollowRedirects)
        assertTrue(conn.closed)
    }
    @Test fun responseBufferCannotGrowWithoutBound() {
        val conn = Connection(response = ByteArray(10000))
        assertThrows(java.io.IOException::class.java) { Transport { conn }.send("https://example.com", "/test", "test-only-placeholder", "POST", byteArrayOf(), "application/json") }
        assertTrue(conn.closed)
    }
    @Test fun sendsRawBodyAndAuthorizationAndBoundsTimeouts() {
        val conn = Connection()
        val payload = "{\"events\":[]}".toByteArray()
        val response = Transport { conn }.send("http://100.64.1.2:8791", "/v1/listens", "test-only-placeholder", "POST", payload, "application/json", true)
        assertEquals("{\"ok\":true}", response)
        assertArrayEquals(payload, conn.sent.toByteArray())
        assertEquals("Bearer test-only-placeholder", conn.getRequestProperty("Authorization"))
        assertEquals(5000, conn.connectTimeout)
        assertEquals(7000, conn.readTimeout)
        assertTrue(conn.closed)
    }
    @Test fun rejectsPublicCleartextBeforeOpeningSocket() {
        var opened = false
        assertThrows(IllegalArgumentException::class.java) {
            Transport { opened = true; Connection() }.send("http://example.com", "/v1/listens", "test-only-placeholder", "POST", byteArrayOf(), "application/json", true)
        }
        assertFalse(opened)
    }
}
