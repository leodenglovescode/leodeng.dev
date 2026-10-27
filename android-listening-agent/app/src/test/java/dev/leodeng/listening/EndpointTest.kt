package dev.leodeng.listening
import org.junit.Assert.*
import org.junit.Test
class EndpointTest {
    @Test fun privateOriginsAndHttpsAccepted() {
        assertEquals("http://100.64.1.2:8791", Endpoint.origin("http://100.64.1.2:8791/", true))
        assertEquals("http://192.168.1.2", Endpoint.origin("http://192.168.1.2", true))
        assertEquals("https://example.com", Endpoint.origin("https://example.com", false))
    }
    @Test fun rejectCredentialLeaksAndPublicCleartext() {
        listOf("http://example.com", "http://100.128.1.2", "http://192.168.1.2.evil.test", "https://user:password@example.com",
            "https://example.com/path", "https://example.com?token=x", "https://example.com#x", "http://0300.168.1.1", "ftp://example.com").forEach {
            assertThrows(IllegalArgumentException::class.java) { Endpoint.origin(it, true) }
        }
        assertThrows(IllegalArgumentException::class.java) { Endpoint.origin("http://192.168.1.2", false) }
    }
}
