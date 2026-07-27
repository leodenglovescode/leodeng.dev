---
title: Setting Up Headscale for Remote Access to My Home Server
date: 2026-07-12T18:36:24+08:00
description: What actually broke while getting my Mac, Windows PC, and phone to
  reach my home server remotely, and how I fixed each one.
---


**The problem:** I wanted remote access to my homelab. Not "port forward SSH and hope for the best" remote access, actual private mesh networking between my server, my Mac, my Windows PC, and my phone, so any of them can reach any other one like they're on the same LAN, from anywhere. Concretely, the things I actually needed this for: **remote video streaming** from cameras at home, controlling **Home Assistant** without exposing it to the open internet, a **secure SSH tunnel** into the server without punching random ports through my router, and being able to **remotely edit and debug code** running on the server as if I were sitting in front of it.


Tailscale is the obvious tool for this, but self-hosting made more sense for my situation. One important distinction I originally got wrong: **Tailscale's coordination server is control plane, not data plane** ([official explanation](https://tailscale.com/docs/concepts/control-data-planes)). It distributes keys, peer information, policy, and connection metadata; it does **not** normally carry my actual traffic. Tailscale tries to move peer traffic directly over WireGuard/UDP, and DERP is the fallback when a direct path can't be established. I still wanted Headscale because I preferred to run the control plane myself, and I also wanted the option to place a relay close to my server for the network combinations that really did need one. Headscale is the open-source reimplementation of Tailscale's control server: same official clients on every device, just pointed at infrastructure I run myself.


Here's what actually happened, roughly in the order I hit it. Also, full transparency upfront: AI tools were a big part of actually working through most of these issues (reading logs, narrowing down root causes, sanity checking fixes before running them), and this writeup itself was drafted with the same kind of help.

> **Update / correction note:** I later went back through this against the current Headscale, Tailscale, and Apple documentation. A couple of my original explanations were too confident: I had conflated the control plane with the data path, and I had Apple's 398-day certificate rule wrong. The version below keeps what I actually observed, but separates confirmed behavior from what was only correlation.


## Attempt 1: Just set it up normally

Got Headscale running, got my Mac connected, called it done. Except every time I restarted my Mac, it came back as a completely different device: new tailnet IP, new machine key, no memory of ever having connected before. My node list in Headscale started filling up with duplicate ghost entries with random suffixes, and any script that assumed a stable IP for my server broke constantly.

**What fixed it in my setup:** finite node expiry was enabled in the configuration I was using. Current Headscale's base default is actually `node.expiry: 0` (no default expiry); its example config notes that Tailscale's hosted service uses finite key expiry ([Headscale config](https://github.com/juanfont/headscale/blob/main/config-example.yaml)). Also, expiry by itself should normally force reauthentication rather than magically erase a client's local identity, so if a machine appears as a brand-new node after *every* reboot, client-state persistence is another thing worth checking.

In my case, disabling default node expiry stopped the re-registration mess:

```yaml
node:
  expiry: 0
```

After that I manually cleaned out the ghost entries.

So I would not phrase the lesson as "Headscale nodes expire by default." The safer lesson is: **check both the server-side node expiry and whether the client is actually preserving its local state.**

## Attempt 2: TLS just didn't work

Headscale needs to be reachable over **HTTPS** by Tailscale clients, and TCP/443 is also required if you're using Headscale's embedded DERP server ([Headscale requirements](https://headscale.net/stable/setup/requirements/)). I already had a private CA for internal services, so I signed a server certificate, trusted the CA on my Mac, and expected that to be the end of it.

It wasn't. The client still failed TLS verification, with an error that made it look like the trust chain itself was the problem.

**What I had wrong in the original writeup:** I blamed Apple's modern **398-day** certificate rule. That's not the right rule for this case. Apple's 398-day limit applies to TLS server certificates chaining to roots that ship in Apple's trust store, and Apple explicitly says that limit **does not apply** to user-added or administrator-added root CAs ([Apple](https://support.apple.com/en-asia/102028)).

The older macOS 10.15 / iOS 13 TLS requirements are different: for TLS server certificates issued after July 1, 2019, Apple requires a validity period of **825 days or fewer**, along with SAN, serverAuth EKU, SHA-2 signatures, and adequate key sizes ([Apple](https://support.apple.com/en-ie/103769)). My leaf certificate had a ridiculous **10-year** lifetime, so it violated that 825-day requirement even though I trusted the private root CA.

**Fix:** reissue the leaf certificate with a validity period under 825 days. I used a much shorter certificate and the client immediately started accepting it.

So if you're running your own PKI and OpenSSL is happy while an Apple client is not, don't just stare at the CA chain. Check the leaf certificate's SAN, EKU, signature/key requirements, **and lifetime**.

## Attempt 3: Testing outside my LAN, connections just died

Took my Mac off the home network to actually test remote access, and sometimes it couldn't establish a direct connection to the server at all.

**What went wrong:** my server only had a **public IPv6 address, no public IPv4**, while the network I was testing from was IPv4-only. Without some translation layer, those two endpoints don't have a shared IP family for a direct UDP path. DERP is useful here because Tailscale's DERP servers are dual-stack and can relay between IPv4-only and IPv6-only clients ([Tailscale DERP docs](https://tailscale.com/docs/reference/derp-servers)).

**Fix:** I added a nearby self-hosted DERP option so that when a direct path really wasn't possible, the fallback didn't have to take an unnecessarily long route.

```yaml
derp:
  server:
    enabled: true
    region_id: 999
  paths:
    - /etc/headscale/derp.yaml
```

One wording correction from my original version: **Headscale itself isn't "choosing the lowest-latency relay."** Headscale distributes the DERP map; the Tailscale client measures regions and selects a preferred/home DERP based largely on latency and reachability.

Direct is still the goal. DERP is the fallback.

## Background: how my Mac kept reaching Headscale reliably

Before getting into the next problem, worth explaining something I'd already built and mostly forgotten I was relying on.

My Mac was reaching the **Headscale control server** through an internal hostname. Because my ISP's public IPv6 prefix can change, I had a small script that kept an `/etc/hosts` entry pointed at the server's current public IPv6 address:

```text
2409:xxxx:xxxx:xxxx::1 headscale.lan
```

Important correction: this only changes **how the Mac reaches Headscale's control-plane hostname**. It does **not** choose the peer-to-peer WireGuard path and it does not, by itself, make Tailscale data traffic "direct." Peer traffic uses endpoint discovery/NAT traversal separately.

My earlier version of the script also used `tailscale ping` as a test before refreshing the address. That's not a great validity check for this purpose: a Tailscale ping can succeed over DERP even when the `/etc/hosts` entry is stale. The cleaner version is simply to query the authenticated source of truth periodically and update only when the address changed:

```bash
#!/usr/bin/env bash
set -euo pipefail

ENDPOINT="YOUR_SYNC_ENDPOINT_HERE"
SECRET="YOUR_SECRET_HERE"
CA_CERT="YOUR_CERT_PATH/ca.crt"
CLIENT_CERT="YOUR_CERT_PATH/client.crt"
CLIENT_KEY="YOUR_CERT_PATH/client.key"
HOSTNAME_ENTRY="headscale.lan"

CURRENT_IPV6=$(grep -E "[[:space:]]${HOSTNAME_ENTRY}([[:space:]]|$)" /etc/hosts \
  | awk '{print $1}' | head -1 || true)

RESPONSE=$(curl --silent --fail --max-time 15 \
  --cacert "$CA_CERT" \
  --cert "$CLIENT_CERT" \
  --key "$CLIENT_KEY" \
  -H "X-Sync-Secret: $SECRET" \
  "$ENDPOINT")

NEW_IPV6=$(printf '%s' "$RESPONSE" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['ipv6'])")

if [[ -z "$NEW_IPV6" || "$NEW_IPV6" == "$CURRENT_IPV6" ]]; then
  exit 0
fi

sudo /bin/sh -c "
  awk -v host='$HOSTNAME_ENTRY' '\$2 != host { print }' /etc/hosts > /tmp/hosts.tmp
  printf '%s %s\n' '$NEW_IPV6' '$HOSTNAME_ENTRY' >> /tmp/hosts.tmp
  cat /tmp/hosts.tmp > /etc/hosts
  rm -f /tmp/hosts.tmp
"
```

That endpoint is authenticated with a client certificate; by "private" here I mean it is **not anonymously queryable**, not that the URL necessarily has to be unreachable from the public internet.

I wired the script into `launchd` so it runs periodically. I hadn't originally built it specifically for Headscale; it was a general-purpose "keep this hostname pointed at my changing server address" helper I'd made for an earlier project, and I reused the pattern here.

## Attempt 4: Adding Windows and Android broke everything

Mac was solid. Tried adding Windows and my phone next, and both got stuck on "connecting" forever, with very little useful UI feedback.

**What went wrong:** the hostname I was using existed only in my Mac's `/etc/hosts`. Windows and Android had no way to resolve it before they had joined the tailnet.

Tailscale clients do have a **bootstrap DNS fallback**: if normal DNS resolution is broken, the client can ask known Tailscale/DERP infrastructure to resolve a name. That is useful for public DNS names, but it obviously cannot invent a private-only name that has never been delegated in public DNS. The important correction is that Tailscale does **not** require every custom control-server hostname to be public in all circumstances; a private name can work if the device's normal system DNS (or hosts file) can already resolve it. Mine couldn't.

My Mac never hit the problem because `/etc/hosts` short-circuited DNS. Windows and Android hit it immediately.

**Fix:** use a real domain/subdomain for the control server and issue a proper certificate for that name. I used DNS-01 for certificate issuance. After the hostname became resolvable on those devices, Windows and Android could reach the custom control server normally.

## Attempt 5: Fixed that, then lost all my connection speed

After the hostname migration, I saw connections that had previously been direct showing up as relayed, and throughput got much worse.

My original explanation here was:

> "The public DNS record changed, therefore Tailscale started relaying. Restoring an `/etc/hosts` override made it direct again."

That explanation was too confident and, architecturally, mostly wrong.

**Why:** the hostname of the Headscale server is part of the **control plane**. It determines how the client reaches Headscale for registration, keys, peer information, policy, DERP maps, and updates. It is **not** the address used for normal peer-to-peer WireGuard data traffic.

The actual peer path is negotiated separately. Tailscale learns candidate peer endpoints, uses STUN/NAT traversal, and tries direct UDP. If a direct path can't be established, the connection can fall back to a relay such as DERP ([connection types](https://tailscale.com/docs/reference/connection-types)). Changing:

```text
ts.example.com -> some address
```

can absolutely make the **control server** reachable or unreachable, but it should not by itself convert a healthy direct peer path into a DERP path.

So the correct troubleshooting path for "why am I relayed?" is things like:

```bash
tailscale status
tailscale ping <peer>
tailscale netcheck
tailscale debug derp-map
```

Then check UDP reachability, NAT behavior, firewalls, the peer's discovered endpoints, and which DERP region is being selected.

In my case, the relay-only behavior changed around the same time as the DNS migration, and the hosts override appeared to "fix" it, but I didn't capture enough state to prove that DNS was the cause. The honest conclusion is: **correlation, not a confirmed root cause.**

I still use a hosts/split-DNS override where it is useful for reaching the Headscale control server at the right address. I just no longer describe that as a data-plane performance optimization.

My Windows desktop is simpler because it sits on the same LAN as the server. When both peers can reach each other locally and UDP isn't being blocked, Tailscale can establish a local direct path regardless of what hostname I use for the control server.

Android is also where the distinction matters most: without root I can't casually rewrite `/etc/hosts`. If the public DNS record for the Headscale hostname points only to an unroutable/private address, an Android phone away from home may be unable to reach the **control plane at all**. Cached tailnet state can keep some existing connectivity working when the coordination server is unavailable, but new peer information, policy changes, key operations, and other control-plane updates won't work reliably until the control server is reachable again ([Tailscale's coordination-outage behavior](https://tailscale.com/docs/reference/coordination-server-down)).

So for a real deployment, the cleaner choices are a genuinely reachable public control-plane endpoint, a reverse proxy/VPS in front of Headscale, or proper split-horizon DNS rather than pretending an unreachable public record is harmless.

## Attempt 6: Windows straight up ignored me

After the hostname migration, Windows kept trying to connect to the old control address no matter what I told it. Explicit login-server flags and the resets I tried weren't enough.

**What went wrong:** the old control-server information was persisted in the client's local state, so changing a command-line flag wasn't necessarily equivalent to giving the client a completely fresh identity/configuration.

**Fix:** I stopped the Tailscale service, made sure the client processes were gone, removed the relevant local Tailscale state, and re-enrolled the machine against the new control server.

The important warning: **wiping the state directory is destructive.** It signs the client out and throws away local Tailscale state, so don't present it as a harmless first-line "reset" command. Use the normal logout/reset/re-login path first; only wipe local state when you are intentionally okay with treating the machine as a fresh client.

Sometimes a reset really does not mean "delete every persisted bit of state."

## Where things ended up

The setup is now much easier for me to reason about because I keep the two planes separate in my head:

- **Control plane:** Headscale over one real hostname and a valid TLS certificate. Any device that needs to manage/join/update remotely must actually be able to reach that hostname somehow: public address, reverse proxy, VPN-independent tunnel, split DNS, or an explicit local override.
- **Data plane:** Tailscale/WireGuard peer traffic tries to go direct over UDP. If that is impossible (for example, an IPv4-only client talking to an IPv6-only server with no translation path), a relay handles the traffic.

The self-hosted DERP exists for the second problem. The hostname and TLS work exist for the first one. They are related because the control server distributes network information, but they are not the same path.

That was the biggest conceptual mistake in my first version of this post: I treated "where the Headscale hostname resolves" as if it were also "where my Tailscale traffic flows." It isn't.

None of the failures were magic. Some were configuration mistakes, some were platform requirements I hadn't read carefully enough, and at least one "root cause" was me seeing a fix happen at the same time as a network-path change and assuming one caused the other.

Which, honestly, is a pretty normal homelab debugging session.

