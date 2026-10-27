package dev.leodeng.listening

import android.content.ComponentName
import android.graphics.Bitmap
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.net.ConnectivityManager
import android.net.Network
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import java.io.ByteArrayOutputStream

class MusicListener : NotificationListenerService() {
    private lateinit var thread: HandlerThread
    private lateinit var handler: Handler
    private val app get() = application as ListeningApp
    private val sessions by lazy { getSystemService(MediaSessionManager::class.java) }
    private var controller: MediaController? = null
    private var tracker: HistoryTracker? = null
    private var artwork: ByteArray? = null
    private var artworkTrack: String? = null
    private var artworkBitmap: Bitmap? = null
    private var connected = false
    private var networkRegistered = false
    private var wasEnabled = false
    private val changed = MediaSessionManager.OnActiveSessionsChangedListener { attach(it.orEmpty()) }
    private val callback = object : MediaController.Callback() {
        override fun onMetadataChanged(metadata: MediaMetadata?) = refreshSoon()
        override fun onPlaybackStateChanged(state: PlaybackState?) = refreshSoon()
        override fun onSessionDestroyed() { attach(emptyList()); discover() }
    }
    private val refresh = Runnable { observe() }
    private val heartbeat = Runnable { observe() }
    private val wakeObserver: () -> Unit = { if (::handler.isInitialized) handler.post { discover(); observe() } }
    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            handler.post { if (connected) { app.sync.history(); refreshSoon() } }
        }
    }
    override fun onCreate() {
        super.onCreate()
        thread = HandlerThread("AppleMusicObserver").apply { start() }
        handler = Handler(thread.looper)
    }
    override fun onListenerConnected() {
        super.onListenerConnected()
        handler.post {
            if (connected) return@post
            connected = true
            app.listenerConnected = true
            app.refreshObserver = wakeObserver
            tracker = HistoryTracker(app.store.restore())
            sessions.addOnActiveSessionsChangedListener(changed, ComponentName(this, MusicListener::class.java), handler)
            getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(networkCallback)
            networkRegistered = true
            discover()
            app.scheduleHistory()
        }
    }
    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn?.packageName == "com.apple.android.music") handler.post { if (connected && controller == null) discover() }
    }
    override fun onListenerDisconnected() {
        handler.post { detachAll() }
        super.onListenerDisconnected()
        // The OS owns reconnection; no polling loop or permanent foreground service.
        requestRebind(ComponentName(this, MusicListener::class.java))
    }
    private fun discover() {
        if (!connected) return
        try { attach(sessions.getActiveSessions(ComponentName(this, MusicListener::class.java))) }
        catch (_: SecurityException) { app.listenerConnected = false }
    }
    private fun attach(all: List<MediaController>) {
        val apple = all.filter { it.packageName == "com.apple.android.music" }
        val next = apple.firstOrNull { it.playbackState?.state == PlaybackState.STATE_PLAYING } ?: apple.firstOrNull()
        if (controller?.sessionToken == next?.sessionToken) return
        controller?.unregisterCallback(callback)
        controller = next
        tracker?.disconnect()
        clearArt()
        handler.removeCallbacks(heartbeat)
        next?.registerCallback(callback, handler)
        if (next == null) {
            app.currentTitle = "Waiting for Apple Music"
            app.currentDetail = "No active Apple Music session."
            app.sync.publish(null, null)
            app.sync.history()
        } else refreshSoon()
    }
    private fun refreshSoon() {
        handler.removeCallbacks(refresh)
        handler.postDelayed(refresh, 250)
    }
    private fun observe() {
        handler.removeCallbacks(heartbeat)
        if (!connected) return
        try {
            val c = app.config()
            if (!c.enabled) {
                if (wasEnabled) tracker?.disconnect()
                wasEnabled = false
                clearArt()
                app.currentDetail = "Tracking is switched off."
                app.sync.publish(null, null)
                return
            }
            wasEnabled = true
            val session = controller ?: return
            val metadata = session.metadata ?: return
            val state = session.playbackState ?: return
            val track = Track(metadata.getString(MediaMetadata.METADATA_KEY_TITLE).orEmpty().take(500),
                (metadata.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: metadata.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST)).orEmpty().take(500),
                metadata.getString(MediaMetadata.METADATA_KEY_ALBUM).orEmpty().take(500), metadata.getLong(MediaMetadata.METADATA_KEY_DURATION))
            if (!track.valid()) { app.currentDetail = "Waiting for complete track details."; return }
            val playing = state.state == PlaybackState.STATE_PLAYING
            val clock = SystemClock.elapsedRealtime()
            val speed = state.playbackSpeed.takeIf { it.isFinite() && it > 0 } ?: 1f
            val advance = if (playing && state.lastPositionUpdateTime in 1..clock) ((clock - state.lastPositionUpdateTime) * speed).toLong() else 0
            val sample = Sample(track, playing, (state.position + advance).coerceIn(0, track.durationMs), clock, System.currentTimeMillis(), speed)
            val history = tracker ?: HistoryTracker().also { tracker = it }
            if (c.historyToken.isNotBlank()) {
                try {
                    val updates = history.observe(sample)
                    app.store.save(updates, history.active)
                    app.storageStatus = ""
                    app.scheduleHistory()
                    app.sync.history()
                } catch (_: android.database.sqlite.SQLiteException) {
                    app.storageStatus = "Could not save this observation. Existing queued listens are retained."
                    history.disconnect()
                }
            } else history.reset()
            app.currentTitle = track.title
            app.currentDetail = "${track.artist}\n${track.album}\n${if (playing) "Playing" else "Paused"}"
            if (c.nowToken.isNotBlank()) {
                updateArt(metadata, track)
                app.sync.publish(sample, artwork)
            } else app.sync.publish(null, null)
            if (playing) handler.postDelayed(heartbeat, 20_000)
        } catch (_: Exception) {
            app.currentDetail = "Playback details temporarily unavailable."
            tracker?.disconnect()
            if (controller?.playbackState?.state == PlaybackState.STATE_PLAYING) handler.postDelayed(heartbeat, 20_000)
        }
    }
    private fun updateArt(metadata: MediaMetadata, track: Track) {
        val bitmap = metadata.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART) ?: metadata.getBitmap(MediaMetadata.METADATA_KEY_ART)
        if (artworkTrack == track.key && artworkBitmap === bitmap) return
        artworkTrack = track.key
        artworkBitmap = bitmap
        artwork = null
        if (bitmap == null || bitmap.isRecycled) return
        val scale = minOf(1.0, 512.0 / maxOf(bitmap.width, bitmap.height))
        val small = Bitmap.createScaledBitmap(bitmap, maxOf(1, (bitmap.width * scale).toInt()), maxOf(1, (bitmap.height * scale).toInt()), true)
        try {
            val out = ByteArrayOutputStream()
            small.compress(Bitmap.CompressFormat.JPEG, 85, out)
            if (out.size() <= 512 * 1024) artwork = out.toByteArray()
        } finally { if (small !== bitmap) small.recycle() }
    }
    private fun clearArt() { artwork = null; artworkBitmap = null; artworkTrack = null }
    private fun detachAll() {
        connected = false
        app.listenerConnected = false
        if (app.refreshObserver === wakeObserver) app.refreshObserver = null
        handler.removeCallbacksAndMessages(null)
        controller?.unregisterCallback(callback)
        controller = null
        sessions.removeOnActiveSessionsChangedListener(changed)
        if (networkRegistered) getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(networkCallback)
        networkRegistered = false
        tracker?.disconnect()
        clearArt()
        app.sync.publish(null, null)
        app.scheduleHistory()
    }
    override fun onDestroy() {
        handler.post { detachAll(); thread.quitSafely() }
        super.onDestroy()
    }
}
