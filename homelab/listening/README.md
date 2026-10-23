# Listening history

The Mac writes a durable private outbox before publishing live now-playing
updates. SuperServer stores cumulative sessions in SQLite. A live sanitized summary goes to R2 and a daily
snapshot goes to D1 and is displayed on both Stats pages. No old listening
history can be recovered retroactively from the current now-playing endpoint.

## SuperServer

From this repository on SuperServer:

```bash
sudo install -m 755 homelab/listening/listening.py /usr/local/bin/listening-history.py
sudo install -m 644 homelab/listening/listening_musicbrainz.py /usr/local/bin/listening_musicbrainz.py
sudo install -m 644 homelab/listening/listening-history.service /etc/systemd/system/
sudo install -m 644 homelab/listening/listening-publish.{service,timer} /etc/systemd/system/
sudoedit /etc/listening-history.env
```

Generate a **new separate** token with `openssl rand -hex 32`. Put it in the
root-owned environment file as `LISTENING_TOKEN=your_new_token`. Keep this token
separate from the website's now-playing and homelab tokens. The Mac needs this
same listening token. Do not commit any of these values.

```bash
sudo chown root:root /etc/listening-history.env
sudo chmod 600 /etc/listening-history.env
sudo systemctl daemon-reload
sudo systemctl enable --now listening-history.service listening-publish.timer
sudo systemctl start listening-publish.service
journalctl -u listening-history -u listening-publish -n 30 --no-pager
```

The supplied units run as `leodeng`; edit User/Group if necessary. The publisher
uses your existing `/etc/homelab-status.env` with `HOMELAB_TOKEN`. Pages keeps
its existing `HOMELAB_DB` and `HOMELAB_TOKEN`; no new Cloudflare secret is needed.
The API creates its own `music_summary` table automatically.

The receiver listens only on `100.64.0.2:8791` and `192.168.3.61:8791` when those
addresses are available. Keep port 8791 private; do not forward it to the
internet. Headscale transport is encrypted. The optional LAN fallback uses
HTTP on your private network. Remove the LAN URL from `--history-servers` on
the Mac if you want Headscale only. If an interface comes up after the receiver
starts, restart `listening-history.service` to bind its address too.

SQLite is at `/var/lib/listening-history/listening.db`. Back it up using SQLite's
backup command/API, including current WAL contents, rather than copying only
the main file while the service is running. This is the source of truth, and
raw records are never pruned automatically.

The publisher checks every minute and uploads changed summaries only. Failed
pushes retry on the next minute. The existing MEDIA R2 binding stores a single
small live summary object. D1 receives only the daily snapshot of completed
UTC days; same-day updates do not rewrite it. The public API reads R2 and falls
back to D1 during an R2 outage. Both Stats pages poll every minute while visible.

Live results include the current UTC day. Rankings cover 7 days, 30 days and
all time; the chart covers 90 days including today. The two minute-scale hops
from Mac to SuperServer and SuperServer to R2, plus the browser poll, mean
updates normally appear within one to three minutes. Late offline uploads
retain their original dates and are included in the next changed summary. All-time figures remain recalculable from local SQLite.

## Mac

Install the new Apple Silicon build using the packaged `install-update.sh` as
your logged-in Mac user, without sudo around the whole script. The existing
launchd configuration works with the new defaults. History is recorded even if
SuperServer or the website is unreachable.

Store the same new listening token in its own private file:

```bash
mkdir -p "$HOME/Library/Application Support/dev.leodeng.now-playing-agent"
umask 077
read -r -s -p 'Listening token: ' listening_token; printf '\n'
printf '%s\n' "$listening_token" > "$HOME/Library/Application Support/dev.leodeng.now-playing-agent/history-token"
unset listening_token
chmod 600 "$HOME/Library/Application Support/dev.leodeng.now-playing-agent/history-token"
```

Run that snippet in Bash (`bash` first if your interactive shell is Zsh).
The value does not appear in shell history. The agent retries sync every
minute, first through Headscale and then through the LAN fallback. Files are
removed from the outbox only after SuperServer acknowledges them; interrupted
or repeated uploads are deduplicated by stable session IDs. A newer local
version is retained if playback advanced while an older version was uploading.
Only one agent process may own the queue at a time.

The outbox and active checkpoint live under
`~/Library/Application Support/dev.leodeng.now-playing-agent/listening-history/`.
These files are private, mode 600 in a private directory. After acknowledgement,
SuperServer's SQLite archive retains the history. Back up that archive.

Flags: `--history-servers` (comma-separated origins), `--history-directory`, and
`--history-token-file`. An empty `--history-servers=` disables collection.
Tokens are never sent through redirects or environment-configured HTTP proxies.
The live website token is never sent to SuperServer.

## Counting

A session counts as a play after 30 seconds or half its track duration,
whichever comes first. Listening time includes short skips, but those skips do
not count as plays. Rankings are ordered by actual observed listening time.
Pauses do not accumulate time; brief pauses resume the same session. A pause
longer than 30 minutes, a track change, or an observed end-to-start repeat
creates another session. Seeks do not add skipped time. Sleep, restarts and
sampling gaps over 15 seconds receive no guessed listening time. Position
sampling can miss very short transitions or repeats between samples.

Listening time is split at UTC midnight. Counted plays are attributed to the
session's start day. Artwork, lyrics, local library IDs and raw observations
are never uploaded to D1; only totals, day buckets and top ten names per range
are public. This tracks Apple Music on this Mac, not playback on other devices.

## Checks

```bash
python3 -m unittest discover -s homelab/listening -p 'test*.py'
(cd now-playing-agent && go test -race ./...)
node --test functions/tests/music-stats.test.js
```


## Updating an existing daily-only installation

No Mac update or token changes are needed. On SuperServer, from this repo:

```bash
sudo install -m 755 homelab/listening/listening.py /usr/local/bin/listening-history.py
sudo install -m 644 homelab/listening/listening_musicbrainz.py /usr/local/bin/listening_musicbrainz.py
sudo install -m 644 homelab/listening/listening-publish.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart listening-publish.timer
sudo systemctl start listening-publish.service
```

The receiver may keep running its current version; its ingestion protocol and
SQLite schema remain compatible. The new publisher creates its own tiny local
publication-state table automatically. Keep the existing MEDIA binding on the
Pages project. No additional Cloudflare secrets or bindings are needed.

## Ranking artwork

Album covers are identified from the songs actually observed in each album,
for every artist. The publisher includes up to five representative played
tracks per ranked album. Its local resolver searches MusicBrainz recordings,
checks artist and track titles, and intersects the release groups containing
those songs. Only a single consistent album identity produces a cover.
Ambiguous, conflicting, incomplete, or unavailable catalog results remain
unpictured. Color/edition labels are extra metadata, never artist-specific
rules. Featured-artist and remaster labels are normalized; live and remix
versions remain distinct.

Matches and recording searches are cached in local SQLite. Requests identify
this application and run at most once every 1.1 seconds, with a 25-second budget
per publication run. Previously completed searches are reused on subsequent
runs, so new albums can resolve progressively without blocking the listening
stats. Raw records remain local; public snapshots carry only the bounded
representative song list and the resulting catalog identity.

Cover Art Archive serves album thumbnails by the resolved MusicBrainz
release-group ID. Artist photos still use TheAudioDB's public v1 API (free key
`123`). R2 caches image URLs and source links under `stats/artwork/v3/`; images
are not committed or rehosted. The album cache key includes its song evidence
and verified identity, and browser requests are versioned when that evidence
changes. Old name-only results and per-band overrides are not used.

Public API access does not change the underlying images' copyright or license.
Provider documentation: https://musicbrainz.org/doc/MusicBrainz_API and
https://www.theaudiodb.com/free_music_api

## Updating to song-verified album covers

No Mac update or token changes are needed: existing sessions already contain
the song, album, and artist. On SuperServer, from this repository:

```bash
sudo install -m 755 homelab/listening/listening.py /usr/local/bin/listening-history.py
sudo install -m 644 homelab/listening/listening_musicbrainz.py /usr/local/bin/listening_musicbrainz.py
sudo systemctl start listening-publish.service
```

The minute timer is unchanged. The publisher creates its small local catalog
cache tables automatically. Existing history can be resolved without replaying
songs. If the catalog cannot distinguish albums, the page shows a placeholder
instead of falling back to a first name-search result.
