---
title: Setting Up Headscale for Remote Access to My Home Server
date: 2026-07-12T18:36:24+08:00
description: What actually broke while getting my Mac, Windows PC, and phone to reach my home server remotely, and how I fixed each one.
---

**The problem:** I wanted remote access to my homelab. Not "port forward SSH and hope for the best" remote access, actual private mesh networking between my server, my Mac, my Windows PC, and my phone, so any of them can reach any other one like they're on the same LAN, from anywhere. Concretely, the things I actually needed this for: **remote video streaming** from cameras at home, controlling **Home Assistant** without exposing it to the open internet, a **secure SSH tunnel** into the server without punching random ports through my router, and being able to **remotely edit and debug code** running on the server as if I were sitting in front of it.

Tailscale is the obvious tool for this, but self-hosting made more sense for my situation. Going through Tailscale's cloud-hosted coordination means every connection first has to find its way to whichever regional relay is closest to their infrastructure, and depending on routing, that can mean bouncing traffic across borders before it ever reaches a server sitting in the same city as me. Headscale is the open-source reimplementation of Tailscale's control server: same official clients on every device, just pointed at infrastructure I run myself, in the same place my server actually lives.

Here's what actually happened, roughly in the order I hit it. Also, full transparency upfront: AI tools were a big part of actually working through most of these issues (reading logs, narrowing down root causes, sanity checking fixes before running them), and this writeup itself was drafted with the same kind of help.

## Attempt 1: Just set it up normally

Got Headscale running, got my Mac connected, called it done. Except every time I restarted my Mac, it came back as a completely different device: new tailnet IP, new machine key, no memory of ever having connected before. My node list in Headscale started filling up with duplicate ghost entries with random suffixes, and any script that assumed a stable IP for my server broke constantly.

**What went wrong:** Headscale nodes **expire by default**, same as Tailscale's real service. Once the key expires, the client doesn't complain, it just quietly re-registers as a brand new node the next time it connects. Makes sense for a multi-tenant SaaS product. Makes no sense when you're the only user on your own network and don't need periodic re-auth as a security measure.

**Fix:** one config line.

```yaml
node:
  expiry: 0
```

Nodes stop expiring, same device stays the same device forever. Had to manually clean out the ghost entries afterward, but that was it.

## Attempt 2: TLS just didn't work

Headscale needs HTTPS, not a preference, a hard requirement, since the DERP relay protocol won't function without TLS in place. I've got my own private CA for internal stuff already, so I signed a cert the normal way and expected it to work.

It didn't. Every client failed TLS verification with "self signed certificate in certificate chain," even after trusting the CA in the system keychain with "Always Trust" checked on everything.

**What went wrong:** the cert I signed had a **10 year validity period**, and modern platforms (macOS included) flat out reject any TLS server cert valid for more than **398 days**, regardless of whether the CA itself is trusted. A trusted CA doesn't rescue a leaf cert that individually breaks the platform's own lifetime rule, it just gets silently dropped, with an error message that points you in the wrong direction entirely.

**Fix:** reissue with `-days 397`. Worked instantly. If you're running your own PKI and something verifies fine with `openssl s_client` but fails everywhere else, check the cert's validity window before assuming the trust chain is broken.

## Attempt 3: Testing outside my LAN, connections just died

Took my Mac off the home network to actually test remote access, and sometimes it couldn't establish any connection to the server at all. No direct path, no fallback, just dead.

**What went wrong:** my server only had a **public IPv6 address, no public IPv4**. Whatever network I was testing from was IPv4 only. Two endpoints that don't share an IP family can't do NAT traversal to reach each other directly, someone has to relay the traffic. The default fallback is Tailscale's public relay servers, and depending which one you land on, that can add a lot of latency if it's not geographically close to you.

**Fix:** Headscale supports custom relay regions, plus ships an embedded relay you can run yourself. I stood up a second one on a small VPS in the same city as my server, purely as a low latency fallback:

```yaml
derp:
  server:
    enabled: true
    region_id: 999
  paths:
    - /etc/headscale/derp.yaml
```

Headscale automatically prefers whichever relay measures lowest latency, so this didn't need any manual switching. It just quietly became the better option whenever a direct connection wasn't possible.

## Background: how my Mac was actually staying fast this whole time

Before getting into the next problem, worth explaining something I'd already built and mostly forgotten I was relying on.

My Mac was connecting to Headscale through an internal only hostname, and getting a fast, direct connection from anywhere, because I had a small script keeping that hostname's entry in `/etc/hosts` pointed at my server's current public IPv6 address at all times. Something like:

```
2409:xxxx:xxxx:xxxx::1 headscale.lan
```

The IPv6 my ISP hands out isn't static, so the script checks periodically whether the current entry still works, and if not, pulls the fresh address from a small authenticated endpoint I run (client certificate required, not something publicly queryable) and rewrites the hosts entry:

```bash
#!/usr/bin/env bash
set -euo pipefail

ENDPOINT="YOUR_SYNC_ENDPOINT_HERE"
SECRET="YOUR_SECRET_HERE"
CA_CERT="YOUR_CERT_PATH/ca.crt"
CLIENT_CERT="YOUR_CERT_PATH/client.crt"
CLIENT_KEY="YOUR_CERT_PATH/client.key"
STATE_FILE="YOUR_STATE_FILE_PATH"
HOSTNAME_ENTRY="headscale.lan"

CURRENT_IPV6=$(grep "$HOSTNAME_ENTRY" /etc/hosts | awk '{print $1}' | head -1 || true)

if [[ -n "$CURRENT_IPV6" ]]; then
    if ping -c1 -W1 100.64.0.2 &>/dev/null; then
        exit 0   # still reachable, nothing to do
    fi
fi

RESPONSE=$(curl --silent --fail --max-time 15 \
     --cacert "$CA_CERT" --cert "$CLIENT_CERT" --key "$CLIENT_KEY" \
     -H "X-Sync-Secret: $SECRET" "$ENDPOINT")

NEW_IPV6=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['ipv6'])")

OLD_IPV6=$(cat "$STATE_FILE" 2>/dev/null || echo "")
if [[ "$NEW_IPV6" == "$OLD_IPV6" ]]; then
    exit 0
fi

sudo /bin/sh -c "
    grep -v '$HOSTNAME_ENTRY' /etc/hosts > /tmp/hosts.tmp
    echo '$NEW_IPV6 $HOSTNAME_ENTRY' >> /tmp/hosts.tmp
    mv /tmp/hosts.tmp /etc/hosts
"
echo "$NEW_IPV6" > "$STATE_FILE"
```

Wired into a launchd job so it runs every few seconds in the background. I hadn't originally set this up specifically for Headscale, it was a general purpose "keep this hostname pointed at my server's current address" script I'd already put together with some help from AI tooling while working through an earlier project, and I just reused the same pattern here without thinking too hard about it, which turned out to matter a lot for what happened next.

## Attempt 4: Adding Windows and Android broke everything

Mac was solid. Tried adding Windows and my phone next, and both got stuck on "connecting" forever, no useful error, just endless retries.

**What went wrong:** the internal only hostname I was using doesn't exist anywhere in public DNS, and it turns out Tailscale clients need to resolve the control server hostname through a **bootstrapping step that only works against real public DNS**. It's a chicken and egg thing: before the client has a trusted network path at all, it asks a hardcoded list of Tailscale's own infrastructure to resolve the hostname on its behalf, and that only works for names that are actually delegated publicly. My Mac never hit this wall because its hosts file entry short circuited the lookup before Tailscale ever needed to resolve anything itself. Windows and Android had no such override, so they hit the real problem head on and looped forever.

**Fix:** register a real subdomain, issue it a proper certificate through a DNS-01 challenge, and use that as the control server hostname instead. Windows and Android both connected on the first try after that.

## Attempt 5: Fixed that, then lost all my connection speed

Connections that used to be fast and direct started going through the relay permanently, even from places that should've supported a direct connection just fine.

**What went wrong:** once I had a real public hostname working, I pointed its DNS record at my server's **private internal address** rather than its public one, since I didn't want my home address sitting in a lookup anyone on the internet could query. That part was a deliberate decision. Where I actually got stuck for a bit afterward was assuming that record was now the only thing controlling where each device routed to, since it was the thing doing the resolving. It took some going back and forth to properly notice that **the hosts file override wasn't something the old setup needed instead of DNS, it was something that had been quietly layered on top of DNS the whole time**, and there was nothing stopping me from doing the exact same thing on top of the new real domain too.

**Fix:** pointed the sync script at the new hostname instead of the old one, same mechanism, same authenticated endpoint, just updating a different entry:

```
2409:xxxx:xxxx:xxxx::1 ts.example.com
```

Same public hostname, same real certificate either way, the override just changes which address that specific device personally routes to. Nothing about it is visible to anyone else or to public DNS.

My Windows PC never needed any of this. It's a stationary desktop sitting on the same LAN as the server, so it always gets a direct local connection regardless of what the public DNS record says, no hosts file entry required there at all.

Android is the one device that's stuck without a real fix. No root means no hosts file access at all, and every no root DNS override app I checked was either years out of maintenance or couldn't do actual address rewriting in the first place, since most of them are ad blocker or firewall tools, not hosts file replacements. For that one device, I just accepted the fallback behavior. Worst case it sits on the relay or waits until it touches a network that can reach the server, but the underlying connection never actually breaks or needs re-authentication.

## Attempt 6: Windows straight up ignored me

After the whole hostname migration, Windows kept trying to connect to the old control address no matter what I told it. Explicit login server flags, full resets, none of it mattered.

**What went wrong:** the old address was **saved inside Windows's local state file**, not just a setting the command line flags could override. A registry key I'd set earlier didn't help either, since that only applies to a fresh, never registered install, not one that already has a saved profile.

**Fix:** stopped the service, killed both client processes, deleted the entire state directory, let it start completely clean. Sometimes a "reset" flag genuinely doesn't reset everything, and the real fix is just wiping it and starting over.

## Where things ended up

Every device now points at one real, publicly resolvable hostname with one real certificate. What that hostname resolves to publicly is intentionally meaningless to anyone outside my own network, it only matters to whichever device happens to be on that network, or to the ones running the private hosts override on top of it to get a direct connection from further away. A self hosted relay covers the rest.

None of this was really "bugs," every single one was a documented (or at least discoverable) piece of how the stack actually works that I just hadn't run into yet because I'd only ever tested it from one device on one network.