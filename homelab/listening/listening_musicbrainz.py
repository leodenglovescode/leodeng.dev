"""Identify albums by played-song membership, not a first album-name result."""
import datetime as dt
import hashlib
import json
import re
import time
import unicodedata
import urllib.parse
import urllib.request

UUID = re.compile(r'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$')


def normalized(text):
    text = unicodedata.normalize('NFKC', text).casefold()
    text = text.translate(str.maketrans({'’': "'", '‘': "'", '“': '"', '”': '"'}))
    return ' '.join(re.sub(r'[^\w]+', ' ', text).split())


def track_title(text):
    # Preserve live/acoustic/remix distinctions; remove only tagging decorations.
    while True:
        previous = text
        text = re.sub(r'\s*[\[(](?:feat\.?|featuring|ft\.?)\s+[^)\]]+[)\]]\s*$', '', text, flags=re.I)
        text = re.sub(r'\s*(?:[\[(]|[-–—])\s*(?:\d{4}\s*)?remaster(?:ed)?[^)\]]*[)\]]?\s*$', '', text, flags=re.I).strip()
        if text == previous: return text


def album_identity(title):
    base, qualifier = title.strip(), ''
    while True:
        suffix = re.search(r'\s*[\[(]([^\])]+)[\])]\s*$', base)
        if not suffix: break
        label = suffix.group(1)
        if re.search(r'\b(deluxe|expanded|anniversary|remaster(?:ed)?)\b', label, re.I):
            base = base[:suffix.start()].strip()
        elif re.search(r'\balbum\s*$', label, re.I):
            base = base[:suffix.start()].strip()
            qualifier = re.sub(r'\balbum\s*$', '', label, flags=re.I).strip()
        else: break
    return base, qualifier


class CatalogBudgetExhausted(TimeoutError): pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args): return None


class CatalogClient:
    def __init__(self, budget_seconds=25):
        self.deadline = time.monotonic() + budget_seconds
        self.last = 0

    def search(self, artist, album, track):
        delay = max(0, 1.1 - (time.monotonic() - self.last))
        if time.monotonic() + delay + 1 > self.deadline:
            raise CatalogBudgetExhausted('Catalog lookup budget exhausted')
        if delay: time.sleep(delay)
        def quoted(value): return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'
        query = 'recording:' + quoted(track_title(track)) + ' AND artist:' + quoted(artist) + ' AND release:' + quoted(album)
        url = 'https://musicbrainz.org/ws/2/recording/?' + urllib.parse.urlencode({'query': query, 'fmt': 'json', 'limit': '100'})
        req = urllib.request.Request(url, headers={'Accept': 'application/json', 'User-Agent': 'leodeng-listening/2.0 (https://leodeng.dev/stats)'})
        self.last = time.monotonic()
        timeout = min(8, max(1, self.deadline - self.last))
        with urllib.request.build_opener(NoRedirect).open(req, timeout=timeout) as response:
            if 'application/json' not in response.headers.get('Content-Type', ''):
                raise ValueError('Expected catalog JSON')
            raw = response.read(2_000_001)
            if len(raw) > 2_000_000: raise ValueError('Catalog response too large')
            return json.loads(raw)


def candidate_groups(data, artist, album, track):
    # A truncated search cannot establish a unique match. Never choose the
    # first result or the highest search score in place of actual membership.
    if type(data.get('count')) is not int or data['count'] > 100 or not isinstance(data.get('recordings'), list):
        raise ValueError('Incomplete recording search')
    base, qualifier = album_identity(album)
    result = {}
    for recording in data['recordings']:
        if normalized(track_title(recording.get('title', ''))) != normalized(track_title(track)): continue
        artists = [c.get('artist', {}).get('name', c.get('name', '')) for c in recording.get('artist-credit', []) if isinstance(c, dict)]
        if normalized(artist) not in [normalized(a) for a in artists]: continue
        for release in recording.get('releases', []):
            group = release.get('release-group', {})
            if group.get('primary-type') != 'Album' or not UUID.fullmatch(group.get('id', '')): continue
            group_base, _ = album_identity(group.get('title', ''))
            if normalized(group_base) != normalized(base): continue
            if qualifier and not set(normalized(qualifier).split()).issubset(set(normalized(group.get('disambiguation', '') + ' ' + group.get('title','')).split())): continue
            title = normalized(group.get('title',''))
            result[group['id']] = 2 if title == normalized(album) else 1 if title == normalized(base) else 0
    return result


def schema(db):
    db.execute('CREATE TABLE IF NOT EXISTS music_album_matches (cache_key TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL)')
    db.execute('CREATE TABLE IF NOT EXISTS music_recording_candidates (cache_key TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at INTEGER NOT NULL)')
    db.commit()


def cache_key(parts):
    return hashlib.sha256(json.dumps(['song-membership-v1',parts], ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def identify_album(db, artist, album, tracks, client, now):
    tracks = sorted(set(tracks), key=normalized)
    if not tracks: return None
    key = cache_key([normalized(artist), normalized(album), sorted(normalized(t) for t in tracks)])
    cached = db.execute('SELECT payload FROM music_album_matches WHERE cache_key=? AND expires_at>?', (key, now)).fetchone()
    if cached: return json.loads(cached[0])
    common, ranks = None, {}
    base, _ = album_identity(album)
    for track in tracks:
        recording_key = cache_key([normalized(artist), normalized(album), normalized(track_title(track))])
        cached_recording = db.execute('SELECT payload FROM music_recording_candidates WHERE cache_key=? AND expires_at>?', (recording_key, now)).fetchone()
        if cached_recording:
            ranked_groups = json.loads(cached_recording[0])
        else:
            data = client.search(artist, base, track)
            ranked_groups = candidate_groups(data, artist, album, track)
            with db: db.execute('INSERT OR REPLACE INTO music_recording_candidates VALUES(?,?,?)', (recording_key, json.dumps(ranked_groups,sort_keys=True), now + 7*86400))
        groups = set(ranked_groups)
        ranks.update(ranked_groups)
        common = groups if common is None else common & groups
        if not common: break
    if common:
        # Prefer an exact album label only AFTER every sampled song matches.
        # This distinguishes an original album from a separately cataloged
        # anniversary box containing the same songs, without search-score guesses.
        best = max(ranks[group] for group in common)
        common = {group for group in common if ranks[group] == best}
    match = {'releaseGroupId': next(iter(common)), 'matchedTracks': tracks} if common and len(common) == 1 else None
    with db: db.execute('INSERT OR REPLACE INTO music_album_matches VALUES(?,?,?)', (key, json.dumps(match), now + (30*86400 if match else 6*3600)))
    return match


def enrich_album_artwork(db, summaries, client=None, now=None):
    schema(db)
    client = client or CatalogClient()
    now = int(dt.datetime.now(dt.timezone.utc).timestamp()) if now is None else now
    albums = {}
    for summary in summaries:
        for period in summary['ranges'].values():
            for row in period['albums']:
                key = (row['artist'], row['name'])
                albums.setdefault(key, set()).update(row.get('sampleTracks', []))
    matches = {}
    for (artist, album), tracks in albums.items():
        try:
            matches[(artist, album)] = identify_album(db, artist, album, tracks, client, now)
        except CatalogBudgetExhausted:
            matches[(artist, album)] = None
        except Exception:
            tracks = sorted(tracks, key=normalized)
            key = cache_key([normalized(artist), normalized(album), sorted(normalized(t) for t in tracks)])
            with db: db.execute('INSERT OR REPLACE INTO music_album_matches VALUES(?,?,?)', (key, 'null', now + 300))
            # No network error becomes a verified identity. Stats publication
            # continues and unresolved artwork can be retried on the next run.
            matches[(artist, album)] = None
    for summary in summaries:
        for period in summary['ranges'].values():
            for row in period['albums']:
                match = matches.get((row['artist'], row['name']))
                if match and row.get('sampleTracks'): row['catalogMatch'] = {'releaseGroupId':match['releaseGroupId'], 'matchedTracks':row.get('sampleTracks',[])}
