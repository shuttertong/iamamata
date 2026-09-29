# CLAUDE.md — "แผนที่น้ำท่วม" (Flood Map)

A crowd-sourced flood map of **AMATA City Chonburi and its surroundings** (Chonburi, Thailand), on a real map.
People can:
- report a **flooded spot**, or draw a **flooded stretch of road as a line**, with the water depth and photos;
- **ask for help** (SOS), giving what they need, how many people, and a private phone number.

Every report stays **pending** until an **admin confirms** it. Only confirmed reports are public.

Read this whole file before writing code. Follow **§9 Working Rules** at all times.

---

## 1. Product Decisions

| Item | Decision |
|---|---|
| Name | แผนที่น้ำท่วม (Flood Map) |
| Users | **Public**: view, report, ask for help, suggest edits. **Admin**: confirm / reject reports and edits, call people who asked for help, mark requests as helped, and **edit any active report directly** |
| Map | 2D web map (MapLibre GL + OpenStreetMap data). It must be fast on a phone with a weak signal and a low battery |
| Language | Thai first, English second. Fonts **Kanit** (headings) + **Sarabun** (body) |
| Moderation | Every report and every edit is `pending` until an admin reviews it. Nothing unreviewed is public except to its own reporter |
| Expiry | Confirmed reports expire automatically (`CONFIG.hours`: flood 12 h, help 24 h). People can say "น้ำลดแล้ว" / "ได้รับความช่วยเหลือแล้ว" |

### Report kinds
| Kind | What the reporter gives | On the map |
|---|---|---|
| **flood** (🌊 แจ้งน้ำท่วม) | a **spot** (draggable pin) **or a road line**, plus a depth level (required), a note and 0–3 photos. A road line is drawn by tapping points along the road, and its vertices can be dragged; ≤ 60 points, ≤ 5 km (`CONFIG.path`) | spot = circle in the depth colour; road = thick line in the depth colour |
| **help** (🆘 ขอความช่วยเหลือ) | a spot, needs (`trapped`, `medical`, `vulnerable`, `food`), people count, optional depth / note / photos, and a **private contact** (phone required, name optional) | red **SOS** pin (drawn on a canvas, no sprite server) |

Pending reports are drawn faded; a pending line is dashed.
The help form shows tap-to-call emergency numbers (1669, 1784, 199; `CONFIG.emergency`).
The admin queue lists help first. The admin **🆘 tab** lists approved open requests with the phone and a "ช่วยเหลือแล้ว" button.
A reporter can close their own report (help → `resolved`, flood → `expired`).
**Admin editor** (`src/adminedit.js`, the user's request 2026-09-28):
- Open it with the ✎ แก้ไข button on any card, or by **tapping a report on the admin map**.
- The admin can:
  - move the pin, edit a road line, or turn a spot into a line (or back);
  - change the depth, the needs and people count (help), and the note;
  - close the report (น้ำลดแล้ว / ช่วยเหลือแล้ว);
  - **take it off the map** with a reason; its photos are deleted.
- The admin tabs are: รอตรวจ, 🆘 รอช่วย, คำขอแก้ไข, **📋 ทั้งหมด** (every approved report), **🏭 โรงงาน** (the factory list behind search).

### Depth levels (`CONFIG.depths`)
A warning ramp, so severity reads from the first level (the user's request, 2026-09-28). Don't use blue: it looks calm and blends with water. Deeper water also draws a bigger dot.
| id | TH | Meaning | Colour |
|---|---|---|---|
| 1 | ข้อเท้า | ≤ 20 cm, walkable | yellow `#e8b800` |
| 2 | เข่า | 20–50 cm, cars should not pass | orange `#f57c00` |
| 3 | เอว | 50–100 cm | red `#e53935` |
| 4 | เกินเอว | > 1 m, dangerous | dark purple `#6a1b9a` |
Editing and drawing use blue (`#1565c0`), so they never look like a severity level.

### Factory search (the user's request, 2026-09-28)
A search box over the map, on both pages (`src/search.js`, `src/places.js`).
- Type a factory name in Thai or English. Matching drops company boilerplate (บริษัท / บจก. / จำกัด / Co., Ltd. / (Thailand)), spaces and punctuation; ranking is prefix > contains > all words.
- Picking a result flies to the factory and drops a pin. The public page then offers **"🌊 แจ้งน้ำท่วมที่นี่" / "🆘 ขอความช่วยเหลือที่นี่"**, which open the form with the pin already at the factory (`openReportForm(ctx, kind, { at })`).
- Names come from three sources (≈ 650 in total; the same name within ~150 m is listed once):
  - **`data/factories-moi.json`**: **Ministry of Industry open data**, "ที่ตั้งประกอบกิจการโรงงาน (ภาคตะวันออก)", GD Catalog `gdpublish-ops-13-041`, licence **Open Data Common**, data from 2023, with LAT/LNG. It gives ≈ 620 companies in the area (≈ 196 inside the AMATA outlines), each with what it makes and its sub-district. Baked by `python3 tools/bake_factories.py`.
    - **PDPA:** only juristic-person names are kept; factories registered under a person's name are skipped; the owner column is never read.
    - The attribution is shown on the map, and the result card says the location may be slightly off.
    - It has no English names. **English search works through sound matching** (`src/phonetic.js`): both the query and the Thai name are reduced to a rough sound key (shared consonants + one vowel "a", repeats merged; Thai lead vowels reordered; ์ silences a letter; a final English s or r is dropped).
      - Short all-letter queries are also tried spelled out in Thai letter names (NOK → เอ็นโอเค).
      - Scoring is per word of the name: an exact whole-word sound 0.95 > a prefix within tolerance 0.8 > every query word 0.85 > a sound inside the name 0.3 (queries of 5+ sounds only). Text matches (3/2/1) always rank above sound matches.
      - Tested (the right company comes first): Toyota, Toyota Tsusho, Daikin, Mitsubishi Elevator, NOK, Sumitomo, Dunlop, Kao, Summit, Tungaloy, Twin Cupids, City Steel.
      - Translated names don't match (Bangkok ≠ กรุงเทพ).
    - The DIW dataset `fac-eec-class3` was checked and not used: it has no coordinates and covers only factories outside estates;
  - `data/factories.json`: OSM, baked; ~40 named sites;
  - the **`places`** table: admins add names in the admin **🏭 โรงงาน** tab, one by one (tap the map / drag the pin), or by **CSV import** (`name, name_en, lat, lng`, UTF-8; quoted fields are OK; rows outside the area are skipped).
- OSM entries are read-only in the app.

### Rain outlook (the user's request, 2026-09-28, with windy.com as the example)
`src/rain.js`, settings in `CONFIG.rain`.
- A chip above the report buttons shows the chance of rain in the next 3 h: grey < 30 % < amber < 60 % < blue; purple "⛈️ ฝนหนัก" when an hour within 6 h has ≥ 10 mm.
- Tapping it opens a sheet with:
  - next-3 h chance, 24 h total mm, heavy hours, and a warning with the start time;
  - a 24-bar hourly chart (height = %, number = mm);
  - the **Windy** rain map embedded (`embed.windy.com/embed2.html`, ECMWF, rain overlay, centred on the area), plus a "เปิด Windy เต็มจอ" link.
- The forecast comes from the **Open-Meteo** API (free, no key, CC BY 4.0, credit shown). Its free tier is for **non-commercial use**; a commercial deployment needs their paid plan.
- **Rain radar on our map** (`src/radar.js`, `CONFIG.radar`): the **📡 เรดาร์ฝน** toggle above the rain chip.
  - It overlays **RainViewer** past radar (the last 12 frames, one every 10 min ≈ 2 h) at 50 % opacity, **under** the report layers.
  - It shows the frame time ("เรดาร์ 13:10 น. (ล่าสุด)", amber when not the latest) and a "ฝนเบา → หนัก" colour key. ▶ plays the 2 h once and rests on the latest frame; it refreshes every 10 min while on.
  - Turning it off removes every radar layer and source.
  - **Status line** (`src/radarscan.js`): the latest frame's z7 tiles are read in the browser (RainViewer tiles allow CORS) to say "🌧 มีฝนตกในพื้นที่ (~x%)", "ไม่มีฝนในพื้นที่ · กลุ่มฝนใกล้สุด ~N กม. ทาง…" or "ไม่มีฝนในรัศมี 120 กม." (`CONFIG.radar.scanKm`). An empty overlay otherwise looked broken to the user (2026-09-29: no rain in the area; nearest ~85 km SE).
  - RainViewer's free tier (since 2026-01) has **past frames only, tiles up to zoom 7** (MapLibre scales them up, so it looks blurry at street zoom, but radar is ~1 km anyway), Universal Blue colours, **personal / educational use**, and 100 requests per IP per minute. A commercial deployment needs another radar source.
- **Sea level / tides** (`src/tide.js`, `CONFIG.tide`; the user's request 2026-09-28): an Open-Meteo **Marine** model point off the Bang Pakong mouth (13.458, 100.875), hourly `sea_level_height_msl` (m above mean sea level; range here about −0.5 … +2 m).
  - The chip says "น้ำทะเลขึ้น/ลง · สูงสุด HH:MM (+x.x ม.)" and turns teal when the next high is ≥ `highM` (1.6 m).
  - Highs and lows are timed by a parabola through the hourly values. The sheet shows the level now, the trend, the next high, a 48 h SVG chart (now line, mean-sea-level line, labelled highs) and a table of the next 6 highs and lows.
  - **Rain + high-tide warning**: if heavy rain (≥ `rain.heavyMm`, or ≥ `highProb` % with ≥ `rainMm` mm) falls within ±2 h of a high ≥ 1.6 m, the chip turns red and the sheet explains that water drains to the sea slowly. The rain module calls `onUpdate` so the tide chip re-checks when the rain forecast arrives. Tested with a simulated 15 mm at 17:00 against a 17:19 high.
  - It is a model, **not the official tide table** (the Hydrographic Department uses chart datum, so its numbers differ). The credit and this note are shown.
- **Bang Pakong river level** (`src/river.js`, `CONFIG.river`; the user's request 2026-09-28): **ThaiWater** (คลังข้อมูลน้ำแห่งชาติ, HII) telemetry.
  - Endpoint: `api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_graph?station_type=tele_waterlevel&station_id=…&start_date&end_date`. It returns 10-min readings + `min_bank` + `ground_level`. `station_type` is required, or you get another station type with the same id. CORS is open.
  - Don't use `waterlevel_load` (all 803 stations, 1.4 MB, 240 KB gzipped) in the app.
  - Stations on the main river, downstream → upstream:
    - **BPK001 บางปะกง** (id 154, the main one: map marker "🏞 84%", chip, 3-day chart with the bank line);
    - BPK003 บางน้ำเปรี้ยว (151);
    - PRC002 เมืองปราจีนบุรี (160);
    - PRC005 ศรีมหาโพธิ (170).
  - % = (level − bed) / (bank − bed) × 100, ThaiWater's own measure; it matches their `storage_percent`. The bands are ≤10 น้อยวิกฤต, ≤30 น้อย, ≤70 ปกติ, ≤100 มาก, >100 ล้นตลิ่ง. The chip adds "ต้นน้ำล้นตลิ่ง n สถานี", and the sheet warns when the main station or any upstream station is over its bank.
  - BPK001 is tidal (near the mouth), and the panel says so.
  - Chart drawing is shared with the tide panel (`src/chart.js`; gaps in readings are not joined).
- These are runtime calls from the viewer's browser to open-meteo.com and marine-api.open-meteo.com (every 30 / 60 min), api-v3.thaiwater.net (4 stations every 20 min), windy.com (only when the sheet opens) and rainviewer.com (only while the radar is on); no personal data is sent.

### Service area (the user's choice, 2026-09-27)
**AMATA City Chonburi Industrial Estate and its surroundings**: Phan Thong, Nong Tamlueng, Don Hua Lo, Khlong Tamru and the Bang Pakong river mouth.
It comes from the user's Google Maps view (@13.4447, 101.0663), calibrated with two OSM landmarks (Phan Thong hospital, Wat Nong Tamlueng).
- `CONFIG.map.area` = W 100.914, S 13.388, E 101.219, N 13.526 (≈ 33 × 15 km). The first view fits it.
- `CONFIG.map.bounds` = W 100.88, S 13.36, E 101.25, N 13.56. This is the panning limit **and** the server-side check (SQL `in_area()`). **Keep `config.js`, SQL `in_area()` and `BOUNDS` in `tools/bake_osm.py` in sync.**
- `data/area.geojson`: the three AMATA estate polygons from OSM, drawn as a dashed outline. Static file, © OpenStreetMap contributors. The ways are 155314274 (project 2), 1267358004 (project 1) and 504225667.
- `data/roads.geojson`: **main roads, solid white with a thin dark-grey casing** so they are easy to read (the user's request, 2026-09-28). 521 segments, ≈ 260 km.
  - **Named roads the user listed**, drawn along their whole length inside the service area (`NAMED_REFS` / `NAMED_NAMES` in `tools/bake_osm.py`), rank 1:
    - **315** ถนนศุขประยูร;
    - **3127** (north through Phan Thong);
    - **3701**, **3702**;
    - **3466** ถนนบ้านเก่า–พานทอง;
    - **บ้านเก่า 5** (ชบ.3139);
    - **บ้านเก่า–หนองตำลึง** (ชบ.3022).
    The บ้านเก่า sois are not included.
  - **Estate roads**, clipped to the estate outlines:
    - OSM `secondary` / `tertiary` (+ links) = rank 1;
    - `unclassified` (mostly ถนนอมตะ) and estate-named `residential` = rank 2 (narrower);
    - `service` (≈ 1,380 factory driveways) is left out.
  - Layer order: above every basemap line/fill (bridges included, otherwise they would paint over the white), below every basemap label (road names stay readable), and below all report layers. Colours come from `CONFIG.map.roadColor` / `roadCasing`. The legend calls it "ถนนสายหลัก".
- Both files are baked by `python3 tools/bake_osm.py` (stdlib, Overpass with retries and a mirror, atomic file swap so a loading page never reads half a file). Roads named อมตะ / Amata are also drawn in full (rank 2), so the links out to 3701/3702 aren't cut at the estate outline. The app never calls Overpass at runtime.
- The report pin jumps to the device GPS **only when the device is inside the area**. Otherwise the pin would land off the locked map.

### Default chosen — still to confirm with the user
- **Login:** reporters use **Supabase anonymous sign-in + Cloudflare Turnstile** (no account; one random id per device). Anonymous sign-in needs **"Allow new users to sign up" ON** in Supabase Auth (GoTrue treats it as a signup); email sign-ups are harmless (same rights as a reporter, never admin). Admins log in with email + password. LINE Login may come later.

---

## 2. Tech Stack (fixed; ask before changing)

| Layer | Choice |
|---|---|
| Map | **MapLibre GL JS 4.7.1** (UMD from `cdn.jsdelivr.net`), style from **OpenFreeMap** (no key), raster OSM fallback |
| Frontend | Vanilla JS ES modules, HTML/CSS. **No bundler, no framework, no TypeScript** |
| Backend | **Supabase**: Postgres + **PostGIS**, Auth (anonymous + email), Storage (photos), Realtime |
| Security | **Row Level Security + column grants + `security definer` RPCs**. The browser is never trusted |
| Spam | **No limit on how often people report or suggest edits** (the user's choice, 2026-09-28): admins manage duplicates and spam with the review queue, the flags and the editor. Turnstile runs once per device, on anonymous sign-in. Don't add rate limits back without asking |
| Offline | IndexedDB outbox: a report made without a signal is sent when the device is back online |
| Hosting | **GitHub Pages (default, the user's repo `github.com/shuttertong/iamamata`, site `https://shuttertong.github.io/iamamata/`) + Supabase Singapore + GitHub Actions.** `.github/workflows/pages.yml` runs on push to main, by hand, or when called by refresh: `tools/build_web.py` → upload-pages-artifact(dist/web) → deploy-pages. Needs Settings → Pages → Source: GitHub Actions; free Pages requires a **public** repo (private needs GitHub Pro). `tools/build_web.py` injects `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `TURNSTILE_SITE_KEY` from the Actions **variables** (values are validated; a service_role key is refused), so `src/config.js` in git stays in demo mode. `.github/workflows/refresh-data.yml`: monthly bake_osm + bake_factories, commits `data/` if changed, then calls pages.yml (a GITHUB_TOKEN push doesn't trigger workflows). Alternative host: `.github/workflows/deploy.yml` uploads to **Hostinger** over FTPS (`SamKirkland/FTP-Deploy-Action@v4.4.0`); it is manual only. The build also writes `.htaccess` for Hostinger and `_headers` for Cloudflare. Step-by-step guide in Thai: `docs/DEPLOY.md`. No Python runs on any web server |
| Dev server | `python3 tools/serve.py 8010`: no-cache, HTTP/1.1, listen backlog 128. **Don't use plain `python3 -m http.server`**: its backlog of 5 overflows when the page loads ~15 modules in parallel. macOS then resets connections, and a random module or data file fails (a half-working page, e.g. white roads missing or the admin editor dead). It also lets the browser cache stale JS |

**Demo mode:** when `CONFIG.supabaseUrl` is empty, the public page shows a **yellow banner** (reports stay on this device and reach no one; call 1669 / 1784 for real help). The help form repeats the warning, and the build script prints a warning. **Never present a demo deployment as a working emergency service.** In demo mode, `src/api-demo.js` keeps all data in this browser. It uses localStorage key `floodmap.demo.v4` (bump it when the seed changes) and BroadcastChannel, so the admin tab and the public tab update each other. Any email and password log in as admin. The demo backend mirrors the SQL rules (area, path length, contact privacy). Use it for UI work and tests.

---

## 3. Data Model — `supabase/migrations/0001_init.sql`

The migration **has not been run anywhere yet**, so it can still be edited in place. Once it has been applied to a real project, every change goes into a new numbered migration.

**`flood_reports`**: `id, kind (flood | help), lat, lng, path, geom, depth, needs, people, note, photos, photo_taken_at, photo_hash, device_distance_m, status, reporter_id, created_at, expires_at, reviewed_by, reviewed_at, reject_reason`
- `path`: jsonb `[[lng, lat], …]`, or null. Flood only; `lat/lng` is then the middle vertex.
- `geom`: a Point or LineString, set by the trigger.
- `depth` 1–4, required for flood.
- `needs text[]`, `people`: help only.
- `note` ≤ 500 characters.
- `photos text[]` ≤ 3 storage paths.
- `photo_hash`: dHash, 16 hex digits.
- `status`: pending | approved | rejected | expired | resolved.

The trigger checks `in_area()` and `path_ok()` (raising `outside_area`), the 5 km line limit (`path_too_long`), and that photo paths are in the reporter's own folder.

**`help_contacts`**: `report_id, name, phone`.
- **Readable only by the reporter and admins**; never sent to the public map.
- Deleted when a request is rejected.
- A cron job (commented at the end of the migration) deletes contacts 30 days after the request is closed.

**`report_edits`**: suggestions against an **approved** report.
`id, report_id, kind (move | depth | receded | resolved), lat, lng, path, depth, status, proposer_id, created_at, reviewed_by, reviewed_at`

**`places`**: `id, name, name_en, lat, lng, created_by, created_at`. Factory names for search. Everyone can read; only admins write (`in_area` check).

**`admins`**: `user_id`. `is_admin()` checks it.

### Access rules (enforced in the database)
| Who | Can |
|---|---|
| Anyone (anon) | read `approved` reports that have not expired, and their photos. **No contacts** |
| Reporter (anonymous session) | insert a report (whitelisted columns only; status is always `pending`) and its help contact; read / drag / edit / delete **their own pending** report; close their own report (`close_report`); insert edit suggestions; upload photos into **their own folder** `<uid>/…` |
| Admin | read everything including contacts; `review_report()`, `review_edit()`, `close_report()`, **`admin_update_report(id, patch jsonb)`**, **`admin_remove_report(id, reason)`**; delete photos |

Status changes and admin edits happen **only** through the RPCs `review_report(id, approve, reason, hours)`, `review_edit(id, approve)`, `close_report(id)`, `admin_update_report(id, patch)` and `admin_remove_report(id, reason)`. The trigger re-checks the area and path on every edit.
If a help contact fails to save, the client deletes the report, so no request is left without a contact.

---

## 4. Photo Pipeline

1. `<input type="file" accept="image/*" capture="environment">` opens the rear camera on phones.
2. In the browser, `src/photo.js`:
   - reads the EXIF **DateTimeOriginal** (taken time) *before* re-encoding;
   - downsizes to `CONFIG.photo.maxSide` (1600 px), JPEG quality 0.7 (≈ 200–300 KB). **Re-encoding through a canvas drops all EXIF data, GPS included** (PDPA);
   - computes a 64-bit **dHash** so the admin can spot re-used or near-identical photos.
3. Upload to the **private** bucket `flood-photos` at `<uid>/<uuid>.jpg`.
4. Photos are visible (through signed URLs) only to the reporter and admins, and to everyone after approval.
5. On reject, the admin page deletes the photos. Rule: **no unreviewed photo is ever public.**
6. Location evidence comes from the **device GPS at report time**, not from the photo (iOS strips GPS from photos picked from the library).

Admin review flags (`CONFIG.review`):
- photo older than 6 h;
- pin more than 1 km from the device;
- no device GPS;
- similar photo (dHash distance ≤ 6);
- other reports within 50 m.

---

## 5. Project Structure

```
/
├── CLAUDE.md
├── README.md                  # setup guide (Thai): demo, Supabase, admin account, changing the area
├── docs/DEPLOY.md             # go-live guide (Thai): Pages → Supabase → Actions variables → checks (+ Hostinger appendix)
├── .github/workflows/         # pages.yml (build + GitHub Pages, default), refresh-data.yml (monthly bake + deploy), deploy.yml (Hostinger FTPS, manual)
├── index.html                 # public map (🌊 / 🆘 buttons, legend, bottom sheet)
├── admin.html                 # admin review (queue / 🆘 open requests / edit suggestions)
├── data/area.geojson          # AMATA estate outlines (OSM, baked)
├── data/roads.geojson         # main roads: the user's named roads + estate roads (OSM, baked)
├── data/factories.json        # named factories for search (OSM, baked)
├── data/factories-moi.json    # ≈ 620 companies with locations (Ministry of Industry open data, baked)
├── tools/bake_factories.py    # re-bakes factories-moi.json from GD Catalog
├── tools/build_web.py         # package the site for hosting (+ production config from env)
├── tools/serve.py             # no-cache dev server (stdlib)
├── tools/bake_osm.py          # re-bakes both data files from Overpass
├── .claude/launch.json        # preview config (tools/serve.py on 8010)
├── src/
│   ├── config.js              # every tunable value: area, depths, hours, path limits, needs, emergency numbers, photo, review flags
│   ├── i18n.js                # TH/EN strings, data-i18n, errText()
│   ├── ui.js                  # el(), toast(), time/length formatting, distM(), pathLength(), inArea(), bottom sheet, locate()
│   ├── map.js                 # MapLibre setup, area outline + white estate roads, report layers (circles, lines, SOS icon), showReport()
│   ├── draw.js                # geometry editor: pin, or tap-to-draw road line with draggable vertices
│   ├── api.js                 # picks the backend; queueOrder()
│   ├── api-supabase.js        # real backend
│   ├── api-demo.js            # in-browser backend + sample data
│   ├── photo.js               # EXIF time, compress, dHash
│   ├── outbox.js              # IndexedDB offline queue
│   ├── captcha.js             # Turnstile (only when configured) + sessionGate()
│   ├── report.js              # flood / help forms + move mode
│   ├── detail.js              # report detail sheet, actions, summary() shared with admin
│   ├── app.js                 # public page entry
│   ├── admin.js               # admin page entry (tabs, cards, flags)
│   ├── adminedit.js           # admin editor: move / redraw, depth, needs, note, close, remove
│   ├── adminplaces.js         # admin 🏭 tab: factory list, add/edit/delete, CSV import
│   ├── places.js              # factory names (OSM file + places table), search matching
│   ├── search.js              # search box UI over the map
│   ├── phonetic.js            # sound keys: English query ↔ Thai-script names
│   ├── rain.js                # rain chip + 24 h chart (Open-Meteo) + Windy embed
│   ├── radar.js               # rain radar overlay on our map (RainViewer), playback
│   ├── radarscan.js           # reads the latest radar frame: rain over the area / nearest rain
│   ├── tide.js                # sea level / tides (Open-Meteo Marine), rain + high-tide warning
│   ├── river.js               # Bang Pakong river level (ThaiWater stations), marker + chart + upstream
│   ├── chart.js               # shared SVG line chart (tide, river)
│   ├── panels.js              # fold-away legend / info column toggles
│   └── style.css
└── supabase/migrations/0001_init.sql
```

---

## 6. UX Rules
- One thumb: two big buttons at the bottom (🌊 blue, 🆘 red), bottom sheets, 44 px touch targets. On wide screens the sheet becomes a left side panel, and the map is padded so the sheet never covers the pin.
- **Fold-away panels** (`src/panels.js`, the user's request 2026-09-29): the legend and the rain/river/tide/radar column each have a toggle. The legend starts folded on small screens (`roomy()` = ≥ 800×700); the column starts open. The choice is remembered per device (`floodmap.panel.*`). A folded column keeps the radar overlay on.
- The report buttons and the legend hide while a sheet is open. Map taps add path points while drawing (`ctx.drawing`), so tapping a report doesn't open it then.
- User text is always inserted with `textContent` (never `innerHTML`), because reports are untrusted input.
- Show the time since a report everywhere ("20 นาทีที่แล้ว"); old information is dangerous in a flood.
- The help form always shows the emergency numbers. Don't make people wait for an admin when life is in danger.
- Keep "© OpenStreetMap contributors" visible.

---

## 7. Milestones

| # | Goal | Done when |
|---|---|---|
| F1 | Public map, flood spot + road line, help request, photos, demo mode | Reports of every kind can be made and seen on the map (demo) |
| F2 | Admin page: queue, flags, approve / reject, 🆘 tab, edit suggestions | Approve in one tab → it appears in the other tab |
| F3 | Supabase: migration, RLS, storage policies, anonymous sign-in, Turnstile | Every access rule in §3 verified from a second browser (esp. contacts never readable by others) |
| F4 | Offline outbox tested, expiry + contact-retention jobs (pg_cron), photo retention (scheduled Edge Function) | A report made in airplane mode arrives after reconnecting |
| F5 | Admin tools: blur faces / plates, merge duplicates, snap road lines to OSM roads | — |
| F6 | Deploy, custom domain, load test | The public URL works on a phone over 3G |

**Status (2026-09-28):** F1 and F2 are done and tested in demo mode. Main roads (the user's 7 named roads + estate roads) are highlighted in white (checked at z10–15.5, labels on top, flood lines readable over them). Demo sample data re-seeds itself after 6 h, so it never all expires; the user's own reports are kept. Bang Pakong river level works with live data (BPK001 84% น้ำมาก; three upstream stations over bank on 2026-09-28). Rain outlook works (Open-Meteo chip + chart, Windy embed loads). Rain radar overlay tested (12 frames, playback, off removes layers, layers under reports, RainViewer credit). English sound search is tested. Factory search has ≈ 650 names (Ministry of Industry + OSM); tested with โตโยต้า / ไดกิ / เอ็นโอเค / มิตซูบิชิ / สยาม. Factory search is tested: Thai with and without บจก./spaces, English, no-match message, Enter picks the result, "report here" opens the form at the factory, admin add + CSV import (2 good rows, 2 skipped, quoted comma) are searchable at once. The severity colour ramp is checked. Admin editing is tested (line redraw + depth, spot → line from a map tap, help needs/people, remove). Tested flows:
- a report with a photo → admin approves → it appears on the public map;
- "water receded" suggestion → admin approves → removed live in the other tab;
- road line: > 5 km is refused, undo works, sending works, a suggested new line shows as a preview on the admin page;
- help: form validation works, the phone number never appears in the public data, approve → mark helped → gone from the map;
- phone-width layout.

Not yet tested:
- the SQL against a real Supabase project;
- Turnstile;
- a real phone camera and EXIF;
- the offline outbox.

F3 needs a Supabase project; ask the user before creating one. No git commits yet.

---

## 8. Debugging
- Console handle `__flood`: `{ api, map, ctx, refresh, reports }` on the public page, `{ api, map, load, data }` on the admin page.
- Demo reset: `localStorage.removeItem('floodmap.demo.v3')`, then reload.
- In the preview pane, a hidden tab throttles `requestAnimationFrame`, so the map may not load until the tab is in front.

---

## 9. Working Rules for Claude

1. **Small modules**, about 400 lines max, one responsibility each.
2. **Data-driven:** thresholds, colours, texts, limits and emergency numbers live in `config.js` / `i18n.js`.
3. **Test in the browser after every change** (demo mode is enough for UI). Check the console. Never report something as done without running it.
4. **Security first:** a new table gets RLS + explicit grants. Never widen a policy to make the UI work. Anything added to `api-supabase.js` must also be allowed (or refused) by the SQL, and mirrored in `api-demo.js`.
5. **Privacy (PDPA):**
   - flood reporters give no personal data; the reporter id is a random anonymous id;
   - the only personal data is the help contact, which stays in `help_contacts` (reporter + admins only) and is deleted on reject or retention;
   - photo GPS is always stripped;
   - no tracking or analytics without asking.
6. **No new dependencies** beyond MapLibre and supabase-js without asking.
7. All user-facing strings go through `i18n.js` (TH + EN), including units.
8. **Map tiles:** don't hammer `tile.openstreetmap.org` in production (usage policy). Use OpenFreeMap, or a paid provider for launch.
9. **Git:** small commits like `feat(report): draggable pin` or `fix(rls): pending photos private`.

---

## 10. Quick Start for a New Session

```bash
python3 tools/serve.py 8010
# public map:  http://localhost:8010
# admin:       http://localhost:8010/admin.html   (demo: any email/password)
```
Supabase setup: see `README.md` (run the migration, enable anonymous sign-ins, add an admin with `insert into public.admins …`, fill `src/config.js`).
