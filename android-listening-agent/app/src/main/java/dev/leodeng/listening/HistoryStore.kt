package dev.leodeng.listening

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/** 2 MiB database + at most one bounded rollback journal, comfortably below 5 MiB.
 * DELETE journaling avoids WAL growth. The soft budget leaves room for indexes and fragmentation.
 * No artwork, HTTP bodies or logs are written here.
 */
class HistoryStore(context: Context) : SQLiteOpenHelper(context, "history.db", null, 1) {
    companion object {
        const val MAX_DB_BYTES = 2L * 1024 * 1024
        const val SOFT_BYTES = 768 * 1024
        const val MAX_ROWS = 1000
    }
    data class Pending(val id: String, val version: Long, val payload: String)
    init {
        setOpenParams(SQLiteDatabase.OpenParams.Builder().setJournalMode("DELETE").setSynchronousMode("FULL").build())
        setWriteAheadLoggingEnabled(false)
    }
    override fun onConfigure(db: SQLiteDatabase) {
        db.rawQuery("PRAGMA journal_mode=DELETE", null).use { check(it.moveToFirst() && it.getString(0) == "delete") }
        db.rawQuery("PRAGMA journal_size_limit=0", null).use { it.moveToFirst() }
        db.setMaximumSize(MAX_DB_BYTES)
    }
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE pending(id TEXT PRIMARY KEY, version INTEGER NOT NULL, payload TEXT NOT NULL, size INTEGER NOT NULL, created INTEGER NOT NULL)")
        db.execSQL("CREATE TABLE state(id INTEGER PRIMARY KEY CHECK(id=1), active TEXT)")
        db.execSQL("CREATE TABLE totals(id INTEGER PRIMARY KEY CHECK(id=1), dropped INTEGER NOT NULL)")
        db.execSQL("INSERT INTO totals VALUES(1,0)")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit
    @Synchronized fun restore(): Listen? = readableDatabase.rawQuery("SELECT active FROM state WHERE id=1", null).use {
        if (it.moveToFirst() && !it.isNull(0)) runCatching { decodeListen(it.getString(0)) }.getOrNull() else null
    }
    @Synchronized fun save(updates: List<Listen>, active: Listen?) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            for (event in updates) {
                val payload = event.json().toString()
                val cost = payload.toByteArray(Charsets.UTF_8).size + 512
                require(cost < 32_768)
                val oldVersion = db.rawQuery("SELECT version FROM pending WHERE id=?", arrayOf(event.id)).use { if (it.moveToFirst()) it.getLong(0) else 0L }
                // Deleting a superseded row frees its pages before the replacement allocation.
                db.delete("pending", "id=?", arrayOf(event.id))
                trim(db, cost, active?.id)
                val values = ContentValues().apply {
                    put("id", event.id); put("version", maxOf(oldVersion + 1, System.nanoTime()))
                    put("payload", payload); put("size", cost); put("created", event.startedAt)
                }
                db.insertOrThrow("pending", null, values)
            }
            db.insertWithOnConflict("state", null, ContentValues().apply { put("id", 1); put("active", active?.json()?.toString()) }, SQLiteDatabase.CONFLICT_REPLACE)
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
    private fun trim(db: SQLiteDatabase, extra: Int, protectedId: String?) {
        while (true) {
            val within = db.rawQuery("SELECT COUNT(*),COALESCE(SUM(size),0) FROM pending", null).use {
                it.moveToFirst(); it.getInt(0) < MAX_ROWS && it.getLong(1) + extra <= SOFT_BYTES
            }
            if (within) return
            val oldest = db.rawQuery("SELECT id FROM pending WHERE id!=? ORDER BY created,id LIMIT 1", arrayOf(protectedId ?: "")).use {
                if (it.moveToFirst()) it.getString(0) else return
            }
            db.delete("pending", "id=?", arrayOf(oldest))
            db.execSQL("UPDATE totals SET dropped=dropped+1 WHERE id=1")
        }
    }
    @Synchronized fun batch(): List<Pending> {
        val result = mutableListOf<Pending>()
        var bytes = 32
        readableDatabase.rawQuery("SELECT id,version,payload FROM pending ORDER BY created,id LIMIT 100", null).use {
            while (it.moveToNext()) {
                val p = Pending(it.getString(0), it.getLong(1), it.getString(2))
                bytes += p.payload.toByteArray(Charsets.UTF_8).size + 1
                if (bytes > 270_000) break
                result += p
            }
        }
        return result
    }
    @Synchronized fun acknowledge(batch: List<Pending>) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            batch.forEach { db.delete("pending", "id=? AND version=?", arrayOf(it.id, it.version.toString())) }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
    @Synchronized fun counts(): Pair<Int, Long> {
        val count = readableDatabase.rawQuery("SELECT COUNT(*) FROM pending", null).use { it.moveToFirst(); it.getInt(0) }
        val dropped = readableDatabase.rawQuery("SELECT dropped FROM totals WHERE id=1", null).use { it.moveToFirst(); it.getLong(0) }
        return count to dropped
    }
}
