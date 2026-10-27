package dev.leodeng.listening

import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import kotlin.math.abs
import kotlin.math.min

data class Track(val title: String, val artist: String, val album: String, val durationMs: Long) {
    val key: String get() = sha256("$title\u0000$artist\u0000$album\u0000$durationMs".toByteArray())
    fun valid() = title.isNotBlank() && artist.isNotBlank() && durationMs in 1..86_400_000 &&
        listOf(title, artist, album).all { it.length <= 500 }
}
fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

data class Sample(val track: Track, val playing: Boolean, val positionMs: Long, val elapsedMs: Long, val wallMs: Long, val speed: Float = 1f)
data class Listen(val id: String, val track: Track, val startedAt: Long, var updatedAt: Long,
    var listenedMs: Long = 0, val days: MutableMap<String, Long> = sortedMapOf()) {
    fun snapshot() = copy(days = days.toSortedMap())
}

/** Uses monotonic time and position together. A seek or an unobserved sleep gap earns no time. */
class HistoryTracker(restored: Listen? = null) {
    var active: Listen? = restored
        private set
    private var previous: Sample? = null

    fun observe(now: Sample): List<Listen> {
        if (!now.track.valid()) return emptyList()
        val old = previous
        val current = active
        val interval = old?.let { now.elapsedMs - it.elapsedMs } ?: 0
        val repeat = old != null && old.track == now.track && now.positionMs + 1500 < old.positionMs && (
            (old.playing && interval in 1..45_000 &&
                old.track.durationMs - old.positionMs + now.positionMs <= interval * old.speed + 1800) ||
            (!old.playing && old.positionMs > now.track.durationMs - 12_000 && now.positionMs < 10_000))
        val restartExpired = old == null && current != null && (now.wallMs - current.updatedAt !in 0..1_800_000)
        val idleExpired = old != null && !old.playing && now.playing && interval > 1_800_000
        val changed = current == null || current.track != now.track || repeat || restartExpired || idleExpired
        val updates = mutableListOf<Listen>()
        if (old != null && current != null && old.track == current.track) {
            val elapsed = now.elapsedMs - old.elapsedMs
            val wallElapsed = now.wallMs - old.wallMs
            // A suspended process cannot reconstruct what happened during the gap.
            if (old.playing && elapsed in 1..45_000 && abs(wallElapsed - elapsed) < 2000 && now.wallMs >= current.updatedAt) {
                val same = old.track == now.track && !repeat
                val progress = if (same) now.positionMs - old.positionMs else old.track.durationMs - old.positionMs
                val speed = old.speed.toDouble().takeIf { it.isFinite() && it > 0 } ?: 1.0
                if (progress >= 0 && progress <= elapsed * speed + 1800) {
                    val credit = min(elapsed, (progress / speed).toLong()).coerceAtLeast(0)
                    addTime(current, old.wallMs, min(now.wallMs, old.wallMs + credit))
                }
            }
            current.updatedAt = maxOf(current.updatedAt, now.wallMs)
            updates += current.snapshot()
        }
        if (changed) active = Listen(UUID.randomUUID().toString().replace("-", ""), now.track, now.wallMs, now.wallMs)
        active!!.updatedAt = maxOf(active!!.updatedAt, now.wallMs)
        if (changed || updates.isEmpty()) updates += active!!.snapshot()
        previous = now
        return updates
    }

    /** Preserve the durable event, but never credit a gap after disconnect or process recreation. */
    fun disconnect() { previous = null }
    fun reset() { previous = null; active = null }

    private fun addTime(listen: Listen, start: Long, end: Long) {
        var cursor = maxOf(start, listen.startedAt, listen.updatedAt)
        while (cursor < end) {
            val day = Instant.ofEpochMilli(cursor).atZone(ZoneOffset.UTC).toLocalDate()
            val until = min(end, day.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
            val amount = until - cursor
            listen.days[day.toString()] = (listen.days[day.toString()] ?: 0) + amount
            listen.listenedMs += amount
            cursor = until
        }
    }
}
