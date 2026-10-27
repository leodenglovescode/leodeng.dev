package dev.leodeng.listening

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings as AndroidSettings
import android.service.notification.NotificationListenerService
import android.text.InputFilter
import android.text.InputType
import android.view.View
import android.view.WindowManager
import android.widget.*
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private val app get() = application as ListeningApp
    private val handler = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private lateinit var status: TextView
    private lateinit var queue: TextView
    private lateinit var enabled: Switch
    private lateinit var website: EditText
    private lateinit var nowToken: EditText
    private lateinit var server: EditText
    private lateinit var historyToken: EditText
    private lateinit var message: TextView
    private var loaded = Config()
    private var active = false
    private val update = object : Runnable {
        override fun run() {
            if (!active) return
            status.text = "${if (app.listenerConnected) "CONNECTED" else "ACCESS NEEDED"}\n\n${app.currentTitle}\n${app.currentDetail}\n\nNow playing: ${app.nowStatus}\nHistory: ${app.historyStatus}"
            io.execute {
                val text = runCatching {
                    val (count, dropped) = app.store.counts()
                    val bytes = listOf("history.db", "history.db-journal", "history.db-wal", "history.db-shm").sumOf { getDatabasePath(it).length() }
                    "$count pending listens  ·  ${"%.2f".format(bytes / 1048576.0)} MiB / 5 MiB\n$dropped oldest listens dropped at the storage limit\n${app.storageStatus}"
                }.getOrElse { "Could not read local storage." }
                handler.post { if (active) queue.text = text }
            }
            handler.postDelayed(this, 2000)
        }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        val scroll = ScrollView(this)
        val body = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(24), dp(32), dp(24), dp(32)) }
        scroll.addView(body)
        scroll.setOnApplyWindowInsetsListener { view, insets ->
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                val bars = insets.getInsets(android.view.WindowInsets.Type.systemBars())
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            } else {
                @Suppress("DEPRECATION")
                view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }
        fun text(value: String, size: Float = 15f): TextView = TextView(this).apply { text = value; textSize = size; setTextColor(Color.rgb(216, 224, 238)); setPadding(0, dp(8), 0, dp(8)); body.addView(this) }
        text("LISTENING", 13f).apply { setTextColor(Color.rgb(128, 181, 255)); letterSpacing = .18f }
        text("Your music, in sync.", 30f).setTypeface(null, Typeface.BOLD)
        text("Apple Music to your homepage and listening stats. No microphone, location or playback controls.")
        status = text("Checking playback access...")
        status.background = GradientDrawable().apply { setColor(Color.rgb(26, 35, 49)); cornerRadius = dp(16).toFloat() }
        status.setPadding(dp(16), dp(16), dp(16), dp(16))
        queue = text("Reading local queue...", 13f)
        button(body, "Enable playback access") {
            startActivity(Intent(AndroidSettings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }
        button(body, "Sync queued listens now") {
            app.sync.history(true)
            app.refreshObserver?.invoke()
            NotificationListenerService.requestRebind(ComponentName(this, MusicListener::class.java))
        }
        text("Connection settings", 22f).setTypeface(null, Typeface.BOLD)
        text("Leave a token blank to disable that destination. Saved tokens stay encrypted on this phone. A blank token field keeps the saved token.", 13f)
        enabled = Switch(this).apply { text = "Track Apple Music"; body.addView(this) }
        fun input(label: String, hint: String, secret: Boolean = false): EditText {
            text(label, 13f)
            return EditText(this).apply {
                this.hint = hint; isSingleLine = true
                inputType = if (secret) InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD else InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
                importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
                filters = arrayOf(InputFilter.LengthFilter(if (secret) 1024 else 2048))
                body.addView(this, LinearLayout.LayoutParams(-1, dp(52)))
            }
        }
        website = input("Website origin", "https://your.site")
        nowToken = input("Now-playing token", "Not configured", true)
        server = input("History server origin", "http://private-ip:port")
        historyToken = input("Listening history token", "Not configured", true)
        message = text("", 13f)
        button(body, "Save connections") {
            val candidate = Config(enabled.isChecked, website.text.toString(), nowToken.text.toString().ifBlank { loaded.nowToken },
                server.text.toString(), historyToken.text.toString().ifBlank { loaded.historyToken })
            io.execute {
                val result = runCatching { app.settings.save(candidate); app.config() }
                handler.post {
                    if (isDestroyed) return@post
                    result.onSuccess {
                        loaded = it; nowToken.text.clear(); historyToken.text.clear(); tokenHints()
                        message.text = "Saved. Changes apply to the next playback update."
                        app.refreshObserver?.invoke()
                        NotificationListenerService.requestRebind(ComponentName(this, MusicListener::class.java))
                        app.sync.history(true)
                    }.onFailure { message.text = it.message ?: "Could not save settings." }
                }
            }
        }
        button(body, "Remove saved tokens") {
            android.app.AlertDialog.Builder(this).setMessage("Remove both destination tokens and stop tracking? Queued listens will stay on this phone.")
                .setNegativeButton("Cancel", null).setPositiveButton("Remove") { _, _ ->
                    io.execute {
                        val result = runCatching { app.settings.save(loaded.copy(enabled = false, nowToken = "", historyToken = "")); app.config() }
                        handler.post { if (!isDestroyed) result.onSuccess { loaded = it; enabled.isChecked = false; nowToken.text.clear(); historyToken.text.clear(); tokenHints(); app.refreshObserver?.invoke(); message.text = "Tokens removed." }.onFailure { message.text = "Could not remove tokens." } }
                    }
                }.show()
        }
        text("Local storage stays below 5 MiB including the history journal. Synced listens are removed; oldest pending listens are dropped only if the queue fills. Covers use one small in-memory image and no disk cache.\n\nPlayback callbacks and a 20-second heartbeat run only while music is playing. Android may defer background network access during sleep. Pausing stops updates; the homepage card expires within 30 seconds.", 13f)
        setContentView(scroll)
        io.execute {
            val config = app.config()
            handler.post {
                if (!isDestroyed) { loaded = config; enabled.isChecked = config.enabled; website.setText(config.website); server.setText(config.historyOrigin); tokenHints(); message.text = app.configError }
            }
        }
    }
    private fun tokenHints() {
        nowToken.hint = if (loaded.nowToken.isBlank()) "Not configured" else "Saved securely"
        historyToken.hint = if (loaded.historyToken.isBlank()) "Not configured" else "Saved securely"
    }
    private fun button(body: LinearLayout, title: String, action: () -> Unit) {
        body.addView(Button(this).apply { text = title; isAllCaps = false; setOnClickListener { action() } })
    }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    override fun onResume() { super.onResume(); active = true; handler.post(update) }
    override fun onPause() { active = false; handler.removeCallbacks(update); super.onPause() }
    override fun onDestroy() { handler.removeCallbacksAndMessages(null); io.shutdown(); super.onDestroy() }
}
