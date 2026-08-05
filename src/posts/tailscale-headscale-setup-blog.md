---
title: Setting Up Headscale for Remote Access to My Home Server
date: 2026-07-12T18:36:24+08:00
description: What actually broke while getting my Mac, Windows PC, and phone to
  reach my home server remotely, and how I fixed each one.
---
**The problem:** I wanted remote access to my homelab without turning half of it into public internet services. The goal was a private mesh between my server, Mac, Windows PC, and phone so they could reach each other more or less like they were on the same LAN, even when I was away.

The actual use cases were pretty normal homelab stuff: **remote camera streaming**, controlling **Home Assistant**, **SSH** into the server without exposing port 22, and editing/debugging code remotely without building a separate public endpoint for every service.

Tailscale is the obvious answer, but for this setup I wanted to self-host the control plane. That is where **Headscale** comes in: it implements the Tailscale coordination/control server, while the normal Tailscale clients still handle WireGuard, endpoint discovery, NAT traversal, and peer connectivity.

One distinction matters a lot here:

- **Headscale/Tailscale coordination is the control plane.**
- **WireGuard peer traffic is the data plane.**
- **DERP is a fallback relay when a direct peer path cannot be established.**

The control server distributes keys, peer information, policy, and DERP maps. It normally does **not** sit in the middle of the traffic between two peers.

I also used AI tools heavily while building this: reading logs, comparing configs, checking assumptions, and helping turn the deployment notes into this writeup. The interesting part was not getting a perfect setup on the first try; it was seeing how all of the pieces behave once you stop testing from a single machine on a single LAN.


## Getting stable node identity

The first version worked on my Mac, but after restarts I started seeing duplicate nodes appear in Headscale with new tailnet IPs and slightly different names.

For a private deployment I did not want routine node expiry, so I made that explicit:

```yaml
node:
  expiry: 0
```

After cleaning up the duplicate entries, the machine identity stayed stable.

One useful caveat: if a client registers as a genuinely new node after **every** reboot, do not only stare at the Headscale expiry setting. The client also needs to preserve its own local Tailscale state. A server-side expiry policy and lost client state can produce similar-looking symptoms from the admin side.


## TLS with a private CA

I already had my own CA for internal services, so the natural next step was to sign a certificate for Headscale and trust that CA on the clients.

OpenSSL liked the chain. macOS did not.

The important detail turned out to be the leaf certificate itself. I had originally issued it with a **10-year validity period**, which is far longer than Apple's TLS requirements allow for server certificates issued on modern systems.

This is easy to confuse with Apple's newer **398-day** public-certificate limit. That newer rule applies to certificates chaining to roots in Apple's built-in trust store; it does not apply in the same way to a root CA that a user or administrator installed manually.

For my private-CA setup, the relevant Apple requirement was the older **825-day maximum** for TLS server certificates, along with the usual modern requirements such as SAN, serverAuth EKU, SHA-2 signatures, and adequate key sizes.

Reissuing the leaf certificate with a much shorter lifetime solved the problem.

So if a private PKI looks valid in OpenSSL but an Apple client still rejects it, I would check more than the chain:

- certificate lifetime
- Subject Alternative Name
- Extended Key Usage
- signature algorithm
- key size

The error message is not always going to point at the exact one.


## IPv6-only server meets IPv4-only network

My home server has a public **IPv6** address but no public IPv4 address.

That is fine until the client happens to be on an IPv4-only network.

At that point there may simply be no shared IP family for a direct UDP path between the two endpoints. Tailscale can normally punch through NAT and establish direct WireGuard paths, but it cannot make an IPv4-only network directly route to an IPv6-only endpoint without some translation mechanism in the middle.

This is where DERP matters.

I added a nearby self-hosted relay so that the fallback path stayed geographically close to the server:

```yaml
derp:
  server:
    enabled: true
    region_id: 999
  paths:
    - /etc/headscale/derp.yaml
```

Headscale distributes the DERP map to the clients; the Tailscale clients measure the available regions and choose an appropriate relay when they need one.

The important part is that **direct is still preferred**. The relay exists for the cases where the network path genuinely cannot be direct.


## Keeping the control hostname pointed at a changing IPv6 address

My ISP does not give the server a permanently static public IPv6 address, so I already had a small helper that kept an internal hostname mapped to the server's current address.

On macOS I used `/etc/hosts`:

```text
2409:xxxx:xxxx:xxxx::1 headscale.lan
```

The script periodically queries a small authenticated endpoint, gets the current IPv6 address, and rewrites the entry only when it changes.

A simplified version looks like this:

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

I run it periodically through `launchd`.

A subtle but important point: this changes how the Mac reaches the **Headscale control server**. It does not force Tailscale peer traffic to use that same address. Peer-to-peer WireGuard paths are negotiated separately.

That distinction becomes important later.


## Windows and Android exposed the DNS bootstrap problem

The Mac worked because it already had the hostname in `/etc/hosts`.

Windows and Android did not.

Both clients sat on "connecting" because the control-server hostname only existed locally on the Mac. Before a new client can join the tailnet, it still needs some normal way to resolve and reach the Headscale server.

Tailscale has bootstrap-DNS behavior that can help when ordinary DNS is broken, but that only helps for names that actually exist in resolvable DNS. It cannot discover a private hostname that was never published anywhere and only exists in another machine's hosts file.

The clean solution was to give Headscale a real subdomain and issue a certificate for that name using DNS-01.

Once the control hostname was something every device could resolve, Windows and Android connected normally.

That does **not** mean a Headscale hostname must always be public. A private hostname works perfectly well if every client already has DNS or hosts-file resolution for it. Mine simply did not.


## Control-plane DNS and data-plane performance are separate problems

Around the same time as the hostname migration, I noticed some connections that had previously been direct showing up as relayed, with much worse throughput.

This is exactly the kind of thing that is easy to misdiagnose because two changes happen at the same time.

The Headscale hostname determines how a client reaches the **control plane**. It does not determine the address used for normal peer-to-peer WireGuard traffic.

The data path is negotiated separately:

1. peers learn about each other through the control server;
2. the clients discover candidate endpoints;
3. Tailscale tries to establish a direct UDP path;
4. if that fails, traffic can fall back to DERP.

So if a connection suddenly becomes relayed, changing the DNS record for the Headscale hostname is not, by itself, a real explanation.

The useful tools are things like:

```bash
tailscale status
tailscale ping <peer>
tailscale netcheck
tailscale debug derp-map
```

Then look at the actual path: UDP reachability, NAT behavior, firewall rules, discovered peer endpoints, and the DERP region being selected.

I still use local hosts/split-DNS overrides where they are useful for making the **control server** reachable at the right address. I just treat that separately from whether the peer connection itself is direct.

My Windows desktop is a nice example: it sits on the same LAN as the server, so the peers can normally establish a local direct path regardless of what hostname I use to reach Headscale.


## Android is the least flexible client in this setup

macOS is easy to customize because I can rewrite `/etc/hosts`.

A normal unrooted Android phone is not.

That means any design that depends on a per-device hosts override becomes awkward on Android very quickly. DNS override apps exist, but most are built around filtering or VPN-based DNS interception rather than acting as a transparent replacement for `/etc/hosts`.

The more robust design is therefore to make the Headscale control endpoint reachable in a way the phone can actually use remotely: public endpoint, reverse proxy, split-horizon DNS where appropriate, or some other path that does not depend on root access.

Existing Tailscale connections can survive temporary loss of the coordination server for a while because the clients cache peer state, but that is not a substitute for a reachable control plane. New peer information, policy changes, key operations, and re-registration still depend on it.


## Windows kept the old control server in local state

The final annoying issue was Windows remembering the old login server after I had moved everything to the new hostname.

Changing command-line flags was not enough because the client had already persisted its state locally.

The clean first choice is still the normal route: logout, reset/reconfigure, and enroll the machine again.

In my case I eventually treated it as a fresh client: stopped the service, made sure the client processes were gone, removed the relevant local Tailscale state, and re-enrolled it against the new Headscale URL.

That is a **destructive reset**, not something I would recommend as the first troubleshooting step. It throws away local Tailscale state and effectively makes the machine a new client again.


## Where the setup ended up

The final architecture is much easier to reason about once the control plane and data plane are kept separate.

### Control plane

Headscale lives behind one real hostname with a valid TLS certificate.

Every device that needs to join, re-register, receive peer updates, or pick up policy changes needs a way to reach that hostname.

Depending on the device and network, that can be:

- normal public DNS + a reachable endpoint
- split-horizon DNS
- a reverse proxy/VPS
- an explicit local override

### Data plane

The actual traffic between peers is handled by Tailscale/WireGuard.

The clients try to establish a direct UDP path first. If the two networks cannot talk directly — for example an IPv4-only client reaching an IPv6-only server with no translation path — DERP provides the fallback.

That separation cleared up most of the confusing behavior:

- TLS and hostname problems are **control-plane** problems.
- Direct-vs-relayed performance is a **data-plane** problem.
- The self-hosted DERP exists for the second one, not the first.

The setup ended up being less about one clever config file and more about making each layer explicit: identity, TLS, DNS, control-plane reachability, peer discovery, and relay fallback.

Once those layers were separated, the system became a lot less mysterious.
