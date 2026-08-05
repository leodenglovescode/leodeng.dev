---
title: "I Forked Tailscale's Android App So My Phone Could Find My Homelab"
date: 2026-08-05T23:57:00+08:00
description: "Every single thing that broke while building a custom Android client for my self-hosted VPN — a home address I refused to publish, a build that lied to me, a typo on my server that did nothing for weeks, and a bug that only appeared when I left the house."
---

Last time I wrote about getting Headscale running so my Mac, my PC and my phone could all reach my homelab and servers from anywhere. That post ended with everything working. This post is about the part where I looked at the working setup and went "yeah but I don't like one thing about it," and then spent weeks fixing that one thing.

Fair warning, this one gets deep. But every single problem in here cost me real time, so I'm writing all of them down.

Also, upfront: I used AI heavily for this. Reading logs, narrowing down causes, remembering API names I'd never heard of. I'll talk about where that actually helped and where it very much did not near the end.

## The one thing I didn't like

My home network gets a public IPv6 address, and it rotates. So for my phone to reach home, that address has to be *somewhere* my phone can look it up. The normal answer is dynamic DNS: point a hostname at your home IP, update it whenever it changes, done.

Except that means my home address is sitting in public DNS. Anyone who knows the hostname knows exactly where I live, network-wise, and can start knocking. I really didn't want that.

So I did something slightly cursed. My VPN control server's hostname resolves to a **private LAN address**. `192.168.x.x`. That's the only thing in public DNS. At home, it just works. Away from home, it obviously doesn't, the connection dies instantly.

The plan: when the connection dies, the app quietly asks a tiny endpoint of mine for the current public IPv6, and dials *that* instead. The endpoint sits behind a CDN, needs a secret header, and needs a client certificate. So the real address only ever gets handed to something that can prove it's me.

Which is a lovely plan except no VPN client on earth does that. So, fork.

## Part 1: making the official Android app do something it wasn't built for

I forked the open-source Tailscale Android client and called mine **Headlink**.

### Problem 1: I couldn't actually edit the code I needed to edit

The networking core isn't in the app's repo. It's a dependency, pinned by version, no local override, no vendored copy. So "just add an if statement in the dialer" was not available to me.

I ended up finding one function where the app *hands its own dialer to* the core, and swapping in a wrapped one. My entire hook into the networking stack is basically a single statement, and everything else is new files that don't touch upstream at all.

That sounds like a limitation but it turned out to be the best thing about the whole project. When I rebase onto a newer upstream, there's almost nothing to conflict.

### Problem 2: not accidentally destroying my own TLS

This was the part I was genuinely nervous about. If I'm substituting a different IP address, what stops the certificate check from breaking? Or worse, what stops me from "fixing" it by turning verification off, which is the classic way people end up with a VPN that isn't private at all?

The thing that saved me is where the substitution happens. DNS resolution and TLS setup happen *above* the dial function. My hook gets called at the very bottom, and all it does is return a socket. It never sees the hostname's role as an identity, it can't set the server name, it can't touch the certificate check. The hostname stays the hostname for SNI, for cert verification, and for the HTTP Host header. Only the physical destination changes.

I wrote a test whose entire job is to fail if that ever stops being true. If someone (me, in six months, tired) tries to make the hook "smarter", that test breaks.

### Problem 3: the app was sending logs to someone else's servers

Upstream ships with telemetry pointed at the vendor's log service, on by default. For an app whose entire reason to exist is hiding my home address, that's not okay.

I turned it off twice, on purpose:

1. The config flag that disables it.
2. A custom HTTP transport that fails every request without even opening a socket.

Two independent mechanisms, because the first one is *a setting*, and settings can get flipped. I also deleted the switch in the UI, because a toggle that can't change anything is worse than no toggle.

One detail I got wrong first and had to fix: my transport originally returned a fake "200 OK" to keep things quiet. Turns out the logging library **deletes its buffered lines once a POST succeeds.** So faking success would have been silently throwing away my own on-device logs, which are the only logs I have. It has to return an actual error.

### Problem 4: a DNS fallback that defeated the whole point

Upstream defaults to falling back to Google's public resolvers when the system DNS is being weird. Reasonable default for most people! Terrible default for an app built specifically to keep my home network's addressing private. Flipped to off.

### Problem 5: where do I put the secret

The endpoint needs a shared secret and a client certificate. Those cannot live in plain app preferences, that's just a file any rooted process can read.

So: everything gets encrypted with an AES-256-GCM key that lives in the Android hardware keystore, and only ever exists as ciphertext on disk. On top of that:

- The `toString()` of every config object prints `<redacted>`. Which sounds paranoid until you realize a crash log prints objects.
- Redirects on the lookup request are **refused**, not followed. Otherwise someone could redirect my request somewhere else and my secret goes with it.
- The discovered IPv6 address is **never logged**. It's the one value the entire project exists to protect. Logging it would be genuinely funny in a bad way.

### Problem 6: the failure that doesn't look like a failure

My lookup endpoint requires a client certificate, checked at the CDN edge. So I tested it with `curl` and got... nothing. Connection just closed. Exit code 52 or 56, sometimes a weird HTTP framing error. Never a status code, never a "403 forbidden," nothing that says "auth problem."

Here's why, and it's such a good detail: in TLS 1.3, the handshake **completes before** the server evaluates your client certificate. So from your side, the connection succeeded. Then it just dies. It looks exactly like a broken server, and nothing like being rejected.

I spent way too long assuming my endpoint was down.

### Problem 7: macOS `curl` is not the `curl` you think it is

Once I knew I needed a client cert, I passed one. It didn't work. `--cacert` did nothing either.

macOS ships `curl` built against Apple's TLS backend, which **doesn't accept a PEM cert/key pair** and ignores `--cacert` entirely. You have to hand it a PKCS#12 bundle. Once I did that, it worked first try, and I felt a bit robbed of the hour I'd just spent.

### Problem 8: the wrong port cost me an afternoon

My control server is on a non-standard port. Port 443 on that **same hostname** is a completely different service (an NVR), with its own unrelated self-signed certificate.

So I probed 443, got a garbage certificate, and concluded my VPN server was misconfigured. It was fine. I was knocking on a different door in the same building.

### Problem 9: Gradle refused to build, for a reason it wasn't going to tell me

My machine had a very new JDK. Gradle rejected it. Answer was just "install JDK 17 and point `JAVA_HOME` at it," but the error message did not lead there in any obvious way.

### Problem 10: the app had NO network at all, and it looked like a server problem

This is the single most misleading thing that happened in this whole project.

The app just couldn't reach anything. Not "slow," not "some requests fail." Zero network. I checked my server, my certs, my DNS, my code.

The actual cause: Android's battery optimisation. The app needs to be set to **Unrestricted**, and without it the system reports a blocked reason on every socket the app opens. It presents *identically* to your server being down.

If you're building anything network-heavy on Android, check this first, not last.

### Problem 11: a copy of my app I couldn't see

Release builds started failing to install with a signature mismatch, even after uninstalling the app. I uninstalled it again. Same error. There was no app on the phone. The error insisted there was.

Turns out `adb install` installs for **every user profile on the device**, but `adb uninstall` only removes it from the main one. My phone has a Private Space, which is a separate user, and every dev install had been quietly seeding a copy in there. Android keeps one signature per package for the whole device, so that invisible debug-signed copy was blocking every release-signed build.

You have to unlock the Private Space and uninstall for that user specifically. There is no way you're guessing that from the error message.

### Problem 12: the logs kept disappearing

Android's default log buffer is tiny, and the camera stack on my phone spams it constantly. My VPN logs were being evicted within seconds of appearing.

Bumping the buffer to 16MB fixed it. Should've done it on day one.

### Problem 13: I couldn't reproduce my own bug

I was launching the app from the command line to test connections, and nothing was happening. No dial attempts, no errors, no anything.

Because launching the app isn't connecting. The backend just sits in an idle state waiting for you to actually press the button. I had to physically tap it every time. Obvious in hindsight, extremely annoying at the time.

## Part 2: the plot twist

So Headlink worked. I was happy. And then I ran into a wall that had nothing to do with my code.

**Android only lets one app hold the VPN slot at a time.** I needed my tailnet *and* another networking client running at once, and that's just not a thing you can do. One or the other.

The only real fix was to stop having two apps. So I took the discovery feature I'd built into Headlink and ported it into the other client, so one app does both jobs.

### Problem 14: same idea, completely different plumbing

The second app has its own dialer abstraction, own address types, own config format. The logic transferred fine; everything around it had to be rewritten. Which is normal, but it's also where the next bug got in.

### Problem 15: THE BUG. And it was invisible at home.

Ported everything, built it, tested at home. Worked great. Went out, switched to mobile data, and it couldn't find my server at all.

The logs said the connection timed out against the LAN address. Fine, that's expected, that's exactly the case my hook exists for. But the line where the hook says "a dial failed, let me go look up the real address"? **Not there.** Not an error. Just absent.

That absence was the entire clue. The hook was never being asked.

The cause: I had written the hook to skip anything that came in as a hostname instead of an IP, because normally the app resolves DNS first and hands the dialer an IP. But **one specific request** in the connection process, the very first key fetch, goes through a plain HTTP client, and those hand the dialer the raw hostname. So the one request that had to work was the exact one I was skipping.

And at home it never mattered, because at home the LAN address actually works.

Fix was to handle the hostname case: resolve it, then run the results through the hook like normal. Plus a regression test that literally has the phone's real log line in a comment, so future me knows this was a real thing that happened and not a hypothetical.

### Problem 16: my build lied to me

After fixing that, I rebuilt. It took two seconds and said `BUILD SUCCESSFUL`.

Two seconds. For a change to native Go code.

The build was reusing a stale prebuilt native library and only recompiling the app around it. I had shipped the OLD code to my phone, with a green checkmark and everything. If I'd trusted it, I'd have spent the next hour debugging a fix that was never on the device.

I added a check to the build script: if any Go source is newer than the compiled library, rebuild the library first, no arguing.

I also stopped trusting build output entirely. Now I pull the APK back **off the phone** and search inside the compiled binary for the name of the function I just added. If it's not in there, it's not on the phone. That habit has caught things twice now.

### Problem 17: my patch files were basically empty

I keep my changes as patch files so I can reapply them to newer upstream versions. I generated them, they looked fine, reasonable size.

They contained none of the feature.

`git diff` **ignores files git has never seen.** All of my new files, which is most of the work, were silently skipped. The patch was just the handful of edits to existing files. You have to tell git the new files exist first (`git add -A -N`), and then the patch went from ~120 lines to ~800.

Terrifying, because that's the kind of thing you only discover months later when you try to restore from it.

### Problem 18: the moment I thought the whole project was wasted

I tried importing a config share link into the app and got **"not a supported scheme."**

My stomach dropped. I genuinely thought I'd spent weeks building on something that didn't support the thing I needed, and had to start over.

It wasn't that. That share-link *format* comes from a different project and this app has simply never read it. The underlying support was there the whole time, and my own logs from an earlier test literally showed it working. I just had to convert the link into the app's own config format instead of pasting it in. Wrote a small script to do the conversion and moved on.

Lesson I keep relearning: "the app rejected my input" and "the app can't do this" are very different sentences and panic does not distinguish them.

### Problem 19: startup depended on something that needed startup

The app downloads some routing rule sets when it starts. Those downloads go through the tunnel. The tunnel isn't up yet. So on a bad network, startup would just **fail**, not degrade, fail.

Fixed by shipping the rule sets inside the APK and pointing the app at those as the initial copy, plus enabling its cache file so it remembers between runs. Now it starts from local data instantly and refreshes later if it can. Tested by deliberately breaking the connection: starts in 0.08 seconds.

### Problem 20: three config mistakes the config checker doesn't catch

- Two options I was using got deprecated in a recent version and replaced by a different structure.
- One of my sections pointed its traffic at an empty placeholder, which the app rejects at runtime with "makes no sense" (accurate).
- Both of those pass `check` and only fail on `run`. So "config is valid" means less than you'd hope.

### Problem 21: editing JSON on a phone is miserable

All my settings lived in a config file that I had to edit **on my phone** in a text box. Every tweak. It was awful.

So I built an actual settings screen. Control server, secret, certificate, all of it, stored encrypted in the keystore like before, with the ability to import a certificate bundle straight from the phone's file picker. It merges into the config on the way past, so the config file itself stays free of credentials.

It also validates: it refuses a control server given as a bare IP (there'd be no hostname left to protect), refuses a non-HTTPS lookup URL, refuses an empty secret, refuses half a certificate pair. All the mistakes I'd already made once.

## Part 3: the battery mystery

Everything worked. Then I noticed my phone was looking up my server's hostname **every two seconds**, forever. That is not a thing a healthy app does, and it was going to eat my battery.

First instinct: something's wrong with DNS caching. Wrong. Almost all of those "lookups" were cache hits, one real query per DNS TTL. The lookups were a **symptom**, and I nearly spent a day fixing the wrong thing.

Here's the actual chain, and it's a good one:

1. My relay server's certificate is self-signed, so away from home the app can't verify it.
2. Failure → retry with backoff.
3. Every retry re-runs a network conditions check.
4. That check's result flapped between two values.
5. A changed result counts as "my network changed."
6. So the app posted a network update to the control server. TLS handshake plus an HTTPS POST.
7. Six to eight times a minute. Forever.

Over 8 minutes I counted 199 lookups, 88 network checks, 38 update posts, 81 certificate errors and 88 backoffs.

The proper fix is a real publicly-trusted certificate on that relay, which I'll do. The immediate fix: the protocol supports **pinning a specific certificate** by its hash. That's a pin, not a bypass. Hostname verification still runs, expiry still runs, the only thing replaced is chain-to-CA verification.

I want to be really clear about that, because sitting a few lines away in the same source file is an option that genuinely does turn verification off, and it would also have "fixed" this. I didn't use it, and I wrote down why so I don't get tempted later.

After the pin, same measurement over an idle window: **0, 0, 0, 0, 0.** And the relay connected on the first try.

### The bonus: a workaround that had never once worked

While in there I found that my server config had an "ignore certificate errors" option set. Except the key was spelled **`insecurefortest`** and the real one is **`InsecureForTests`**. Missing an `s`.

The config parser silently ignores keys it doesn't recognise. No warning, no error, nothing. So that line had been sitting there doing absolutely nothing for weeks, while I assumed it was handling the problem.

And I'm leaving it broken, because fixing the typo would actually disable certificate verification, which is the thing I've spent this entire project refusing to do. Deleted it instead.

## So how much of this was AI

A lot. Honestly.

Where it was great:

- **Reading walls of logs.** Thousands of lines of connection logs, and the answer being *which line is missing*. That's the kind of thing I'd stare past twenty times.
- **Knowing the shape of unfamiliar code.** Names of functions in a networking library I'd never touched, where the seams are, what's safe to hook.
- **Talking me down.** During the "supported scheme" panic, having something go "wait, your own log from yesterday shows it working" was worth a lot.

Where I had to stay awake:

- **Confident wrong answers happen.** The fake-200 telemetry thing would have quietly deleted my logs. The stale-build thing said BUILD SUCCESSFUL. Both looked correct.
- **Verification beats agreement.** Pulling the APK off the phone and grepping the binary is undramatic and never lies. Reading a success message is faster and lied to me directly.
- **Security shortcuts need a hard "no" written down somewhere.** There is always a one-line change that makes the error go away by disabling a check. I kept a rules file in the project saying never disable certificate verification, never log the discovered address, never store credentials in plain preferences. Having those written down meant every time we got near one, the answer was already decided instead of being re-argued at 1am when I just wanted it to work.

That last one is my actual takeaway. Not "AI good" or "AI bad." The tool is extremely fast at getting you to *something that runs*, and "runs" and "correct" are not the same word, especially when the whole point of your project is a privacy property that failing silently is the worst possible outcome for.

## The short version, if you skipped

- Check Android battery settings before you debug your server
- `adb uninstall` doesn't remove other user profiles' copies
- The absence of a log line is data
- `git diff` doesn't see untracked files
- A fast build is a suspicious build
- macOS `curl` needs a P12, not a PEM pair
- Config validators validate less than you think
- A pin is not a bypass, but the bypass is always right there next to it

Anyway. My phone finds my house from anywhere now, and my home address isn't in public DNS. Took a while.
