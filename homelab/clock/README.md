# Homepage GPS clock

Browser → public Pages `/api/time` → Access-protected
`clock-origin.leodeng.dev` → Tunnel → `127.0.0.1:8099/time` on the Pi.
Python reads the GPS/PPS-disciplined system clock. No NTP port is published.

The service fails closed unless chrony reports normal synchronization,
Stratum 1, a selected PPS reference ID, and a reference update within 120
seconds. A background monitor checks every 10 seconds; results expire after
30 seconds. Set `CLOCK_PPS_REFID` in `/etc/pi-clock.env` if the existing
chrony configuration uses a different PPS refid. Never change chrony's
configuration just to satisfy the website.

## Pi installation

Copy this directory to the Pi, inspect the files, then run:

```sh
sudo sh install.sh
systemctl status pi-clock.service
curl --fail http://127.0.0.1:8099/time
```

Python venv support and `/usr/bin/chronyc` must already be installed.
Waitress handles HTTP with four worker threads, 16 connections, small
headers, no bodies, and short idle timeouts. The global token bucket allows
5 requests/second with a burst of 10 and returns 429 plus Retry-After when
busy. It recovers automatically. systemd limits CPU to 10% of one core and
memory to 96 MB. It runs as a dedicated account without sudo, home access,
writable system paths, or network destinations beyond loopback. Confirm
the Pi supports systemd's IP filtering; do not assume unsupported kernel
features enforce these restrictions.

## Cloudflare configuration

1. Create an Access self-hosted application for the entire
   `clock-origin.leodeng.dev` hostname. Create one dedicated service token
   and a Service Auth policy accepting only that token. No Bypass policy.
2. Create a dedicated Tunnel and install its connector on the Pi. Route
   only `clock-origin.leodeng.dev` to `http://127.0.0.1:8099`. No LAN routes,
   SSH routes, or unrelated services. Ensure unmatched ingress fails closed.
3. Put the service token values in the Pages project's production secrets:
   `CLOCK_ACCESS_CLIENT_ID` and `CLOCK_ACCESS_CLIENT_SECRET`. Keep them out
   of the browser bundle, shell arguments, repository, and logs.
4. Add a zone rate limiting rule matching hostname `leodeng.dev` and path
   `/api/time`: start at 10 requests per 10 seconds per IP with a 10-second
   block. Verify the account plan supports these settings. Do not use a
   browser challenge for this background API. Cover alternate production
   hostnames too, or redirect them to the canonical host.
5. Disable caching for the origin hostname. Both services return no-store;
   ensure no overriding Cache Everything rule exists.

Pages previews without secrets safely fall back to device time. The fixed
origin URL is deliberately not selected from visitor input. The proxy
never follows redirects, never forwards cookies or visitor headers, enforces a
2 KB response limit and a two-second timeout, and reconstructs a numeric
JSON response. Only GET without query parameters is supported.

## Browser behavior and timing

The browser displays milliseconds in Shanghai time with UTC+08:00 and a
device-clock source immediately. Three sequential initial samples choose
the smallest network delay after subtracting origin processing time.
The corrected time advances using performance.now(); it resynchronizes
every 60 seconds while visible and when returning to the tab. Any failed,
unhealthy, or timed-out synchronization immediately restores device time.
Retry-After postpones further requests. Background tabs stop rendering and
requesting. Reduced-motion visitors get one display update per second.

Pi timestamps are taken at WSGI application entry and before response
serialization. Queueing, proxy handling and serialization remain part of
transport uncertainty. Half the network round trip estimates return delay;
asymmetric paths cannot be corrected from one exchange. Milliseconds are
display precision, not a claim of millisecond accuracy.

## Verification and rollback

Check that unauthenticated calls to the origin fail before reaching Python,
that valid public calls return only the documented fields, that a burst
produces 429 and automatically recovers, and that timeout/unhealthy-source
responses switch the browser to device time. Inspect systemd resource and
network restrictions. Do not simulate GPS loss by changing the live time
daemon; exercise mocked health checks instead.

To roll back, remove Pages clock secrets (the site falls back), stop/disable
`pi-clock.service`, and remove only this dedicated tunnel, Access policy,
token and WAF rule. Existing LAN NTP and watchdog services are independent.
