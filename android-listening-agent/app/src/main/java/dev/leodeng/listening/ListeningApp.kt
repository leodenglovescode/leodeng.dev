package dev.leodeng.listening

import android.app.Application
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class ListeningApp : Application() {
    val store by lazy { HistoryStore(this) }
    val settings by lazy { Settings(this) }
    val sync by lazy { SyncEngine(this) }
    @Volatile var listenerConnected = false
    @Volatile var currentTitle = "Waiting for Apple Music"
    @Volatile var currentDetail = "Play a song to begin."
    @Volatile var nowStatus = "Not published yet"
    @Volatile var historyStatus = "No upload yet"
    @Volatile var storageStatus = ""
    @Volatile var configError = ""
    @Volatile var refreshObserver: (() -> Unit)? = null
    fun config(): Config = try { settings.load().also { configError = "" } } catch (_: Exception) {
        configError = "Saved credentials could not be unlocked. Save them again."
        Config()
    }
    fun scheduleHistory() {
        val c = config()
        if (!c.enabled || c.historyToken.isBlank() || store.counts().first == 0) return
        val scheduler = getSystemService(JobScheduler::class.java)
        if (scheduler.getPendingJob(7401) != null) return
        scheduler.schedule(JobInfo.Builder(7401, ComponentName(this, HistorySyncJob::class.java))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setMinimumLatency(60_000)
            .setBackoffCriteria(30_000, JobInfo.BACKOFF_POLICY_EXPONENTIAL).setPersisted(true).build())
    }
}

/** A single network worker bounds heap and prevents overlapping uploads. Current playback is latest-only. */
class SyncEngine(private val app: ListeningApp) {
    private val executor = Executors.newSingleThreadScheduledExecutor()
    private val http = Transport()
    private val historyRunning = AtomicBoolean(false)
    private val nowRunning = AtomicBoolean(false)
    @Volatile private var latest: Publication? = null
    private var lastHistoryAttempt = Long.MIN_VALUE / 2
    private var lastNowAttempt = Long.MIN_VALUE / 2
    private var nextNowAttempt = 0L
    private var nextHistoryAttempt = 0L
    private var historyFailures = 0
    private val uploadedArt = LinkedHashMap<String, String>()
    data class Publication(val sample: Sample, val art: ByteArray?, val at: Long, val key: String)
    private val deviceId: String by lazy {
        val prefs = app.getSharedPreferences("device", Context.MODE_PRIVATE)
        prefs.getString("id", null) ?: java.util.UUID.randomUUID().toString().also { prefs.edit().putString("id", it).apply() }
    }

    fun publish(sample: Sample?, art: ByteArray?) {
        latest = sample?.takeIf { it.playing }?.let { Publication(it, art, SystemClock.elapsedRealtime(), "android:$deviceId:${it.track.key}") }
        // Stop renewing on pause; the shared card expires within 30 seconds. Never erase another device's playback.
        if (latest == null) { app.nowStatus = "Paused; card expires within 30 seconds"; return }
        scheduleNow(0)
    }
    private fun scheduleNow(delayMs: Long) {
        if (!nowRunning.compareAndSet(false, true)) return
        executor.schedule({
            var followupDelay: Long? = null
            var item: Publication? = null
            try {
                item = latest ?: return@schedule
                val c = app.config()
                val clock = SystemClock.elapsedRealtime()
                if (!c.enabled || c.nowToken.isBlank() || clock - item.at > 25_000) return@schedule
                val wait = maxOf(nextNowAttempt - clock, 1500 - (clock - lastNowAttempt))
                if (wait > 0) { followupDelay = wait; return@schedule }
                lastNowAttempt = clock
                val artHash = item.art?.let(::sha256)
                val cacheKey = "${c.website}:$artHash"
                val knownArt = uploadedArt[cacheKey]
                post(c, item, knownArt)
                if (item.art != null && knownArt == null && latest?.key == item.key) {
                    try {
                        val response = http.send(c.website, "/api/internal/now-playing/artwork/$artHash", c.nowToken, "PUT", item.art, "image/jpeg")
                        val key = JSONObject(response).optString("artworkKey")
                        check(key == "now-playing/artwork/$artHash.jpg") { "Invalid artwork response." }
                        uploadedArt[cacheKey] = key
                        while (uploadedArt.size > 24) uploadedArt.remove(uploadedArt.keys.first())
                        followupDelay = 1500
                    } catch (_: Exception) { app.nowStatus = "Live; cover upload will retry" }
                }
                nextNowAttempt = 0
            } catch (e: Exception) {
                app.nowStatus = if (e is HttpFailure) e.message!! else "Website unreachable. Will retry while playing."
                nextNowAttempt = SystemClock.elapsedRealtime() + 10_000
                followupDelay = 10_000
            } finally {
                nowRunning.set(false)
                // Coalesce changes that arrived during an upload; retain at most one scheduled task.
                if (latest != null && latest !== item) scheduleNow(1500)
                else followupDelay?.let { if (latest != null) scheduleNow(it) }
            }
        }, delayMs, java.util.concurrent.TimeUnit.MILLISECONDS)
    }
    private fun post(c: Config, p: Publication, artwork: String?) {
        if (latest !== p || !app.config().enabled) return
        val s = p.sample
        val advance = ((SystemClock.elapsedRealtime() - p.at) * s.speed).toLong()
        val body = JSONObject().put("trackKey", p.key).put("title", s.track.title).put("artist", s.track.artist)
            .put("album", s.track.album).put("durationMs", s.track.durationMs)
            .put("positionMs", (s.positionMs + advance).coerceIn(0, s.track.durationMs)).put("artworkKey", artwork ?: JSONObject.NULL)
        val response = http.send(c.website, "/api/internal/now-playing", c.nowToken, "POST", body.toString().toByteArray(), "application/json")
        check(JSONObject(response).optBoolean("ok")) { "Invalid playback response." }
        app.nowStatus = "Live on your website"
    }
    fun history(force: Boolean = false, complete: ((Boolean) -> Unit)? = null) {
        if (!historyRunning.compareAndSet(false, true)) { complete?.invoke(true); return }
        executor.execute {
            var retry = false
            try {
                val c = app.config()
                if (!c.enabled || c.historyToken.isBlank()) return@execute
                val now = SystemClock.elapsedRealtime()
                if (!force && (now - lastHistoryAttempt < 60_000 || now < nextHistoryAttempt)) { retry = app.store.counts().first > 0; return@execute }
                lastHistoryAttempt = now
                // Bound each run, including a long offline backlog.
                repeat(3) {
                    val batch = app.store.batch()
                    if (batch.isEmpty()) return@repeat
                    val payload = JSONObject().put("events", JSONArray(batch.map { JSONObject(it.payload) }))
                    val response = http.send(c.historyOrigin, "/v1/listens", c.historyToken, "POST", payload.toString().toByteArray(), "application/json", true)
                    check(JSONObject(response).optBoolean("ok")) { "Invalid history response." }
                    app.store.acknowledge(batch)
                    app.historyStatus = "Last synced ${java.text.DateFormat.getTimeInstance(java.text.DateFormat.SHORT).format(java.util.Date())}"
                }
                historyFailures = 0
                nextHistoryAttempt = 0
                retry = app.store.counts().first > 0
            } catch (e: Exception) {
                retry = true
                historyFailures = minOf(historyFailures + 1, 5)
                nextHistoryAttempt = SystemClock.elapsedRealtime() + minOf(900_000L, 60_000L shl (historyFailures - 1))
                app.historyStatus = if (e is HttpFailure) e.message!! else "SuperServer unreachable. Listens are queued."
            } finally {
                historyRunning.set(false)
                complete?.invoke(retry)
                if (complete == null && retry) app.scheduleHistory()
            }
        }
    }
}

class HistorySyncJob : JobService() {
    @Volatile private var generation = 0
    override fun onStartJob(params: JobParameters): Boolean {
        val run = ++generation
        val app = application as ListeningApp
        app.sync.history { retry -> android.os.Handler(mainLooper).post { if (generation == run) jobFinished(params, retry) } }
        return true
    }
    override fun onStopJob(params: JobParameters): Boolean { generation++; return true }
}
