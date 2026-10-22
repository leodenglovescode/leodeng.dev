#!/usr/bin/env python3
"""Private listening receiver and daily aggregate publisher. Standard library only."""
import argparse
import datetime as dt
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import sqlite3
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from collections import defaultdict


def connect(path):
    db = sqlite3.connect(path, timeout=20)
    db.execute('PRAGMA journal_mode=WAL')
    db.execute('CREATE TABLE IF NOT EXISTS listens(id TEXT PRIMARY KEY, payload TEXT NOT NULL)')
    db.execute('CREATE TABLE IF NOT EXISTS publication(name TEXT PRIMARY KEY, day TEXT NOT NULL)')
    db.execute('CREATE TABLE IF NOT EXISTS live_publication(name TEXT PRIMARY KEY, digest TEXT NOT NULL, sent_at REAL NOT NULL)')
    return db


def validate(e):
    if not isinstance(e, dict) or not re.fullmatch('[a-f0-9]{32}', str(e.get('id', ''))):
        raise ValueError('Invalid ID')
    for key in ('title', 'artist', 'album'):
        if not isinstance(e.get(key), str) or len(e[key]) > 500 or (key != 'album' and not e[key]):
            raise ValueError('Invalid metadata')
    for key in ('durationMs', 'startedAt', 'updatedAt', 'listenedMs'):
        if type(e.get(key)) is not int or e[key] < 0:
            raise ValueError('Invalid timing')
    if not 0 < e['durationMs'] <= 86400000 or not 1589428800000 <= e['startedAt'] <= e['updatedAt'] <= int(dt.datetime.now(dt.timezone.utc).timestamp()*1000)+300000:
        raise ValueError('Invalid time range')
    if e['listenedMs'] > e['updatedAt']-e['startedAt']+1500:
        raise ValueError('Invalid listening duration')
    if not isinstance(e.get('days'), dict) or len(e['days']) > 366:
        raise ValueError('Invalid days')
    for day, value in e['days'].items():
        parsed = dt.date.fromisoformat(day)
        if parsed.isoformat() != day or type(value) is not int or not 0 <= value <= 86400000:
            raise ValueError('Invalid day bucket')
        start = dt.datetime.fromtimestamp(e['startedAt']/1000, dt.timezone.utc).date()
        end = dt.datetime.fromtimestamp(e['updatedAt']/1000, dt.timezone.utc).date()
        if not start <= parsed <= end:
            raise ValueError('Day outside session')
    if sum(e['days'].values()) != e['listenedMs']:
        raise ValueError('Invalid day total')
    return {key: e[key] for key in ('id','title','artist','album','durationMs','startedAt','updatedAt','listenedMs','days')}


def ingest(db, events):
    if not isinstance(events, list) or not 1 <= len(events) <= 100:
        raise ValueError('Invalid batch')
    clean = [validate(e) for e in events]
    with db:
        for event in clean:
            row = db.execute('SELECT payload FROM listens WHERE id=?', (event['id'],)).fetchone()
            if row:
                previous = json.loads(row[0])
                if any(event[k] != previous[k] for k in ('title','artist','album','durationMs','startedAt')):
                    raise ValueError('Conflicting session')
                if event['updatedAt'] < previous['updatedAt']:
                    continue  # An acknowledged newer cumulative update already exists.
                if event['listenedMs'] < previous['listenedMs'] or any(event['days'].get(d,0)<v for d,v in previous['days'].items()):
                    raise ValueError('Decreasing listening time')
            db.execute('INSERT INTO listens VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
                       (event['id'], json.dumps(event, separators=(',',':'))))


def aggregate(db, today=None, include_today=False):
    today = today or dt.datetime.now(dt.timezone.utc).date()
    if include_today: today += dt.timedelta(days=1)
    events = [json.loads(row[0]) for row in db.execute('SELECT payload FROM listens')]
    result = {'through': (today-dt.timedelta(days=1)).isoformat(), 'ranges': {}, 'daily': []}
    daily = defaultdict(lambda: {'plays':0, 'listenedMs':0})
    for e in events:
        start = dt.datetime.fromtimestamp(e['startedAt']/1000, dt.timezone.utc).date().isoformat()
        qualified = e['listenedMs'] >= min(30000, e['durationMs']/2)
        if qualified and start < today.isoformat(): daily[start]['plays'] += 1
        for day, value in e['days'].items():
            if day < today.isoformat(): daily[day]['listenedMs'] += value
    for label, length in [('7',7),('30',30),('all',None)]:
        cutoff = (today-dt.timedelta(days=length)).isoformat() if length else '0001-01-01'
        totals = {'plays':0,'listenedMs':0,'artists':[],'albums':[],'tracks':[]}
        buckets = {kind: defaultdict(lambda: {'plays':0,'listenedMs':0}) for kind in ('artists','albums','tracks')}
        for e in events:
            start = dt.datetime.fromtimestamp(e['startedAt']/1000, dt.timezone.utc).date().isoformat()
            plays = int(cutoff <= start < today.isoformat() and e['listenedMs'] >= min(30000,e['durationMs']/2))
            duration = sum(v for d,v in e['days'].items() if cutoff <= d < today.isoformat())
            totals['plays'] += plays; totals['listenedMs'] += duration
            for kind, key in [('artists',(e['artist'],)),('albums',(e['album'],e['artist'])),('tracks',(e['title'],e['artist']))]:
                if kind=='albums' and not e['album']:continue
                if not plays and not duration:continue
                buckets[kind][key]['plays']+=plays; buckets[kind][key]['listenedMs']+=duration
        for kind, entries in buckets.items():
            totals[kind] = [dict(name=key[0],artist=key[1] if len(key)>1 else '',**values) for key,values in sorted(entries.items(),key=lambda item:(-item[1]['listenedMs'],-item[1]['plays'],item[0]))[:10]]
        result['ranges'][label]=totals
    first=today-dt.timedelta(days=90)
    for offset in range(90):
        day=(first+dt.timedelta(days=offset)).isoformat()
        result['daily'].append(dict(day=day,**daily[day]))
    return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args): return None


def publish(db):
    today=dt.datetime.now(dt.timezone.utc).date()
    # Live view includes today; the daily D1 fallback covers completed UTC days.
    value=aggregate(db,today,include_today=True)
    value['archive']=aggregate(db,today)
    body=json.dumps(value,separators=(',',':')).encode()
    digest=hashlib.sha256(body).hexdigest()
    previous=db.execute("SELECT digest,sent_at FROM live_publication WHERE name='music'").fetchone()
    now=dt.datetime.now(dt.timezone.utc).timestamp()
    if previous and (previous[0]==digest or now-previous[1]<50):return
    token=os.environ.get('HOMELAB_TOKEN','')
    if not token:raise ValueError('HOMELAB_TOKEN is missing')
    req=urllib.request.Request('https://leodeng.dev/api/stats/music', data=body, headers={'Content-Type':'application/json','Authorization':'Bearer '+token,'User-Agent':'leodeng-listening/1.1'})
    with urllib.request.build_opener(NoRedirect).open(req,timeout=20) as response:
        if json.loads(response.read(8192)).get('ok') is not True:raise ValueError('Push not acknowledged')
    with db:db.execute("INSERT INTO live_publication VALUES('music',?,?) ON CONFLICT(name) DO UPDATE SET digest=excluded.digest,sent_at=excluded.sent_at",(digest,now))
    print('Live listening summary pushed')


def serve(path, token, host, port):
    if len(token)<32: raise ValueError('LISTENING_TOKEN must contain at least 32 characters')
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass  # No request headers, song titles or tokens in access logs.
        def respond(self,status,body):
            data=json.dumps(body).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
        def do_POST(self):
            self.connection.settimeout(10)
            provided=self.headers.get('Authorization','').encode()
            if not hmac.compare_digest(hashlib.sha256(provided).digest(), hashlib.sha256(('Bearer '+token).encode()).digest()):return self.respond(401,{'error':'Unauthorized'})
            if self.path!='/v1/listens':return self.respond(404,{'error':'Not found'})
            try:
                length=int(self.headers.get('Content-Length','0'))
                if not 0<length<=300000:return self.respond(413,{'error':'Invalid size'})
                body=json.loads(self.rfile.read(length))
                with connect(path) as db:ingest(db,body.get('events'))
            except (ValueError,TypeError,AttributeError,OverflowError):return self.respond(400,{'error':'Invalid listening batch'})
            except (sqlite3.Error,OSError):return self.respond(503,{'error':'Storage unavailable'})
            return self.respond(200,{'ok':True})
    servers=[]
    for address in host.split(','):
        try:
            server=ThreadingHTTPServer((address,port),Handler)
        except OSError:
            continue
        servers.append(server)
        threading.Thread(target=server.serve_forever,daemon=True).start()
    if not servers: raise ValueError('No listening address available')
    try: threading.Event().wait()
    finally:
        for server in servers: server.shutdown(); server.server_close()


if __name__=='__main__':
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['serve','publish'])
    parser.add_argument('--db',default='/var/lib/listening-history/listening.db')
    parser.add_argument('--host',default='100.64.0.2,192.168.3.61')
    parser.add_argument('--port',type=int,default=8791)
    args=parser.parse_args()
    Path(args.db).parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    if args.command=='serve':serve(args.db,os.environ.get('LISTENING_TOKEN',''),args.host,args.port)
    else:
        try:
            with connect(args.db) as db:publish(db)
        except Exception: raise SystemExit('Listening summary push failed; local history retained')
