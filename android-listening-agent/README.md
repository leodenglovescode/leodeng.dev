# Listening for Android

A small native Kotlin companion for Apple Music. One media-session observer feeds both website now-playing updates and a durable listening-history queue. Requires Android 9 or later and user-enabled notification access. Only Apple Music's media session is observed; notification text is not collected.

No Compose, WebView, analytics SDK, foreground playback service or wake lock. The app uses platform views, SQLite, JobScheduler, MediaSessionManager and Android Keystore. There are no third-party runtime dependencies.

## Behavior

- Playback callbacks handle track changes, seeks and pauses. A 20-second heartbeat runs only during playback, providing progress observations and keeping the website's 30-second now-playing expiry alive. Android can defer background work and networking while asleep; this is best effort, not a timing guarantee.
- Listening time requires plausible position progress and monotonic elapsed time. Seeks, long observation gaps and process restarts do not fabricate listening time. Day buckets use UTC.
- Listening history is cumulative and idempotent. Uploads are batched, and acknowledgements remove only the exact queued version sent. Newer observations survive an older in-flight acknowledgement.
- Unsent history stays on disk when the private server cannot be reached. Network availability and persisted, constrained Android jobs provide retries with backoff. Successful history is removed from the phone; the receiving server remains the archive.
- Now-playing is latest-only and never replays an offline backlog. Pausing stops heartbeats; the website card expires within 30 seconds. The app does not delete the shared card, which could belong to another device.
- Artwork uses the bitmap supplied by Apple Music, scaled to at most 512 pixels and 512 KiB of JPEG data. Only one cover is retained in memory; no image files are cached. A bounded hash cache avoids redundant uploads during a process lifetime.

## Storage limits

The history database has a **2 MiB SQLite page limit** with DELETE journaling, leaving space for a temporary rollback journal under a **5 MiB combined history-storage budget**. WAL is disabled. A 768 KiB logical queue budget and a 1,000-event limit trigger oldest-first pruning before that hard limit. The active event is protected. A persistent dropped-event counter is visible in the app. This tradeoff deliberately sacrifices the oldest unsynced history after a sufficiently long outage to preserve bounded storage.

The 5 MiB budget covers listening data and its SQLite journal, not the installed APK or Android's code cache. The app does not keep logs or artwork on disk. A storage cap does not itself prevent a memory leak; bounded batches, one cover, one network worker, and explicit callback cleanup bound the main retained data structures.

## Security

Destination credentials are entered on the phone and encrypted using an Android Keystore AES-GCM key. App backups and device-transfer backups are disabled, credential fields are excluded from autofill, and screenshots of the configuration screen are disabled. Tokens and server responses are not logged. HTTPS uses system certificate verification. Cleartext HTTP is accepted only for literal private IPv4 addresses, including the Tailscale CGNAT range. It should be used only on a trusted private network or encrypted VPN. HTTP redirects are refused.

## Build

Use JDK 17 or newer, Android SDK platform 36 and build tools 36.1.0. Set `ANDROID_HOME` to the SDK directory or use an untracked `local.properties` file. The project uses AGP 9.3.1 with built-in Kotlin and Gradle 9.5.1.

```sh
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

The installable development APK is produced in `app/build/outputs/apk/debug/`. Debug signing is for local testing. Release builds are unsigned; signing keys and local configuration must never be added to Git.

Real-device testing is required to measure battery use and confirm the metadata and session behavior of the installed Apple Music version. This app cannot observe playback on another device or recover listening that happened while Android stopped its observer.
