import { NEXRAD_STATIONS } from "./nexrad-stations.js";
import {
  INITIAL_VIEW,
  FRAME_COUNT,
  FRAME_INTERVAL_MIN,
  FRAME_PLAYBACK_MS,
  LAST_FRAME_HOLD_MS,
  RADAR_OPACITY,
} from "./config.js";

// ───────── Map ─────────
const map = L.map("map", {
  zoomControl: false,
  zoomSnap: 0.25,
  zoomDelta: 0.5,
  wheelPxPerZoomLevel: 80,
  worldCopyJump: true,
}).setView(INITIAL_VIEW.center, INITIAL_VIEW.zoom);

L.control.zoom({ position: "bottomright" }).addTo(map);

L.tileLayer(
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  {
    subdomains: "abcd",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19,
    zIndex: 100,
  }
).addTo(map);

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
let radarLayers = [];
let currentIdx = frames.length - 1;
let isPlaying = true;
let playTimer = null;

function addRadarLayers() {
  radarLayers = frames.map((f, i) =>
    L.tileLayer(f.url, {
      opacity: i === currentIdx ? RADAR_OPACITY : 0,
      tileSize: 256,
      zIndex: 200,
      attribution: 'NEXRAD via <a href="https://mesonet.agron.iastate.edu/">Iowa Environmental Mesonet</a>',
    }).addTo(map)
  );
}
addRadarLayers();

// ───────── Warning layers ─────────
const warnColors = { tor: "#ff2424", svr: "#ffd000", ffw: "#19c45a" };
const warnLayers = {};
for (const k of ["tor", "svr", "ffw"]) {
  warnLayers[k] = L.geoJSON(null, {
    style: () => ({
      color: warnColors[k],
      weight: k === "tor" ? 2.4 : 1.8,
      fillColor: warnColors[k],
      fillOpacity: k === "tor" ? 0.18 : 0.1,
    }),
    onEachFeature: (feature, layer) => {
      layer.on("click", () => showWarningCard(feature));
    },
  }).addTo(map);
  // Leaflet GeoJSON layer doesn't take zIndex directly; pane it.
  warnLayers[k].setZIndex && warnLayers[k].setZIndex(400);
}

// ───────── Animation ─────────
function setFrame(i) {
  const prev = currentIdx;
  currentIdx = i;
  if (radarLayers[prev]) radarLayers[prev].setOpacity(0);
  if (radarLayers[i]) radarLayers[i].setOpacity(RADAR_OPACITY);
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
  if (fresh[fresh.length - 1].time.getTime() === frames[frames.length - 1].time.getTime()) return;
  radarLayers.forEach((l) => map.removeLayer(l));
  frames = fresh;
  addRadarLayers();
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
  const parts = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(new Date());
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
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

// ───────── Region (Nominatim reverse geocoding) ─────────
const regionCache = new Map();
let regionTimer = null;
function updateRegion() {
  const c = map.getCenter();
  const key = `${c.lat.toFixed(1)},${c.lng.toFixed(1)}`;
  if (regionCache.has(key)) {
    document.getElementById("hud-region").textContent = regionCache.get(key);
    return;
  }
  if (regionTimer) clearTimeout(regionTimer);
  regionTimer = setTimeout(async () => {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&zoom=5&lat=${c.lat}&lon=${c.lng}`;
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      if (!r.ok) return;
      const j = await r.json();
      const text =
        j.address?.state ||
        j.address?.region ||
        j.address?.country ||
        "—";
      regionCache.set(key, text);
      document.getElementById("hud-region").textContent = text;
    } catch (_) { /* ignore */ }
  }, 600);
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
      warnLayers[k].clearLayers();
      warnLayers[k].addData({ type: "FeatureCollection", features: groups[k] });
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
    if (hail && hail !== "0.00") bits.push(`${String(hail).toUpperCase().includes("IN") ? hail : hail + " IN"} HAIL`);
  } else if (ev.startsWith("Severe Thunderstorm")) {
    if (wind) bits.push(`${String(wind).toUpperCase()} WIND`);
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

// ───────── Wire-up ─────────
buildTimelineUI();
startPlayback();
fetchAlerts();
setInterval(fetchAlerts, 60_000);
setInterval(refreshFrames, 5 * 60_000);
updateHud();
updateRegion();
map.on("move", updateHudLight);
map.on("moveend", updateRegion);
