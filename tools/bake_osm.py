#!/usr/bin/env python3
"""Bake OpenStreetMap data for the service area into static files (stdlib only).

    python3 tools/bake_osm.py            # writes data/area.geojson, data/roads.geojson, data/factories.json

- area.geojson : the AMATA City Chonburi estate outlines (ESTATE_WAYS)
- roads.geojson: the estate's main roads, clipped to the estate outlines. Classes in ROAD_CLASSES;
                 residential roads only when the name says they belong to the estate. Service roads
                 (factory driveways) are left out.
- factories.json: named factories / companies / industrial sites for the search box
                 ([{n, en, lng, lat}]). OSM names only a few dozen here, so admins add the rest
                 in the app (table `places`).
The app only reads the baked files; it never calls Overpass at runtime.
Data © OpenStreetMap contributors (ODbL).
"""
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']
ESTATE_WAYS = [155314274, 504225667, 1267358004]   # Amata City Chonburi 2, main, 1
ROAD_CLASSES = {  # highway tag → rank (1 = through road, 2 = estate road)
    'trunk': 1, 'primary': 1, 'secondary': 1, 'tertiary': 1,
    'trunk_link': 1, 'primary_link': 1, 'secondary_link': 1, 'tertiary_link': 1,
    'unclassified': 2,
}
ESTATE_NAME_HINTS = ('อมตะ', 'Amata', 'นิคม')

# Main roads the user named (2026-09-28). Drawn along their whole length inside the service area,
# not only inside the estate. Match by OSM ref or exact name; the บ้านเก่า sois are not included.
NAMED_REFS = ('315', '3127', '3701', '3702', '3466', 'ชบ.3022', 'ชบ.3139')
NAMED_NAMES = ('บ้านเก่า 5', 'บ้านเก่า - หนองตำลึง', 'บ้านเก่า-หนองตำลึง')
# Estate roads by name (ถนนอมตะ / Amata Road and variants), also drawn in full so the links
# from the estate out to 3701/3702 aren't cut at the outline. Rank 2 (estate-road width).
ESTATE_NAME_RE = 'อมตะ|Amata'
# OSM tags that mark a factory / company / industrial site (search box).
FACTORY_FILTERS = ('building~"^(industrial|factory|warehouse|manufacture)$"', 'landuse=industrial',
                   'man_made=works', 'industrial', 'office=company')
# Service area (keep in sync with CONFIG.map.bounds and SQL in_area()): south, west, north, east.
BOUNDS = (13.36, 100.88, 13.56, 101.25)


def overpass(query):
    """Overpass is often busy (429/504): try each mirror a few times."""
    data = urllib.parse.urlencode({'data': query}).encode()
    last = None
    for attempt in range(3):
        for url in OVERPASS:
            try:
                req = urllib.request.Request(url, data=data, headers={'User-Agent': 'flood-map-bake/0.1'})
                with urllib.request.urlopen(req, timeout=90) as r:
                    return json.load(r)['elements']
            except Exception as e:  # noqa: BLE001 — network errors of every kind: retry
                last = e
                print(f'  {url}: {e}; retrying', file=sys.stderr)
        time.sleep(5 * (attempt + 1))
    raise SystemExit(f'Overpass failed: {last}')


def inside(pt, ring):
    """Ray casting; pt and ring are [lng, lat]."""
    x, y = pt
    hit = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def length_m(line):
    m = 0.0
    for (x1, y1), (x2, y2) in zip(line, line[1:]):
        m += math.hypot((x2 - x1) * 111320 * math.cos(math.radians(y1)), (y2 - y1) * 110540)
    return m


def clip(line, rings):
    """Split a line into runs inside any ring; each run keeps one vertex past the edge so it reaches the outline."""
    ins = [any(inside(p, r) for r in rings) for p in line]
    runs, cur = [], []
    for i, p in enumerate(line):
        near = ins[i] or (i > 0 and ins[i - 1]) or (i + 1 < len(line) and ins[i + 1])
        if near:
            cur.append(p)
        elif cur:
            runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    return [r for r in runs if len(r) >= 2]


def main():
    ways = ','.join(map(str, ESTATE_WAYS))
    estates = overpass(f'[out:json][timeout:60];way(id:{ways});out tags geom;')
    rings, area = [], []
    for e in estates:
        ring = [[round(p['lon'], 5), round(p['lat'], 5)] for p in e['geometry']]
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        rings.append(ring)
        area.append({'type': 'Feature', 'geometry': {'type': 'Polygon', 'coordinates': [ring]},
                     'properties': {'osm_id': e['id'], 'name': e['tags'].get('name'), 'name_en': e['tags'].get('name:en')}})

    def add(w, rank, clip_rings):
        nonlocal km
        tags = w['tags']
        line = [[round(p['lon'], 5), round(p['lat'], 5)] for p in w['geometry']]
        for run in clip(line, clip_rings):
            km += length_m(run) / 1000
            feats.append({'type': 'Feature', 'geometry': {'type': 'LineString', 'coordinates': run},
                          'properties': {'osm_id': w['id'], 'rank': rank, 'name': tags.get('name') or None, 'ref': tags.get('ref')}})

    feats, km = [], 0.0

    # 1. The named main roads, clipped to the service-area rectangle.
    s, w_, n, e = BOUNDS
    box = [[w_, s], [e, s], [e, n], [w_, n], [w_, s]]
    refs = '|'.join(r.replace('.', r'\\.') for r in NAMED_REFS)
    names = '|'.join(NAMED_NAMES)
    named = overpass(f'[out:json][timeout:80];(way[highway][ref~"^({refs})$"]({s},{w_},{n},{e});'
                     f'way[highway][name~"^({names})$"]({s},{w_},{n},{e});'
                     f'way[highway][~"^name(:en)?$"~"{ESTATE_NAME_RE}",i]({s},{w_},{n},{e}););out tags geom;')
    named_ids = set()
    for w in named:
        tags = w['tags']
        if tags.get('highway') not in ROAD_CLASSES and tags.get('highway') != 'residential':
            continue
        user_named = tags.get('ref') in NAMED_REFS or tags.get('name') in NAMED_NAMES
        named_ids.add(w['id'])
        add(w, 1 if user_named else 2, [box])
    print(f'named roads: {len(named_ids)} ways')

    # 2. The estate's own roads, clipped to the estate outlines (skipping ways already drawn above).
    roads = overpass(f'[out:json][timeout:60];way(id:{ways});map_to_area->.a;way(area.a)[highway];out tags geom;')
    for w in roads:
        if w['id'] in named_ids:
            continue
        tags = w['tags']
        hw = tags.get('highway')
        name = tags.get('name', '')
        rank = ROAD_CLASSES.get(hw)
        if rank is None and hw == 'residential' and any(h in name for h in ESTATE_NAME_HINTS):
            rank = 2
        if rank is None:
            continue
        add(w, rank, rings)

    # 3. Named factories for the search box (centre points).
    q = ''.join(f'nwr[name][{f}]({s},{w_},{n},{e});' for f in FACTORY_FILTERS)
    seen, factories = set(), []
    for el in overpass(f'[out:json][timeout:120];({q});out center tags;'):
        c = el.get('center') or {'lat': el.get('lat'), 'lon': el.get('lon')}
        if c['lat'] is None:
            continue
        name = el['tags']['name'].strip()
        key = (name, round(c['lat'], 3), round(c['lon'], 3))
        if key in seen:
            continue
        seen.add(key)
        factories.append({'n': name, 'en': el['tags'].get('name:en'), 'lng': round(c['lon'], 5), 'lat': round(c['lat'], 5)})
    factories.sort(key=lambda f: f['n'])
    fpath = os.path.join(ROOT, 'data', 'factories.json')
    with open(fpath + '.tmp', 'w', encoding='utf-8') as f:
        json.dump({'attribution': '© OpenStreetMap contributors (ODbL)', 'places': factories}, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(fpath + '.tmp', fpath)
    print(f'factories.json: {len(factories)} places')

    attribution = '© OpenStreetMap contributors (ODbL)'
    for fname, fc in (('area.geojson', area), ('roads.geojson', feats)):
        path = os.path.join(ROOT, 'data', fname)
        tmp = path + '.tmp'   # write then swap, so a page loading meanwhile never gets half a file
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump({'type': 'FeatureCollection', 'attribution': attribution, 'features': fc},
                      f, ensure_ascii=False, separators=(',', ':'))
        os.replace(tmp, path)
        print(f'{fname}: {len(fc)} features, {os.path.getsize(path) / 1024:.0f} KB')
    print(f'main roads: {km:.1f} km')


if __name__ == '__main__':
    sys.exit(main())
