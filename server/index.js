import dotenv from "dotenv";
dotenv.config();
import express from "express";
const app = express();
const PORT = process.env.PORT || 4000;
console.log("FIRMS_KEY loaded?", !!process.env.FIRMS_KEY);
// Helper to pad hour numbers, 0 -> "00", 3 -> "03"
const padHour = (h) => h.toString().padStart(2, "0");

// Fetch one hour snapshot: 00.json, 01.json, ... 23.json
async function fetchHourSnapshot(hour) {
  const url = `https://a.windbornesystems.com/treasure/${padHour(hour)}.json`;

  try {
    const res = await fetch(url, { timeout: 10_000 });
    if (!res.ok) {
      console.warn("Non-200 from treasure API", url, res.status);
      return null;
    }
    const data = await res.json();
    return data;
  } catch (err) {
    console.error("Error fetching", url, err.message);
    return null;
  }
}

// YOUR FORMAT: [lat, lon, altitude]
// We'll treat `balloonId` as the index in the array for that hour.
function normalizePoint(raw, snapshotTime, balloonIndex) {
  // Case 1: it's an array like [lat, lon, alt]
  if (Array.isArray(raw)) {
    if (raw.length < 2) return null;
    const [lat, lon, altitude] = raw;

    if (typeof lat !== "number" || typeof lon !== "number") return null;

    return {
      id: `balloon-${balloonIndex}`,
      lat,
      lon,
      altitude: typeof altitude === "number" ? altitude : null,
      timestamp: snapshotTime,
    };
  }

  // Case 2: if they ever change the format to an object, handle that too
  try {
    const id = raw.id ?? `balloon-${balloonIndex}`;
    const lat = raw.lat ?? raw.latitude;
    const lon = raw.lon ?? raw.longitude;
    const altitude = raw.alt ?? raw.altitude ?? null;

    if (typeof lat !== "number" || typeof lon !== "number") return null;

    return {
      id: String(id),
      lat,
      lon,
      altitude: typeof altitude === "number" ? altitude : null,
      timestamp: snapshotTime,
    };
  } catch {
    return null;
  }
}

// Build 24h flight histories by stitching together each hour's array of balloons
async function loadBalloonFlights() {
  const historiesById = new Map();
  const now = new Date();

  for (let hour = 0; hour < 24; hour++) {
    const snapshot = await fetchHourSnapshot(hour);
    if (!snapshot || !Array.isArray(snapshot)) {
      console.warn("Snapshot missing or not an array for hour", hour);
      continue;
    }

    // We'll treat this as "now - hour"
    const snapshotTime = new Date(
      now.getTime() - hour * 3600_000
    ).toISOString();

    // snapshot is like:
    // [
    //   [lat, lon, alt],   // balloon index 0
    //   [lat, lon, alt],   // balloon index 1
    //   ...
    // ]
    snapshot.forEach((rawEntry, index) => {
      const pt = normalizePoint(rawEntry, snapshotTime, index);
      if (!pt) return;

      if (!historiesById.has(pt.id)) historiesById.set(pt.id, []);
      historiesById.get(pt.id).push(pt);
    });
  }

  // Turn map into an array and sort the tracks by timestamp
  const flights = [];
  for (const [id, points] of historiesById.entries()) {
    // Sort oldest -> newest
    points.sort(
      (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
    );

    flights.push({
      id,
      latest: points[points.length - 1],
      track: points,
    });
  }

  return flights;
}

// Debug endpoint to check that everything works
app.get("/api/balloons", async (_req, res) => {
  try {
    const flights = await loadBalloonFlights();
    res.json({ flights });
  } catch (err) {
    console.error("Error in /api/balloons", err.message);
    res.status(500).json({ error: "Failed to load balloons" });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

// Compute a simple bounding box around all balloon points
function computeBounds(flights) {
  let minLat = 90,
    maxLat = -90,
    minLon = 180,
    maxLon = -180;

  for (const f of flights) {
    for (const p of f.track) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    }
  }

  const margin = 5;

  // apply margin
  minLat -= margin;
  maxLat += margin;
  minLon -= margin;
  maxLon += margin;

  // clamp to valid lat/lon ranges
  minLat = Math.max(minLat, -89.9);
  maxLat = Math.min(maxLat, 89.9);
  minLon = Math.max(minLon, -179.9);
  maxLon = Math.min(maxLon, 179.9);

  return { minLat, maxLat, minLon, maxLon };
}



function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function fetchFiresForBounds(bounds) {
  const key = process.env.FIRMS_KEY;
  const product = process.env.FIRMS_PRODUCT || "VIIRS_SNPP_NRT";

  if (!key) {
    console.warn("No FIRMS_KEY set; returning empty fires array");
    return [];
  }

  // Bounds already clamped in computeBounds
  const { minLat, minLon, maxLat, maxLon } = bounds;

  // FIRMS expects: west,south,east,north
  const areaCoords = `${minLon},${minLat},${maxLon},${maxLat}`;

  // Last 2 days of data (1..10 allowed)
  const dayRange = 2;

  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${product}/${areaCoords}/${dayRange}`;

  console.log("FIRMS URL:", url);

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn("FIRMS non-200", res.status);
      return [];
    }

    const text = await res.text();
    const lines = text.trim().split(/\r?\n/);
    if (lines.length <= 1) return [];

    const headers = lines[0].split(",");
    const fires = lines.slice(1).map((line) => {
      const cols = line.split(",");
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = cols[idx];
      });

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

    return fires.filter(Boolean);
  } catch (err) {
    console.error("Error fetching FIRMS fires", err.message);
    return [];
  }
}

function summarizeFlightsWithFires(flights, fires) {
  return flights.map((f) => {
    let minDist = Infinity;
    let closestFire = null;

    for (const p of f.track) {
      for (const fire of fires) {
        const d = haversineKm(p.lat, p.lon, fire.lat, fire.lon);
        if (d < minDist) {
          minDist = d;
          closestFire = fire;
        }
      }
    }

    return {
      ...f,
      fire_summary: {
        min_distance_km: isFinite(minDist) ? minDist : null,
        closest_fire: closestFire,
      },
    };
  });
}
app.get("/api/scene", async (_req, res) => {
  try {
    const flights = await loadBalloonFlights();
    if (!flights.length) {
      return res.json({
        flights: [],
        fires: [],
        bounds: null,
        generated_at: new Date().toISOString(),
      });
    }

    const bounds = computeBounds(flights);
    const fires = await fetchFiresForBounds(bounds);
    const flightsWithFires = summarizeFlightsWithFires(flights, fires);

    res.json({
      flights: flightsWithFires,
      fires,
      bounds,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Scene error", err.message);
    res.status(500).json({ error: "Failed to build scene" });
  }
});
