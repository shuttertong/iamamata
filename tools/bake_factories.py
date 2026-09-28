#!/usr/bin/env python3
"""Bake factory names + locations from Thai government open data (stdlib only).

    python3 tools/bake_factories.py      # writes data/factories-moi.json

Source: "ที่ตั้งประกอบกิจการโรงงาน (ภาคตะวันออก)", Ministry of Industry (Office of the Permanent
Secretary), GD Catalog dataset gdpublish-ops-13-041, licence Open Data Common. Columns used:
FNAME (factory name), OBJECT (business), FTUMNAME / FAMPNAME (sub-district / district), LAT, LNG, STATUS.

Privacy (PDPA): only juristic-person names are kept (บริษัท, หจก., สหกรณ์ …). Factories registered
under a person's name are skipped, and the owner column (ONAME) is never read.
The app only reads the baked file; it never calls the government site at runtime.
"""
import csv
import io
import json
import os
import re
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = ('https://industry.gdcatalog.go.th/dataset/a4e85b60-3fd5-4c50-9450-5e139cb1b0e1/'
       'resource/ea528109-ad46-401d-8b38-b928cfa232b2/download/eastern.csv')
# Service area (keep in sync with CONFIG.map.bounds, SQL in_area() and tools/bake_osm.py): S, W, N, E.
BOUNDS = (13.36, 100.88, 13.56, 101.25)
JURISTIC = re.compile(r'บริษัท|บจก|บมจ|ห้างหุ้นส่วน|หจก|สหกรณ์|จำกัด|มูลนิธิ|องค์การ|การไฟฟ้า|การประปา'
                      r'|co\.|ltd|limited|inc\.|corporation', re.I)
PERSON = re.compile(r'^\s*(นาย|นาง|นางสาว|น\.ส\.|ด\.ช\.|ด\.ญ\.|mr\.?|mrs\.?|ms\.?)\s', re.I)


def fetch(url):
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'flood-map-bake/0.1'})
            with urllib.request.urlopen(req, timeout=180) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 — retry any network error
            last = e
            print(f'  {e}; retrying', file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    raise SystemExit(f'download failed: {last}')


def main():
    raw = fetch(URL)
    for enc in ('utf-8-sig', 'cp874'):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    s, w, n, e = BOUNDS
    places, seen, skipped_person = [], set(), 0
    for row in csv.DictReader(io.StringIO(text)):
        try:
            lat, lng = float(row['LAT']), float(row['LNG'])
        except (TypeError, ValueError):
            continue
        if not (s <= lat <= n and w <= lng <= e):
            continue
        name = ' '.join((row.get('FNAME') or '').split())
        if not name:
            continue
        if PERSON.match(name) or not JURISTIC.search(name):
            skipped_person += 1
            continue
        key = (name, round(lat, 4), round(lng, 4))
        if key in seen:
            continue
        seen.add(key)
        what = ' '.join((row.get('OBJECT') or '').split())
        area = ' '.join(x for x in (row.get('FTUMNAME'), row.get('FAMPNAME')) if x)
        places.append({'n': name, 'd': (what[:70] + '…') if len(what) > 70 else what or None,
                       'a': area or None, 'lng': round(lng, 5), 'lat': round(lat, 5)})
    places.sort(key=lambda p: p['n'])
    out = {
        'src': 'moi',
        'attribution': 'ข้อมูลที่ตั้งโรงงาน: สำนักงานปลัดกระทรวงอุตสาหกรรม (Open Data Common)',
        'dataset': 'https://gdcatalog.go.th/dataset/gdpublish-ops-13-041',
        'places': places,
    }
    path = os.path.join(ROOT, 'data', 'factories-moi.json')
    with open(path + '.tmp', 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    os.replace(path + '.tmp', path)
    print(f'factories-moi.json: {len(places)} places, {os.path.getsize(path) / 1024:.0f} KB '
          f'(skipped {skipped_person} registered under a person or without a company name)')


if __name__ == '__main__':
    sys.exit(main())
