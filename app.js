import { NEXRAD_STATIONS } from "./nexrad-stations.js";
import {
  MAPBOX_TOKEN,
  INITIAL_VIEW,
  FRAME_COUNT,
  FRAME_INTERVAL_MIN,
  FRAME_PLAYBACK_MS,
  LAST_FRAME_HOLD_MS,
  RADAR_OPACITY,
} from "./config.js";

mapboxgl.accessToken = MAPBOX_TOKEN;

const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/dark-v11",
  center: INITIAL_VIEW.center,
  zoom: INITIAL_VIEW.zoom,
  attributionControl: false,
  hash: true,
});
map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");
map.addControl(new mapboxgl.AttributionControl({ compact: true }));

// ───────── Radar frame URLs ─────────
// Iowa Environmental Mesonet hosts MRMS NEXRAD reflectivity tiles in EPSG:3857.
// Composite Base Reflectivity (n0q) at 5-min cadence — no API key required.
//   https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913-YYYYMMDDHHMI/{z}/{x}/{y}.png
const pad = (n) => String(n).padStart(2, "0");
function stamp(d) {
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes())
  );
}
function buildFrames() {
  const out = [];
  const now = new Date();
  now.setUTCSeconds(0, 0);
  now.setUTCMinutes(Math.floor(now.getUTCMinutes() / FRAME_INTERVAL_MIN) * FRAME_INTERVAL_MIN);
  // Lag one cadence so the most-recent tile is published.
  now.setUTCMinutes(now.getUTCMinutes() - FRAME_INTERVAL_MIN);
  for (let i = FRAME_COUNT - 1; i >= 0; i--) {
    const t = new Date(now.getTime() - i * FRAME_INTERVAL_MIN * 60_000);
    out.push({
      time: t,
      url: `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913-${stamp(t)}/{z}/{x}/{y}.png`,
    });
  }
  return out;
}

let frames = buildFrames();
let currentIdx = frames.length - 1;
let isPlaying = true;
let playTimer = null;

// ───────── Map setup ─────────
map.on("load", () => {
  // Add a raster layer per frame; toggle visibility via opacity for instant flips.
  frames.forEach((f, i) => {
    const id = `radar-${i}`;
    map.addSource(id, { type: "raster", tiles: [f.url], tileSize: 256, attribution: "NEXRAD via Iowa Environmental Mesonet" });
    map.addLayer({
      id,
      type: "raster",
      source: id,
      paint: {
        "raster-opacity": i === currentIdx ? RADAR_OPACITY : 0,
        "raster-opacity-transition": { duration: 0 },
        "raster-fade-duration": 0,
      },
    });
  });

  // Warning layers: tornado, severe t-storm, flash flood (fill + outline).
  for (const k of ["tor", "svr", "ffw"]) {
    map.addSource(`warn-${k}`, { type: "geojson", data: emptyFC() });
    map.addLayer({
      id: `warn-${k}-fill`,
      type: "fill",
      source: `warn-${k}`,
      paint: {
        "fill-color": warnColor(k),
        "fill-opacity": k === "tor" ? 0.18 : 0.1,
      },
    });
    map.addLayer({
      id: `warn-${k}-line`,
      type: "line",
      source: `warn-${k}`,
      paint: {
        "line-color": warnColor(k),
        "line-width": k === "tor" ? 2.4 : 1.8,
      },
    });
    map.on("click", `warn-${k}-fill`, (e) => showWarningCard(e.features[0]));
    map.on("mouseenter", `warn-${k}-fill`, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", `warn-${k}-fill`, () => (map.getCanvas().style.cursor = ""));
  }

  // Build timeline UI
  buildTimelineUI();

  // Kick off playback + alerts polling
  startPlayback();
  fetchAlerts();
  setInterval(fetchAlerts, 60_000);

  // Refresh the radar frame list every 5 min so the loop keeps sliding.
  setInterval(refreshFrames, 5 * 60_000);

  // HUD
  updateHud();
  map.on("move", updateHudLight);
  map.on("moveend", updateRegion);
  updateRegion();
});

function emptyFC() { return { type: "FeatureCollection", features: [] }; }
function warnColor(k) { return k === "tor" ? "#ff2424" : k === "svr" ? "#ffd000" : "#19c45a"; }

// ───────── Frame playback ─────────
function setFrame(i) {
  const prev = currentIdx;
  currentIdx = i;
  if (map.getLayer(`radar-${prev}`)) map.setPaintProperty(`radar-${prev}`, "raster-opacity", 0);
  if (map.getLayer(`radar-${i}`)) map.setPaintProperty(`radar-${i}`, "raster-opacity", RADAR_OPACITY);
  document.getElementById("timeline").value = String(i);
  updateHud();
}
function startPlayback() {
  stopPlayback();
  const tick = () => {
    if (!isPlaying) return;
    const isLast = currentIdx === frames.length - 1;
    const next = (currentIdx + 1) % frames.length;
    setFrame(next);
    playTimer = setTimeout(tick, isLast ? LAST_FRAME_HOLD_MS : FRAME_PLAYBACK_MS);
  };
  playTimer = setTimeout(tick, FRAME_PLAYBACK_MS);
}
function stopPlayback() { if (playTimer) { clearTimeout(playTimer); playTimer = null; } }

function refreshFrames() {
  const fresh = buildFrames();
  // If newest frame timestamp matches existing newest, skip.
  if (fresh[fresh.length - 1].time.getTime() === frames[frames.length - 1].time.getTime()) return;
  // Replace sources/layers in place.
  frames.forEach((_, i) => {
    if (map.getLayer(`radar-${i}`)) map.removeLayer(`radar-${i}`);
    if (map.getSource(`radar-${i}`)) map.removeSource(`radar-${i}`);
  });
  frames = fresh;
  // Insert beneath warning fills so polygons stay on top.
  const beforeId = map.getLayer("warn-tor-fill") ? "warn-tor-fill" : undefined;
  frames.forEach((f, i) => {
    map.addSource(`radar-${i}`, { type: "raster", tiles: [f.url], tileSize: 256 });
    map.addLayer({
      id: `radar-${i}`, type: "raster", source: `radar-${i}`,
      paint: { "raster-opacity": 0, "raster-fade-duration": 0 },
    }, beforeId);
  });
  currentIdx = frames.length - 1;
  setFrame(currentIdx);
  buildTimelineUI();
}

// ───────── Timeline UI ─────────
function buildTimelineUI() {
  const slider = document.getElementById("timeline");
  slider.max = String(frames.length - 1);
  slider.value = String(currentIdx);
  slider.oninput = (e) => {
    isPlaying = false;
    document.getElementById("play-toggle").textContent = "▶";
    setFrame(parseInt(e.target.value, 10));
  };
  document.getElementById("play-toggle").onclick = () => {
    isPlaying = !isPlaying;
    document.getElementById("play-toggle").textContent = isPlaying ? "⏸" : "▶";
    if (isPlaying) startPlayback(); else stopPlayback();
  };
}

// ───────── HUD ─────────
const tzShort = (() => {
  // Best-effort short tz like "CT" / "ET" based on user's locale.
  const parts = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(new Date());
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  // Compress "CDT"/"CST" to "CT" etc.
  return tz.replace(/([CEMP])[DS]T/, "$1T");
})();

function fmtTime(d) {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true }) + " " + tzShort;
}

function updateHud() {
  document.getElementById("hud-frame").textContent = fmtTime(frames[currentIdx].time);
  document.getElementById("hud-latest").textContent = fmtTime(frames[frames.length - 1].time);
  document.getElementById("hud-zoom").textContent = map.getZoom().toFixed(2);
  document.getElementById("hud-tower").textContent = nearestTower(map.getCenter()).id;
  const tl = document.getElementById("timeline-label");
  if (tl) tl.textContent = fmtTime(frames[currentIdx].time);
}
function updateHudLight() {
  document.getElementById("hud-zoom").textContent = map.getZoom().toFixed(2);
  document.getElementById("hud-tower").textContent = nearestTower(map.getCenter()).id;
}

function nearestTower(ll) {
  let best = null, bestD = Infinity;
  for (const [id, name, lat, lon] of NEXRAD_STATIONS) {
    const d = haversine(ll.lat, ll.lng, lat, lon);
    if (d < bestD) { bestD = d; best = { id, name, lat, lon, dist: d }; }
  }
  return best;
}
function haversine(la1, lo1, la2, lo2) {
  const R = 6371, toR = (x) => (x * Math.PI) / 180;
  const dLa = toR(la2 - la1), dLo = toR(lo2 - lo1);
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(toR(la1)) * Math.cos(toR(la2)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

let regionAbort = null;
async function updateRegion() {
  const c = map.getCenter();
  // Mapbox reverse geocoding; cheap and uses the same token.
  if (regionAbort) regionAbort.abort();
  regionAbort = new AbortController();
  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${c.lng},${c.lat}.json` +
      `?types=region,country&access_token=${encodeURIComponent(MAPBOX_TOKEN)}`;
    const r = await fetch(url, { signal: regionAbort.signal });
    if (!r.ok) return;
    const j = await r.json();
    const region = j.features?.find((f) => f.place_type?.includes("region"));
    const country = j.features?.find((f) => f.place_type?.includes("country"));
    const text = region?.text || country?.text || "—";
    document.getElementById("hud-region").textContent = text;
  } catch (_) { /* ignore */ }
}

// ───────── NWS active alerts ─────────
const ALERT_EVENTS = [
  "Tornado Warning",
  "Severe Thunderstorm Warning",
  "Flash Flood Warning",
  "Tornado Watch",
  "Severe Thunderstorm Watch",
];

function bucket(event) {
  if (event.startsWith("Tornado")) return "tor";
  if (event.startsWith("Severe Thunderstorm")) return "svr";
  if (event.startsWith("Flash Flood")) return "ffw";
  return null;
}

async function fetchAlerts() {
  try {
    const events = ALERT_EVENTS.map(encodeURIComponent).join(",");
    const url = `https://api.weather.gov/alerts/active?status=actual&message_type=alert&event=${events}`;
    const r = await fetch(url, { headers: { Accept: "application/geo+json" } });
    if (!r.ok) throw new Error("alerts " + r.status);
    const j = await r.json();
    const groups = { tor: [], svr: [], ffw: [] };
    let warningCount = 0;
    for (const f of j.features || []) {
      if (!f.geometry) continue;
      const k = bucket(f.properties?.event || "");
      if (!k) continue;
      groups[k].push(f);
      if ((f.properties?.event || "").endsWith("Warning")) warningCount++;
    }
    for (const k of ["tor", "svr", "ffw"]) {
      const src = map.getSource(`warn-${k}`);
      if (src) src.setData({ type: "FeatureCollection", features: groups[k] });
    }
    const badge = document.getElementById("alert-badge");
    if (warningCount > 0) {
      badge.hidden = false;
      document.getElementById("alert-count").textContent = String(warningCount);
    } else {
      badge.hidden = true;
    }
  } catch (e) {
    console.warn("alerts fetch failed:", e);
  }
}

// ───────── Warning card ─────────
function showWarningCard(feature) {
  const p = feature.properties || {};
  const k = bucket(p.event || "") || "tor";
  const card = document.getElementById("warning-card");
  card.classList.remove("tor", "svr", "ffw");
  card.classList.add(k);
  card.hidden = false;
  document.getElementById("wc-title").textContent = (p.event || "WARNING").toUpperCase();
  document.getElementById("wc-source").textContent = warningSource(p);
  document.getElementById("wc-hazard").textContent = warningHazard(p);
  document.getElementById("wc-areas").textContent = (p.areaDesc || "").replace(/;/g, ",");
  document.getElementById("wc-expires").textContent = warningExpires(p);
}
document.getElementById("wc-close").onclick = () => {
  document.getElementById("warning-card").hidden = true;
};

function param(p, key) {
  const v = p?.parameters?.[key];
  return Array.isArray(v) ? v[0] : v;
}
function warningSource(p) {
  const ev = p.event || "";
  if (ev.startsWith("Tornado")) {
    return (param(p, "tornadoDetection") || "RADAR INDICATED ROTATION").toUpperCase();
  }
  if (ev.startsWith("Severe Thunderstorm")) {
    return (param(p, "thunderstormDetection") || "RADAR INDICATED").toUpperCase();
  }
  if (ev.startsWith("Flash Flood")) {
    return (param(p, "flashFloodDetection") || "RADAR & RAINFALL INDICATED").toUpperCase();
  }
  return "RADAR INDICATED";
}
function warningHazard(p) {
  const ev = p.event || "";
  const hail = param(p, "maxHailSize");
  const wind = param(p, "maxWindGust");
  const bits = [];
  if (ev.startsWith("Tornado")) {
    bits.push("TORNADO");
    if (hail && hail !== "0.00") bits.push(`${hail.toUpperCase().includes("IN") ? hail : hail + " IN"} HAIL`);
  } else if (ev.startsWith("Severe Thunderstorm")) {
    if (wind) bits.push(`${wind.toUpperCase()} WIND`);
    if (hail) bits.push(`${hail} HAIL`);
    if (!bits.length) bits.push("DAMAGING WINDS & LARGE HAIL");
  } else if (ev.startsWith("Flash Flood")) {
    bits.push("LIFE-THREATENING FLOODING");
  } else {
    bits.push(ev.toUpperCase());
  }
  return bits.join(" AND ");
}
function warningExpires(p) {
  if (!p.expires) return "—";
  const ms = new Date(p.expires).getTime() - Date.now();
  if (ms <= 0) return "EXPIRED";
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} MINUTES FROM NOW`;
  const h = Math.floor(min / 60), m = min % 60;
  return `${h}H ${m}M FROM NOW`;
}

// Soft warning if the token wasn't replaced — map will fail silently otherwise.
if (!MAPBOX_TOKEN || MAPBOX_TOKEN.includes("REPLACE_WITH_YOUR")) {
  console.warn("Mapbox token not set. Edit config.js and add your public token from https://account.mapbox.com");
}
