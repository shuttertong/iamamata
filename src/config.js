// Every tunable value lives here.
// Leave supabaseUrl empty to run in demo mode (data stays in this browser only).
export const CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',          // the public "anon" key — never the service_role key
  turnstileSiteKey: '',         // Cloudflare Turnstile; also enable CAPTCHA in Supabase Auth settings

  map: {
    style: 'https://tiles.openfreemap.org/styles/liberty',
    // Service area (user's map view, 2026-09-27): AMATA City Chonburi + Phan Thong, Nong Tamlueng,
    // Don Hua Lo and the Bang Pakong river mouth. [[west, south], [east, north]]; the first view fits it.
    area: [[100.914, 13.388], [101.219, 13.526]],
    bounds: [[100.88, 13.36], [101.25, 13.56]],   // how far people can pan; keep in sync with the SQL trigger
    minZoom: 10,
    outline: 'data/area.geojson',                 // AMATA estate outlines from OSM
    // Main estate roads (tools/bake_osm.py), drawn solid white with a dark casing so they stand out.
    roads: 'data/roads.geojson',
    // Factory names for search: OSM (tools/bake_osm.py) + Ministry of Industry open data (tools/bake_factories.py).
    // Admins add more in the app (table places).
    factories: ['data/factories-moi.json', 'data/factories.json'],
    roadColor: '#ffffff',
    roadCasing: '#4f5b66',
  },

  // Warning ramp: severity must read from the first level (no blue: it looks calm and blends with water).
  depths: [
    { id: 1, key: 'depth.1', color: '#e8b800' },   // yellow  — caution
    { id: 2, key: 'depth.2', color: '#f57c00' },   // orange
    { id: 3, key: 'depth.3', color: '#e53935' },   // red
    { id: 4, key: 'depth.4', color: '#6a1b9a' },   // dark purple — most dangerous
  ],

  // How long a confirmed report stays on the map (hours).
  hours: { flood: 12, help: 24 },
  noteMax: 500,

  // Flooded roads can be drawn as a path (tap to add points).
  path: { maxPoints: 60, maxKm: 5 },

  // Help requests (ขอความช่วยเหลือ). Keys must match the SQL check on flood_reports.needs.
  help: { color: '#d50000', peopleMax: 500 },
  needs: ['trapped', 'medical', 'vulnerable', 'food'],
  // Emergency numbers shown on the help form (tap to call).
  emergency: [
    { tel: '1669', key: 'emg.1669' },
    { tel: '1784', key: 'emg.1784' },
    { tel: '199', key: 'emg.199' },
  ],
  photo: { max: 3, maxSide: 1600, quality: 0.7, maxInputMB: 15 },
  review: { staleHours: 6, farKm: 1, nearM: 50, similarBits: 6 },
  refreshMs: 60000,

  // Rain outlook (src/rain.js): Open-Meteo hourly forecast for the area centre + the Windy rain map.
  rain: {
    lat: 13.457, lng: 101.066,      // centre of CONFIG.map.area
    refreshMin: 30,
    midProb: 30, highProb: 60,      // chance of rain (%) → amber / red chip
    heavyMm: 10,                    // mm in one hour counted as heavy rain
    windyZoom: 9,
  },

  // Sea level / tides (src/tide.js): Open-Meteo Marine model point off the Bang Pakong river mouth.
  tide: {
    lat: 13.458, lng: 100.875,
    days: 3, refreshMin: 60,
    highM: 1.6,          // a high tide at or above this (m above mean sea level) counts as high water
    rainWindowH: 2,      // warn when heavy rain falls within ± this many hours of high water
    rainMm: 5,           // …or likely rain (≥ highProb %) of at least this many mm/h
  },

  // Bang Pakong river level (src/river.js): ThaiWater telemetry stations on the main river, downstream → upstream.
  // `main` is the station nearest us (marker, chip, 3-day chart). Names are the stations' official names.
  river: {
    days: 3, refreshMin: 20, trendM: 0.02,
    stations: [
      { id: 154, code: 'BPK001', name: 'บางปะกง', river: 'แม่น้ำบางปะกง', lat: 13.54901, lng: 101.00111, main: true },
      { id: 151, code: 'BPK003', name: 'บางน้ำเปรี้ยว', river: 'ฉะเชิงเทรา', lat: 13.87032, lng: 101.14574 },
      { id: 160, code: 'PRC002', name: 'เมืองปราจีนบุรี', river: 'ปราจีนบุรี', lat: 14.05355, lng: 101.38684 },
      { id: 170, code: 'PRC005', name: 'ศรีมหาโพธิ', river: 'ปราจีนบุรี', lat: 13.97348, lng: 101.51751 },
    ],
  },

  // GISTDA satellite flood areas (src/gistda.js), baked every 3 h by .github/workflows/gistda.yml.
  gistda: { file: 'data/gistda-flood.json', color: '#3949ab', refreshMin: 30 },

  // Rain radar overlay (src/radar.js): RainViewer past radar, free tier (max zoom 7, past ~2 h).
  radar: { frames: 12, opacity: 0.5, color: 2, frameMs: 700, refreshMin: 10, scanKm: 120 },   // scanKm: how far to look for the nearest rain
};
