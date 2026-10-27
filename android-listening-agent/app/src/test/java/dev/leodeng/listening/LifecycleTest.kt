package dev.leodeng.listening

import android.content.Context
import android.media.session.MediaSession
import android.media.session.MediaSessionManager
import android.os.Handler
import android.view.WindowManager
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.util.ReflectionHelpers

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class LifecycleTest {
    @Test fun startsWithoutCredentialsAndProtectsConfigurationScreen() {
        val activity = Robolectric.buildActivity(MainActivity::class.java).setup()
        try {
            assertTrue(activity.get().window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0)
            assertNotNull(activity.get().findViewById<android.view.View>(android.R.id.content))
        } finally { activity.pause().stop().destroy() }
    }
    @Test fun subscribesOnlyToAppleMusicAndReleasesCallbacksOnDestroy() {
        val context: Context = RuntimeEnvironment.getApplication()
        val manager = context.getSystemService(MediaSessionManager::class.java)
        val apple = MediaSession(context, "apple-test")
        val other = MediaSession(context, "other-test")
        shadowOf(apple.controller).setPackageName("com.apple.android.music")
        shadowOf(other.controller).setPackageName("example.other.player")
        shadowOf(manager).addController(other.controller)
        shadowOf(manager).addController(apple.controller)
        val service = Robolectric.buildService(MusicListener::class.java).create()
        val worker = ReflectionHelpers.getField<Handler>(service.get(), "handler")
        try {
            service.get().onListenerConnected()
            shadowOf(worker.looper).idle()
            assertEquals(1, shadowOf(apple.controller).callbacks.size)
            assertEquals(0, shadowOf(other.controller).callbacks.size)
            assertTrue((context as ListeningApp).listenerConnected)
        } finally {
            service.destroy()
            shadowOf(worker.looper).idle()
            apple.release(); other.release()
        }
        assertEquals(0, shadowOf(apple.controller).callbacks.size)
        assertFalse((context as ListeningApp).listenerConnected)
        assertNull(context.refreshObserver)
    }
}
