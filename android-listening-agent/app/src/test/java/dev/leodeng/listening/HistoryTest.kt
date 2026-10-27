package dev.leodeng.listening

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class HistoryTest {
    private val track = Track("Say It Ain't So", "Weezer", "Weezer", 258000)
    private val start = Instant.parse("2026-10-27T10:00:00Z").toEpochMilli()
    private fun sample(t: Long, pos: Long = t, playing: Boolean = true, song: Track = track) = Sample(song, playing, pos, t, start + t)
    @Test fun creditsNormalProgressAndPauseButNotPausedTime() {
        val tracker = HistoryTracker()
        tracker.observe(sample(0))
        tracker.observe(sample(20000))
        tracker.observe(sample(30000, playing = false))
        tracker.observe(sample(50000, pos = 30000, playing = false))
        assertEquals(30000L, tracker.active!!.listenedMs)
        assertEquals(30000L, tracker.active!!.days.values.sum())
    }
    @Test fun seekingDoesNotCountAsListening() {
        val tracker = HistoryTracker()
        tracker.observe(sample(0))
        tracker.observe(sample(20000, pos = 100000))
        assertEquals(0L, tracker.active!!.listenedMs)
        tracker.observe(sample(40000, pos = 120000))
        assertEquals(20000L, tracker.active!!.listenedMs)
    }
    @Test fun processRestartReusesEventWithoutCreditingGap() {
        val before = HistoryTracker()
        before.observe(sample(0))
        before.observe(sample(20000))
        val after = HistoryTracker(before.active!!.snapshot())
        after.observe(sample(40000))
        assertEquals(before.active!!.id, after.active!!.id)
        assertEquals(20000L, after.active!!.listenedMs)
        after.observe(sample(60000))
        assertEquals(40000L, after.active!!.listenedMs)
    }
    @Test fun suspendedIntervalsEarnNoCredit() {
        val tracker = HistoryTracker()
        tracker.observe(sample(0))
        tracker.observe(sample(120000))
        assertEquals(0L, tracker.active!!.listenedMs)
    }
    @Test fun repeatOneGetsNewEventAndFinishesOldTail() {
        val tracker = HistoryTracker()
        tracker.observe(sample(0, pos = 250000))
        val id = tracker.active!!.id
        val updates = tracker.observe(sample(10000, pos = 2000))
        assertNotEquals(id, tracker.active!!.id)
        assertEquals(8000L, updates.first().listenedMs)
        assertEquals(0L, tracker.active!!.listenedMs)
    }
    @Test fun utcMidnightSplitsExactDayTotals() {
        val tracker = HistoryTracker()
        val midnight = Instant.parse("2026-10-28T00:00:00Z").toEpochMilli()
        tracker.observe(Sample(track, true, 0, 0, midnight - 10000))
        tracker.observe(Sample(track, true, 20000, 20000, midnight + 10000))
        assertEquals(mapOf("2026-10-27" to 10000L, "2026-10-28" to 10000L), tracker.active!!.days)
    }
    @Test fun clockMovingBackwardsDoesNotCorruptCumulativeEvent() {
        val tracker = HistoryTracker()
        tracker.observe(sample(0))
        tracker.observe(sample(20000))
        tracker.observe(Sample(track, true, 40000, 40000, start - 10000))
        assertEquals(start + 20000, tracker.active!!.updatedAt)
        assertEquals(20000L, tracker.active!!.listenedMs)
    }
    @Test fun trackChangeDoesNotInventListeningToNewSong() {
        val tracker = HistoryTracker()
        tracker.observe(sample(0, pos = 10000))
        val changed = tracker.observe(sample(10000, 0, song = track.copy(title = "Other")))
        assertEquals(0L, changed.first().listenedMs)
        assertEquals(0L, tracker.active!!.listenedMs)
    }
    @Test fun doubleSpeedCountsElapsedTime() {
        val tracker = HistoryTracker()
        tracker.observe(sample(0).copy(speed = 2f))
        tracker.observe(sample(20000, 40000).copy(speed = 2f))
        assertEquals(20000L, tracker.active!!.listenedMs)
    }
    @Test fun repeatDetectedAcrossTwentySecondHeartbeat() {
        val tracker = HistoryTracker()
        tracker.observe(sample(0, pos = 240000))
        val old = tracker.active!!.id
        tracker.observe(sample(20000, pos = 2000))
        assertNotEquals(old, tracker.active!!.id)
    }
    @Test fun pausedEndThenReplayCreatesANewListen() {
        val tracker = HistoryTracker()
        tracker.observe(sample(0, pos = 257900, playing = false))
        val old = tracker.active!!.id
        tracker.observe(sample(5000, pos = 0))
        assertNotEquals(old, tracker.active!!.id)
    }
    @Test fun longPauseThenSameTrackStartsNewSession() {
        val tracker = HistoryTracker()
        tracker.observe(sample(0, pos = 20000, playing = false))
        val old = tracker.active!!.id
        tracker.observe(sample(3600000, pos = 20000))
        assertNotEquals(old, tracker.active!!.id)
    }
    @Test fun delayedPauseAssignsTimeBeforeActualStopAcrossMidnight() {
        val tracker = HistoryTracker()
        val midnight = Instant.parse("2026-10-28T00:00:00Z").toEpochMilli()
        tracker.observe(Sample(track, true, 0, 0, midnight - 10000))
        tracker.observe(Sample(track, false, 5000, 20000, midnight + 10000))
        assertEquals(mapOf("2026-10-27" to 5000L), tracker.active!!.days)
    }
    @Test fun invalidMetadataIgnored() {
        val tracker = HistoryTracker()
        assertTrue(tracker.observe(sample(0, song = track.copy(durationMs = 0))).isEmpty())
        assertNull(tracker.active)
    }
}
