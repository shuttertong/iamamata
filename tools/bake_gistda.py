#!/usr/bin/env python3
"""Bake GISTDA satellite flood areas for the service area into a static file (stdlib only).

    GISTDA_API_KEY=… python3 tools/bake_gistda.py      # → data/gistda-flood.json

Source: GISTDA Disaster Platform open API (https://disaster.gistda.or.th/services/open-api),
GET https://api-gateway.gistda.or.th/api/2.0/resources/features/flood/{period}
with header `API-Key`, query bbox / limit / offset. Satellite-detected flood areas, updated about daily.

The API key is a personal credential, so it must never reach the public website: GitHub Actions
runs this script with the key as a repository secret (.github/workflows/gistda.yml) and only the
resulting GeoJSON is published. Without a key the script exits quietly and keeps the old file.
"""
import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'gistda-flood.json')
API = 'https://api-gateway.gistda.or.th/api/2.0/resources/features/flood/{period}'
PERIOD = os.environ.get('GISTDA_PERIOD', '3days')        # 1day | 3days | 7days | 30days
PAGE = 500
MAX_FEATURES = 5000
# Service area (keep in sync with CONFIG.map.bounds, SQL in_area() and the other bake scripts): S, W, N, E.
BOUNDS = (13.36, 100.88, 13.56, 101.25)
KEEP_PROPS = 30          # keep short scalar properties only (dates, areas, names) — the file stays small


def get(url, key):
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'API-Key': key, 'Accept': 'application/json',
                                                       'User-Agent': 'flood-map-bake/0.1'})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403, 407):
                raise SystemExit(f'GISTDA refused the API key (HTTP {e.code}). Check GISTDA_API_KEY.')
            if e.code == 404:          # "no data" for this area / period
                return {'type': 'FeatureCollection', 'features': []}
            last = e
        except Exception as e:  # noqa: BLE001 — network errors: retry
            last = e
        print(f'  retrying: {last}', file=sys.stderr)
        time.sleep(5 * (attempt + 1))
    raise SystemExit(f'GISTDA request failed: {last}')


def features_of(doc):
    """GeoJSON FeatureCollection, or the same wrapped in {data: …} / {result: …}."""
    for k in ('features', 'data', 'result', 'items'):
        v = doc.get(k) if isinstance(doc, dict) else None
        if isinstance(v, list):
            return v
        if isinstance(v, dict) and isinstance(v.get('features'), list):
            return v['features']
    return []


def round_coords(c):
    if isinstance(c, (int, float)):
        return round(c, 5)
    return [round_coords(x) for x in c]


def slim(f):
    props = {k: v for k, v in (f.get('properties') or {}).items()
             if isinstance(v, (int, float, bool)) or (isinstance(v, str) and len(v) <= 80)}
    props = dict(list(props.items())[:KEEP_PROPS])
    geom = f.get('geometry') or {}
    return {'type': 'Feature', 'properties': props,
            'geometry': {'type': geom.get('type'), 'coordinates': round_coords(geom.get('coordinates', []))}}


def main():
    key = os.environ.get('GISTDA_API_KEY', '').strip()
    if not key:
        print('GISTDA_API_KEY is not set; keeping the existing data file.')
        return 0
    s, w, n, e = BOUNDS
    feats = []
    for offset in range(0, MAX_FEATURES, PAGE):
        q = urllib.parse.urlencode({'bbox': f'{w},{s},{e},{n}', 'limit': PAGE, 'offset': offset})
        page = features_of(get(f'{API.format(period=PERIOD)}?{q}', key))
        feats += [slim(f) for f in page if (f.get('geometry') or {}).get('type')]
        if len(page) < PAGE:
            break
    out = {
        'type': 'FeatureCollection',
        'period': PERIOD,
        'fetched_at': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='minutes'),
        'attribution': 'พื้นที่น้ำท่วมจากดาวเทียม © GISTDA (สทอภ.)',
        'features': feats,
    }
    old = None
    if os.path.exists(OUT):
        try:
            old = json.load(open(OUT, encoding='utf-8'))
        except ValueError:
            pass
    # Rewrite when the flood areas changed, or at least daily so "fetched_at" stays honest;
    # otherwise skip, so the 3-hourly job doesn't commit a new timestamp every run.
    if old and old.get('fetched_at') and old.get('features') == feats and old.get('period') == PERIOD:
        age = datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.fromisoformat(old['fetched_at'])
        if age < datetime.timedelta(hours=24):
            print(f'no change: {len(feats)} flood areas ({PERIOD})')
            return 0
    with open(OUT + '.tmp', 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(OUT + '.tmp', OUT)
    print(f'gistda-flood.json: {len(feats)} flood areas ({PERIOD}), {os.path.getsize(OUT) / 1024:.0f} KB')
    return 0


if __name__ == '__main__':
    sys.exit(main())
