# Now playing server

Server-side support for the optional "Leo is now playing" home-page widget.
The macOS publisher lives separately in `../now-playing-agent/`, which is
ignored by Git as requested.

```text
Mac agent                             Cloudflare Pages
  POST current track --------------> private metadata endpoint -> D1 singleton
  PUT album art --------------------> private artwork endpoint  -> R2

Visitor browser
  GET current track <--------------- public read-only endpoint <- D1 + edge cache
  GET album art <----------------------------------------------- R2 custom domain
```

There is no Cloudflare Tunnel and no VM in this path. The Mac agent
pushes outbound over HTTPS directly to Cloudflare. The public site never needs
to reach the Mac or the super server.

## Storage

`HOMELAB_DB` is reused because it is already bound to the Pages project. The
new tables do not mix now-playing data with the historical homelab or token
series:

- `now_playing` has at most one row. It is current state, not listening history.
- `now_playing_rate` stores the exact global artwork-upload throttle.
- The row is not required to be deleted after a crash. Public reads treat it as
  absent 30 seconds after its server-assigned receipt time.
- Artwork is stored in the existing `MEDIA` R2 bucket under a SHA-256-derived
  key and served through `R2_PUBLIC_BASE`, which defaults to
  `https://media.leodeng.dev`.

For a fresh database, `homelab/schema.sql` includes both tables. For the
existing production database, apply the idempotent migration:

```bash
npx wrangler d1 execute leodeng-homelab \
  --remote \
  --file=homelab/migrations/0002_now_playing.sql \
  --yes
```

## Cloudflare bindings

The Pages project needs these production bindings:

| Name | Type | Value |
| --- | --- | --- |
| `HOMELAB_DB` | D1 | `leodeng-homelab` |
| `MEDIA` | R2 | the existing public media bucket |
| `NOW_PLAYING_TOKEN` | encrypted secret | a unique 32-byte random value |
| `R2_PUBLIC_BASE` | optional text variable | defaults to `https://media.leodeng.dev` |

Create the secret and enter it at Wrangler's hidden prompt:

```bash
openssl rand -hex 32
npx wrangler pages secret put NOW_PLAYING_TOKEN --project-name leodeng-dev
```

Keep that value for the Mac agent. Do not reuse `HOMELAB_TOKEN`. The
ingest routes fail closed with `503` while `NOW_PLAYING_TOKEN` is missing.

## API contract

### Public read

`GET /api/now-playing` is the only route the web page will use.

It returns `204 No Content` when no recent push exists. While playing, it
returns:

```json
{
  "playing": true,
  "title": "Dreams",
  "artist": "Fleetwood Mac",
  "album": "Rumours",
  "durationMs": 257800,
  "positionMs": 42100,
  "observedAt": 1800000000000,
  "serverNow": 1800000000000,
  "artworkUrl": "https://media.leodeng.dev/now-playing/artwork/HASH.jpg"
}
```

The response is cached at Cloudflare for five seconds. A future widget should
advance the progress bar locally from `positionMs` using the difference between
the browser clock and `serverNow`, capped at `durationMs`. This gives smooth
progress without polling every second.

### Private metadata ingest

`POST /api/internal/now-playing` requires
`Authorization: Bearer <NOW_PLAYING_TOKEN>` and the `application/json`
content type. The body shape is:

```json
{
  "trackKey": "apple-music-stable-track-id",
  "title": "Dreams",
  "artist": "Fleetwood Mac",
  "album": "Rumours",
  "durationMs": 257800,
  "positionMs": 42100,
  "artworkKey": "now-playing/artwork/HASH.jpg"
}
```

`album` and `artworkKey` may be `null`. The JSON body is capped at 8 KB.
Accepted metadata writes are limited globally to one every three seconds using
an atomic conditional D1 upsert. A rejected write returns `429` with
`Retry-After: 3`.

`DELETE /api/internal/now-playing` uses the same bearer token and clears the
current row immediately. The Mac agent calls it when playback
pauses or stops. If it cannot, the 30-second stale cutoff still hides the
widget.

### Private artwork ingest

`PUT /api/internal/now-playing/artwork/:sha256` uses the same bearer token. The
path hash must match the body. Supported content types are JPEG, PNG, and WebP.
The body must include an accurate `Content-Length` and is streamed through a
hard 2 MB ceiling.

New artwork uploads are limited globally to one every ten seconds with an
atomic D1 throttle. Hash-addressed duplicates return the existing key without
writing another object. Stored objects use a one-year immutable cache policy.

## Security and failure behavior

- Public traffic has no write-capable route or credential.
- Private routes accept only their documented methods and use a separate
  bearer secret compared in constant time.
- D1 assigns receipt time. A wrong Mac clock cannot keep stale state alive.
- Metadata validation bounds every string, duration, position, and artwork key.
- Cloudflare's edge cache absorbs the normal public polling load. Cloudflare
  zone-level rate limiting can be added for abusive clients without writing a
  D1 row for every public request.
- No listening history, device name, Apple account data, local path, or source
  IP is returned by the public API.

## Checks

```bash
npm run test:server
npm run build
```

After the Functions deployment and secret are live:

```bash
curl -i https://leodeng.dev/api/now-playing
```

When the Mac agent is not playing anything, `204 No Content` is the expected
healthy result.
