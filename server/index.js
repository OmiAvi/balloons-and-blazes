// ------------------------------------------------------------
//  FAST, CACHED, PARALLELIZED SERVER FOR BALLOONS & BLAZES
// ------------------------------------------------------------

import dotenv from "dotenv";
import express from "express";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

// ESM-safe __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;

// Serve Vite build (client/dist)
const distPath = path.join(__dirname, "..", "client", "dist");
app.use(express.static(distPath));

console.log("FIRMS_KEY loaded?", !!process.env.FIRMS_KEY);

// ------------------------------------------------------------
//  HELPERS
// ------------------------------------------------------------

const padHour = (h) => h.toString().padStart(2, "0");

// Fetch a single hour snapshot
async function fetchHourSnapshot(hour) {
  const url = `https://a.windbornesystems.com/treasure/${padHour(hour)}.json`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function normalizePoint(raw, timestamp, index) {
  if (Array.isArray(raw)) {
    const [lat, lon, altitude] = raw;
    if (typeof lat !== "number" || typeof lon !== "number") return null;

    return {
      id: `balloon-${index}`,
      lat,
      lon,
      altitude: typeof altitude === "number" ? altitude : null,
      timestamp,
    };
  }

  try {
    const id = raw.id ?? `balloon-${index}`;
    const lat = raw.lat ?? raw.latitude;
    const lon = raw.lon ?? raw.longitude;
    const altitude = raw.alt ?? raw.altitude ?? null;

    if (typeof lat !== "number" || typeof lon !== "number") return null;

    return {
      id: String(id),
      lat,
      lon,
      altitude: typeof altitude === "number" ? altitude : null,
      timestamp,
    };
  } catch {
    return null;
  }
}

// Downsample long tracks to reduce payload & speed up calcs
function downsample(arr, every = 3) {
  if (arr.length <= 3) return arr;
  return arr.filter((_, i) => i % every === 0);
}

// Build all balloon flights (PARALLEL fetch)
async function loadBalloonFlights() {
  console.log("loadBalloonFlights: start");

  // 1. Fetch 24 snapshots IN PARALLEL
  const hours = [...Array(24).keys()];
  const snapshots = await Promise.all(hours.map(fetchHourSnapshot));

  const now = Date.now();
  const histories = new Map();

  // 2. Normalize and merge data
  snapshots.forEach((snapshot, hour) => {
    if (!snapshot || !Array.isArray(snapshot)) return;

    const timestamp = new Date(now - hour * 3600_000).toISOString();

    snapshot.forEach((raw, index) => {
      const pt = normalizePoint(raw, timestamp, index);
      if (!pt) return;

      if (!histories.has(pt.id)) histories.set(pt.id, []);
      histories.get(pt.id).push(pt);
    });
  });

  // 3. Sort and downsample tracks
  const flights = [];
  for (const [id, points] of histories) {
    points.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    flights.push({
      id,
      latest: points[points.length - 1],
      track: downsample(points, 3),
    });
  }

  console.log("loadBalloonFlights: done, flights:", flights.length);
  return flights;
}

// Compute bounding box around balloon tracks
function computeBounds(flights) {
  let minLat = 90,
    maxLat = -90,
    minLon = 180,
    maxLon = -180;

  for (const f of flights) {
    for (const p of f.track) {
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
      minLon = Math.min(minLon, p.lon);
      maxLon = Math.max(maxLon, p.lon);
    }
  }

  const margin = 1; // MUCH smaller region → fewer fires
  minLat = Math.max(minLat - margin, -89);
  maxLat = Math.min(maxLat + margin, 89);
  minLon = Math.max(minLon - margin, -179);
  maxLon = Math.min(maxLon + margin, 179);

  return { minLat, maxLat, minLon, maxLon };
}

// Fetch FIRMS fires (LIMIT output)
async function fetchFires(bounds) {
  const key = process.env.FIRMS_KEY;
  const product = process.env.FIRMS_PRODUCT || "VIIRS_SNPP_NRT";

  if (!key) {
    console.warn("No FIRMS_KEY - returning empty fires.");
    return [];
  }

  const { minLat, minLon, maxLat, maxLon } = bounds;

  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${product}/${minLon},${minLat},${maxLon},${maxLat}/2`;

  console.log("FIRMS URL:", url);

  try {
    const res = await fetch(url);
    if (!res.ok) return [];

    const text = await res.text();
    const lines = text.trim().split(/\r?\n/);
    if (lines.length <= 1) return [];

    const headers = lines[0].split(",");
    const fires = lines.slice(1).map((line) => {
      const cols = line.split(",");
      const obj = {};
      headers.forEach((h, i) => (obj[h] = cols[i]));

      const lat = parseFloat(obj.latitude);
      const lon = parseFloat(obj.longitude);
      if (isNaN(lat) || isNaN(lon)) return null;

      return {
        lat,
        lon,
        brightness: obj.brightness ? Number(obj.brightness) : null,
        confidence: obj.confidence ?? null,
        acq_date: obj.acq_date ?? null,
        acq_time: obj.acq_time ?? null,
        satellite: obj.satellite ?? null,
      };
    });

    // Keep only closest 300 to avoid huge payloads
    return fires.filter(Boolean).slice(0, 300);
  } catch (e) {
    console.error("FIRMS fetch error", e);
    return [];
  }
}

// Simple Haversine
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function summarizeFlights(flights, fires) {
  return flights.map((f) => {
    let minDist = Infinity;
    let closest = null;

    // Only compare f.latest to fires → MUCH faster
    for (const fire of fires) {
      const d = haversineKm(f.latest.lat, f.latest.lon, fire.lat, fire.lon);
      if (d < minDist) {
        minDist = d;
        closest = fire;
      }
    }

    return {
      ...f,
      fire_summary: {
        min_distance_km: isFinite(minDist) ? minDist : null,
        closest_fire: closest,
      },
    };
  });
}

// ------------------------------------------------------------
//  BUILD SCENE WITH 5-MIN CACHE
// ------------------------------------------------------------

let cachedScene = null;
let lastSceneTime = 0;

async function buildScene() {
  const flights = await loadBalloonFlights();
  if (!flights.length) return { flights: [], fires: [], bounds: null };

  const bounds = computeBounds(flights);
  const fires = await fetchFires(bounds);
  const flightsWithFires = summarizeFlights(flights, fires);

  return {
    flights: flightsWithFires,
    fires,
    bounds,
    generated_at: new Date().toISOString(),
  };
}

// ------------------------------------------------------------
//  API ROUTES
// ------------------------------------------------------------

app.get("/api/scene", async (req, res) => {
  try {
    const now = Date.now();

    if (cachedScene && now - lastSceneTime < 5 * 60 * 1000) {
      return res.json(cachedScene);
    }

    const scene = await buildScene();
    cachedScene = scene;
    lastSceneTime = now;

    res.json(scene);
  } catch (err) {
    console.error("Scene error", err);
    res.status(500).json({ error: "Failed to build scene" });
  }
});

// ------------------------------------------------------------
//  SPA FALLBACK (MUST BE LAST)
// ------------------------------------------------------------
app.get("*", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

// ------------------------------------------------------------

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});
