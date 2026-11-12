#!/usr/bin/env python3
"""One outbound Music Assistant observer, with independent device heartbeats."""
import argparse
import hashlib
import json
import logging
import math
import os
import re
import signal
import threading
import time
import urllib.error
import urllib.parse
import urllib.request


class MonitorError(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def origin(value, private=False):
    url = urllib.parse.urlsplit(value.rstrip('/'))
    if (url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password
            or url.path or url.query or url.fragment or (url.scheme != 'https' and not private)):
        raise ValueError('Invalid service origin')
    return urllib.parse.urlunsplit(url)


class HTTP:
    def __init__(self):
        self.opener = urllib.request.build_opener(NoRedirect())
        self.direct_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def request(self, url, token='', body=None, method='POST', content_type='application/json', limit=4*1024*1024, direct=False):
        headers = {'Accept': 'application/json', 'User-Agent': 'leodeng-music-monitor/2'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        if body is not None:
            headers['Content-Type'] = content_type
        try:
            request = urllib.request.Request(url, data=body, method=method, headers=headers)
            opener = self.direct_opener if direct else self.opener
            with opener.open(request, timeout=5) as response:
                data = response.read(limit+1)
                if len(data) > limit:
                    raise MonitorError('Service response exceeded size limit')
                return data
        except urllib.error.HTTPError as error:
            raise MonitorError(f'Service returned HTTP {error.code}') from None
        except (OSError, ValueError):
            # Never include request URLs, response bodies, or bearer tokens.
            raise MonitorError('Service unavailable or invalid response') from None

    def rpc(self, url, token, command, args=None):
        body = json.dumps({'command': command, 'args': args or {}}).encode()
        try:
            return json.loads(self.request(url + '/api', token, body, direct=True))
        except (ValueError, TypeError):
            raise MonitorError('Invalid Music Assistant response') from None


def milliseconds(seconds):
    try:
        number = float(seconds or 0)
        return round(number*1000) if math.isfinite(number) else 0
    except (ValueError, TypeError):
        return 0


def streams(players, aliases=None, allowed=None, now=None):
    """One stream per playback group, including device-owned companion clients."""
    aliases = aliases or {}
    now = time.time() if now is None else now
    eligible = {player['player_id']: player for player in players if isinstance(player, dict)
                and isinstance(player.get('player_id'), str) and player.get('available')
                and player.get('enabled', True) and player.get('playback_state') == 'playing'}
    groups = {}
    for player_id, player in sorted(eligible.items()):
        if allowed is not None and player_id not in allowed:
            continue
        group = player.get('active_group') or player.get('synced_to') or player_id
        if group not in groups or player_id == group:
            groups[group] = player
    result = []
    for group, player in groups.items():
        media = player.get('current_media') or {}
        duration = milliseconds(media.get('duration'))
        title = str(media.get('title') or '').strip()
        if not title or not 0 < duration <= 86400000:
            continue
        if media.get('elapsed_time') is not None:
            position, updated = media['elapsed_time'], media.get('elapsed_time_last_updated')
        else:
            position, updated = player.get('elapsed_time'), player.get('elapsed_time_last_updated')
        position = milliseconds(position)
        if isinstance(updated, (float, int)) and math.isfinite(updated):
            position += milliseconds(max(0, now-updated))
        identity = hashlib.sha256(str(group).encode()).hexdigest()[:32]
        source_id = 'music-assistant:' + identity
        device_id = aliases.get(player['player_id'], aliases.get(group, source_id))
        label = "Leo's Mac" if device_id.startswith('mac:') else "Leo's Phone" if device_id.startswith('android:') else 'Music Assistant'
        # Transport URLs may contain credentials and must never leave this service.
        track = json.dumps([media.get('uri'), title, media.get('artist'), duration], sort_keys=True)
        result.append({
            'sourceId': source_id, 'deviceId': device_id,
            'sourceLabel': label,
            'playing': True, 'trackKey': 'ma:' + hashlib.sha256(track.encode()).hexdigest(),
            'title': title[:256], 'artist': str(media.get('artist') or 'Unknown Artist')[:256],
            'album': str(media.get('album') or '')[:256] or None,
            'durationMs': duration, 'positionMs': max(0, min(duration, position)),
            'artworkKey': None, '_image': media.get('image_url') or '',
        })
    return result


class History:
    """Use the existing durable receiver database, not the public playback cache."""
    def __init__(self, path):
        import listening
        self.listening = listening
        self.db = listening.connect(path)
        self.db.execute('CREATE TABLE IF NOT EXISTS ma_observations(source_id TEXT PRIMARY KEY, payload TEXT NOT NULL)')
        # A restart/sleep/network outage never earns listening credit.
        self.active = {key: json.loads(value) for key, value in self.db.execute('SELECT source_id,payload FROM ma_observations')}
        for observation in self.active.values():
            observation['at'] = 0

    def observe(self, tracks, preferred, now):
        import secrets
        for track in tracks:
            source_id = track['sourceId']
            if source_id not in preferred:
                self.active.pop(source_id, None)
                continue
            previous = self.active.get(source_id)
            repeated = previous and previous['position'] >= track['durationMs']-10000 and track['positionMs'] < 10000 and track['positionMs']+1000 < previous['position']
            if previous is None or previous['key'] != track['trackKey'] or repeated or now-previous['event']['updatedAt'] > 1800000:
                previous = {'key': track['trackKey'], 'position': track['positionMs'], 'at': now,
                            'event': {'id': secrets.token_hex(16), 'title': track['title'], 'artist': track['artist'],
                                      'album': track['album'] or '', 'durationMs': track['durationMs'],
                                      'startedAt': now, 'updatedAt': now, 'listenedMs': 0, 'days': {}}}
            event = previous['event']
            elapsed, delta = now-previous['at'], track['positionMs']-previous['position']
            if 0 < elapsed <= 15000 and 0 < delta <= elapsed+1500:
                credit = min(delta, elapsed)
                event['listenedMs'] += credit
                start = now-credit
                import datetime as dt
                while start < now:
                    day = dt.datetime.fromtimestamp(start/1000, dt.timezone.utc)
                    boundary = int((day.replace(hour=0, minute=0, second=0, microsecond=0)+dt.timedelta(days=1)).timestamp()*1000)
                    end = min(now, boundary)
                    bucket = day.date().isoformat()
                    event['days'][bucket] = event['days'].get(bucket, 0)+end-start
                    start = end
            event['updatedAt'] = now
            previous.update(at=now, position=track['positionMs'])
            with self.db:
                self.db.execute('INSERT INTO ma_observations VALUES(?,?) ON CONFLICT(source_id) DO UPDATE SET payload=excluded.payload',
                                (source_id, json.dumps(previous)))
                self.listening.ingest(self.db, [event])
            self.active[source_id] = previous
        live = {track['sourceId'] for track in tracks}
        self.active = {key: value for key, value in self.active.items() if key in live}
        with self.db:
            for (source_id,) in self.db.execute('SELECT source_id FROM ma_observations').fetchall():
                if source_id not in self.active:
                    self.db.execute('DELETE FROM ma_observations WHERE source_id=?', (source_id,))

    def unavailable(self):
        for observation in self.active.values():
            observation['at'] = 0


class Monitor:
    def __init__(self, ma_url, ma_token, website, website_token, aliases=None, allowed=None, http=None, history=None):
        self.ma_url, self.ma_token = origin(ma_url, private=True), ma_token
        self.website, self.website_token = origin(website), website_token
        if not ma_token or not website_token:
            raise ValueError('Both Music Assistant and website tokens are required')
        self.http = http or HTTP()
        self.aliases, self.allowed, self.history = aliases or {}, allowed, history
        if not isinstance(self.aliases, dict) or any(not isinstance(key, str) or not isinstance(value, str) or not re.fullmatch(r'[a-zA-Z0-9._:-]{1,128}', value) for key, value in self.aliases.items()):
            raise ValueError('Invalid device aliases')
        self.published, self.preferred, self.artwork = {}, set(), {}
        self.sent_at = {}
        self.art_retry = {}
        self.last_art_attempt = float('-inf')

    def snapshot(self):
        players = self.http.rpc(self.ma_url, self.ma_token, 'players/all')
        if not isinstance(players, list):
            raise MonitorError('Invalid Music Assistant player list')
        if self.allowed is not None:
            players = [player for player in players if player.get('player_id') in self.allowed]
        # Some transports expose only a stream URL. Resolve metadata through
        # MA's active queue, without treating an external native source as MA.
        queues = None
        for player in players:
            media = player.get('current_media') or {}
            if player.get('playback_state') != 'playing' or (media.get('title') and milliseconds(media.get('duration')) > 0):
                continue
            if queues is None:
                queues = self.http.rpc(self.ma_url, self.ma_token, 'player_queues/all')
                if not isinstance(queues, list):
                    raise MonitorError('Invalid Music Assistant queue list')
            queue_id = player.get('active_source')
            queue = next((q for q in queues if q.get('queue_id') == queue_id and q.get('active') and q.get('state') == 'playing'), None)
            if not queue:
                continue
            item = queue.get('current_item') or {}
            track = item.get('media_item') or {}
            album = track.get('album') or {}
            player = dict(player)
            player['current_media'] = {**media, 'title': track.get('name') or item.get('name'),
                'artist': ', '.join(a.get('name', '') for a in track.get('artists', []) if a.get('name')) or media.get('artist'),
                'album': album.get('name') if isinstance(album, dict) else None,
                'duration': item.get('duration') or track.get('duration'),
                'uri': track.get('uri') or item.get('queue_item_id'),
                'elapsed_time': queue.get('elapsed_time'), 'elapsed_time_last_updated': queue.get('elapsed_time_last_updated')}
            players = [player if p.get('player_id') == player.get('player_id') else p for p in players]
        return streams(players, self.aliases, self.allowed)

    def cover(self, track):
        image = track.get('_image')
        if not image:
            return None
        cache_key = (track['sourceId'], track['trackKey'])
        if cache_key in self.artwork:
            return self.artwork[cache_key]
        url = urllib.parse.urljoin(self.ma_url+'/', image)
        parsed = urllib.parse.urlsplit(url)
        same_origin = parsed.scheme+'://'+parsed.netloc == self.ma_url
        if parsed.username or parsed.password or (not same_origin and parsed.scheme != 'https'):
            return None
        try:
            data = self.http.request(url, self.ma_token if same_origin else '', method='GET', limit=2*1024*1024, direct=same_origin)
            if data.startswith(b'\xff\xd8\xff'):
                kind = 'image/jpeg'
            elif data.startswith(b'\x89PNG\r\n\x1a\n'):
                kind = 'image/png'
            elif data[:4] == b'RIFF' and data[8:12] == b'WEBP':
                kind = 'image/webp'
            else:
                return None
            digest = hashlib.sha256(data).hexdigest()
            response = json.loads(self.http.request(self.website+'/api/internal/now-playing/artwork/'+digest,
                self.website_token, data, method='PUT', content_type=kind, limit=8192))
            key = response.get('artworkKey')
            if not isinstance(key, str) or not key.startswith('now-playing/artwork/'+digest+'.'):
                return None
            self.artwork[cache_key] = key
            while len(self.artwork) > 64:
                del self.artwork[next(iter(self.artwork))]
            return key
        except (MonitorError, ValueError):
            return None  # Global artwork throttle: retry next poll without losing metadata.

    def step(self, now=None):
        now = time.monotonic() if now is None else now
        tracks = self.snapshot()
        current = {track['sourceId']: track for track in tracks}
        # Metadata first. Covers are fetched only after publication, then attached
        # on the next poll. Progress-only updates use one batched 10s heartbeat.
        batch = []
        for source_id, track in current.items():
            track['artworkKey'] = self.artwork.get((source_id, track['trackKey']))
            old = self.published.get(source_id)
            elapsed = now-self.sent_at.get(source_id, now)
            if not old or any(track[k] != old[k] for k in ('trackKey', 'title', 'artist', 'album', 'artworkKey', 'sourceLabel', 'deviceId')) or abs(track['positionMs']-old['positionMs']-round(elapsed*1000)) > 1500 or elapsed >= 10:
                batch.append({key: value for key, value in track.items() if not key.startswith('_')})
        for source_id, old in self.published.items():
            if source_id not in current:
                batch.append({'sourceId': source_id, 'deviceId': old['deviceId'], 'sourceLabel': old['sourceLabel'], 'playing': False})
        if batch:
            # Stay below the API's per-request source bound, without limiting monitoring.
            preferred = set(self.preferred)
            for offset in range(0, len(batch), 32):
                response = json.loads(self.http.request(self.website+'/api/internal/now-playing', self.website_token,
                    json.dumps({'sources': batch[offset:offset+32]}).encode(), limit=65536))
                if response.get('ok') is not True:
                    raise MonitorError('Website did not acknowledge playback')
                preferred = set(response.get('preferredSources', []))
            self.preferred = preferred
            # Store the last published observations, not intermediate samples.
            for item in batch:
                if item.get('playing') is False:
                    self.published.pop(item['sourceId'], None)
                    self.sent_at.pop(item['sourceId'], None)
                else:
                    self.published[item['sourceId']] = item
                    self.sent_at[item['sourceId']] = now
        if self.history:
            self.history.observe(tracks, self.preferred, round(time.time()*1000))
        if now-self.last_art_attempt >= 10:
            for track in tracks:
                key = (track['sourceId'], track['trackKey'])
                if track.get('_image') and key not in self.artwork and now >= self.art_retry.get(key, 0):
                    self.last_art_attempt = now
                    self.art_retry[key] = now+30
                    self.cover(track)
                    break
        live_keys = {(track['sourceId'], track['trackKey']) for track in tracks}
        self.art_retry = {key: retry for key, retry in self.art_retry.items() if key in live_keys}
        return tracks


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--history-db', default=os.environ.get('MUSIC_ASSISTANT_HISTORY_DB', ''))
    args = parser.parse_args()
    aliases = json.loads(os.environ.get('MUSIC_ASSISTANT_DEVICE_ALIASES', '{}'))
    allowed = set(filter(None, (value.strip() for value in os.environ.get('MUSIC_ASSISTANT_PLAYER_IDS', '').split(','))))
    history = History(args.history_db) if args.history_db else None
    monitor = Monitor(os.environ.get('MUSIC_ASSISTANT_SERVER', 'http://192.168.3.15:8095'), os.environ.get('MUSIC_ASSISTANT_TOKEN', ''),
        os.environ.get('NOW_PLAYING_SERVER', 'https://leodeng.dev'), os.environ.get('NOW_PLAYING_TOKEN', ''), aliases, allowed, history=history)
    stop = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stop.set())
    while not stop.is_set():
        started = time.monotonic()
        try:
            tracks = monitor.step()
            if args.once:
                print(json.dumps([{'device': track['sourceLabel'], 'sourceId': track['sourceId'], 'deviceId': track['deviceId'], 'title': track['title']} for track in tracks]))
                return
        except (MonitorError, OSError, ValueError):
            if history:
                history.unavailable()
            logging.warning('Music monitoring failed; previous playback expires automatically')
            if args.once:
                raise SystemExit(1) from None
        stop.wait(max(0.2, 2-(time.monotonic()-started)))


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except (ValueError, OSError):
        raise SystemExit('Music monitor configuration or storage is unavailable') from None
