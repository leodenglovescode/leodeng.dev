package dev.leodeng.listening

import android.content.Context
import android.database.sqlite.SQLiteFullException
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.SQLiteMode
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class HistoryStoreTest {
    private lateinit var context: Context
    private lateinit var store: HistoryStore
    private val start = 1793008800000L
    private fun event(index: Int, longNames: Boolean = false): Listen {
        val name = if (longNames) "音".repeat(480) else "A song"
        return Listen("%032x".format(index), Track(name, "An artist", name, 200000), start + index, start + index + 40000,
            40000, sortedMapOf("2026-10-26" to 40000L))
    }
    @Before fun open() {
        context = RuntimeEnvironment.getApplication()
        context.deleteDatabase("history.db")
        store = HistoryStore(context)
    }
    @After fun close() { store.close(); context.deleteDatabase("history.db") }
    @Test fun olderAcknowledgementCannotDeleteNewerObservation() {
        val event = event(1)
        store.save(listOf(event), event)
        val sent = store.batch()
        val newer = event.copy(updatedAt = event.updatedAt + 1000, listenedMs = 41000, days = sortedMapOf("2026-10-26" to 41000L))
        store.save(listOf(newer), newer)
        store.acknowledge(sent)
        assertEquals(1, store.counts().first)
        assertEquals(41000L, decodeListen(store.batch().single().payload).listenedMs)
        store.acknowledge(store.batch())
        assertEquals(0, store.counts().first)
        assertEquals(41000L, store.restore()!!.listenedMs)
    }
    @Test fun queueSurvivesDatabaseReopening() {
        val event = event(2)
        store.save(listOf(event), event)
        store.close()
        store = HistoryStore(context)
        assertEquals(event, store.restore())
        assertEquals(event.id, store.batch().single().id)
    }
    @Test fun largeOfflineBacklogIsPrunedAndFilesStayBelowFiveMiB() {
        repeat(1600) { i ->
            val event = event(i, longNames = i % 2 == 0)
            store.save(listOf(event), event)
            if (i % 100 == 0) assertBudget()
        }
        val (count, dropped) = store.counts()
        assertTrue(count in 1..HistoryStore.MAX_ROWS)
        assertEquals(1600L, count + dropped)
        assertTrue(dropped > 0)
        assertEquals(event(1599).id, store.restore()!!.id)
        assertBudget()
        assertEquals("delete", store.readableDatabase.rawQuery("PRAGMA journal_mode", null).use { it.moveToFirst(); it.getString(0) })
        assertTrue(store.readableDatabase.maximumSize <= HistoryStore.MAX_DB_BYTES)
        val db = store.writableDatabase
        db.beginTransaction()
        try { db.execSQL("UPDATE pending SET version=version+1"); assertTrue(context.getDatabasePath("history.db-journal").length() > 0); assertBudget() } finally { db.endTransaction() }
    }
    @Test fun sqliteRejectsAllocationBeyondTheHardPageLimit() {
        val event = event(3)
        store.save(listOf(event), event)
        assertThrows(SQLiteFullException::class.java) {
            store.writableDatabase.execSQL("INSERT INTO pending VALUES ('oversized',1,zeroblob(3145728),3145728,0)")
        }
        assertEquals(1, store.counts().first)
        assertBudget()
    }
    @Test fun serializedEventFixtureUsesServerProtocol() {
        val event = event(4)
        store.save(listOf(event), event)
        val payload = store.batch().single().payload
        assertEquals(event, decodeListen(payload))
        File("build/test-fixtures").mkdirs()
        File("build/test-fixtures/listen.json").writeText(payload)
    }
    private fun assertBudget() {
        val total = listOf("history.db", "history.db-journal", "history.db-wal", "history.db-shm").sumOf { context.getDatabasePath(it).length() }
        assertTrue("History files are $total bytes", total <= 5L * 1024 * 1024)
        assertTrue(context.getDatabasePath("history.db").length() in 1..HistoryStore.MAX_DB_BYTES)
    }
}
