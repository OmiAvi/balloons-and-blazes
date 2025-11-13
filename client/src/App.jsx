"use client"

import { useEffect, useState, useMemo } from "react"
import L from "leaflet"
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from "react-leaflet"

// Auto-fit the map to the selected balloon track
function FitToTrack({ positions }) {
  const map = useMap()

  useEffect(() => {
    if (!positions || !positions.length) return
    map.fitBounds(positions, { padding: [40, 40] })
  }, [positions, map])

  return null
}

function App() {
  const [scene, setScene] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [animIndex, setAnimIndex] = useState(0) // for animated balloon marker
  const [sortBy, setSortBy] = useState("id") // "id" | "fire"

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/scene")
        if (!res.ok) throw new Error(`Failed to load scene: ${res.status}`)
        const data = await res.json()
        setScene(data)
        if (data.flights?.length) {
          setSelectedId((prev) => prev ?? data.flights[0].id)
        }
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    load()

    // Refresh every 5 minutes to keep it "live"
    const id = setInterval(load, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  const flights = useMemo(() => scene?.flights || [], [scene?.flights])
  const fires = useMemo(() => scene?.fires || [], [scene?.fires])
  const selected = flights.find((f) => f.id === selectedId) || flights[0] || null

  // Sort flights based on sortBy
  const sortedFlights = useMemo(() => {
    const list = [...flights]
    if (sortBy === "fire") {
      list.sort((a, b) => {
        const da =
          typeof a.fire_summary?.min_distance_km === "number"
            ? a.fire_summary.min_distance_km
            : Number.POSITIVE_INFINITY
        const db =
          typeof b.fire_summary?.min_distance_km === "number"
            ? b.fire_summary.min_distance_km
            : Number.POSITIVE_INFINITY
        return da - db // nearest fires first
      })
    } else {
      list.sort((a, b) => a.id.localeCompare(b.id))
    }
    return list
  }, [flights, sortBy])

  // Center the map at the selected balloon's latest position
  const mapCenter = useMemo(() => {
    if (!selected) return [0, 0]
    return [selected.latest.lat, selected.latest.lon]
  }, [selected])

  const trackPositions = useMemo(() => (selected ? selected.track.map((p) => [p.lat, p.lon]) : []), [selected])

  // Animate the balloon marker along the track
  useEffect(() => {
    if (!trackPositions.length) return
    setAnimIndex(0)
    const id = setInterval(() => {
      setAnimIndex((prev) => (prev + 1) % trackPositions.length)
    }, 400) // speed in ms
    return () => clearInterval(id)
  }, [trackPositions])

  if (loading) return <div className="p-4">Loading Balloons &amp; Blazes…</div>
  if (error)
    return (
      <div className="p-4" style={{ color: "red" }}>
        Error: {error}
      </div>
    )
  if (!scene || !scene.flights?.length) return <div className="p-4">No flights found.</div>

  // Emoji icons
  const fireIcon = L.divIcon({
    html: "🔥",
    className: "fire-icon",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })

  const balloonIcon = L.divIcon({
    html: "🎈",
    className: "balloon-icon",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <aside
        style={{
          width: "30%",
          background: "linear-gradient(135deg, #1a1a1a 0%, #2d1810 50%, #1a1a1a 100%)",
          borderRight: "2px solid #ea580c",
          padding: "2rem 1.5rem",
          boxSizing: "border-box",
          boxShadow: "inset -2px 0 12px rgba(234, 88, 12, 0.15)",
        }}
      >
        <h1
          style={{
            fontSize: "1.75rem",
            marginBottom: "0.5rem",
            background: "linear-gradient(to right, #fbbf24, #f97316)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            fontWeight: 700,
            letterSpacing: "0.5px",
          }}
        >
          Balloons &amp; Blazes
        </h1>
        <p
          style={{
            fontSize: "0.95rem",
            color: "#cbd5e1",
            lineHeight: 1.6,
            marginBottom: "1.5rem",
          }}
        >
          Brings together live WindBorne balloon tracks with NASA wildfire data to show how the atmosphere behaves around major heat events. By watching balloon paths near active fires, we can better understand local wind patterns, smoke-driven convection, and rapidly changing conditions that influence forecasting and routing.
        </p>

        <div
          style={{
            fontSize: "0.85rem",
            color: "#f97316",
            marginBottom: "1.5rem",
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}
        >
          🎈 Balloons: {flights.length} · 🔥 Fires: {fires.length}
        </div>

        <div
          style={{
            fontSize: "0.8rem",
            marginBottom: "1.5rem",
            display: "flex",
            gap: "0.75rem",
            alignItems: "center",
            color: "#cbd5e1",
          }}
        >
          Sort by:{" "}
          <button
            onClick={() => setSortBy("id")}
            style={{
              fontSize: "0.75rem",
              padding: "0.5rem 0.75rem",
              borderRadius: "6px",
              border: sortBy === "id" ? "2px solid #f97316" : "1px solid #475569",
              backgroundColor: sortBy === "id" ? "rgba(249, 115, 22, 0.15)" : "transparent",
              color: sortBy === "id" ? "#fbbf24" : "#cbd5e1",
              cursor: "pointer",
              fontWeight: 500,
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              if (sortBy !== "id") {
                e.target.style.borderColor = "#f97316"
                e.target.style.backgroundColor = "rgba(249, 115, 22, 0.08)"
              }
            }}
            onMouseLeave={(e) => {
              if (sortBy !== "id") {
                e.target.style.borderColor = "#475569"
                e.target.style.backgroundColor = "transparent"
              }
            }}
          >
            ID
          </button>
          <button
            onClick={() => setSortBy("fire")}
            style={{
              fontSize: "0.75rem",
              padding: "0.5rem 0.75rem",
              borderRadius: "6px",
              border: sortBy === "fire" ? "2px solid #f97316" : "1px solid #475569",
              backgroundColor: sortBy === "fire" ? "rgba(249, 115, 22, 0.15)" : "transparent",
              color: sortBy === "fire" ? "#fbbf24" : "#cbd5e1",
              cursor: "pointer",
              fontWeight: 500,
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              if (sortBy !== "fire") {
                e.target.style.borderColor = "#f97316"
                e.target.style.backgroundColor = "rgba(249, 115, 22, 0.08)"
              }
            }}
            onMouseLeave={(e) => {
              if (sortBy !== "fire") {
                e.target.style.borderColor = "#475569"
                e.target.style.backgroundColor = "transparent"
              }
            }}
          >
            Proximity
          </button>
        </div>

        <ul
          style={{
            marginTop: "0rem",
            listStyle: "none",
            padding: 0,
            maxHeight: "60vh",
            overflowY: "auto",
            fontSize: "0.9rem",
            scrollBehavior: "smooth",
          }}
        >
          {sortedFlights.map((f) => (
            <li
              key={f.id}
              onClick={() => setSelectedId(f.id)}
              style={{
                marginBottom: "0.75rem",
                padding: "1rem",
                borderRadius: "8px",
                border: selectedId === f.id ? "2px solid #f97316" : "1px solid #475569",
                background:
                  selectedId === f.id
                    ? "linear-gradient(135deg, rgba(249, 115, 22, 0.2) 0%, rgba(251, 191, 36, 0.1) 100%)"
                    : "rgba(51, 65, 85, 0.3)",
                cursor: "pointer",
                transition: "all 0.25s ease",
                backdropFilter: "blur(10px)",
              }}
              onMouseEnter={(e) => {
                if (selectedId !== f.id) {
                  e.currentTarget.style.borderColor = "#f97316"
                  e.currentTarget.style.background = "rgba(107, 114, 128, 0.4)"
                  e.currentTarget.style.transform = "translateX(4px)"
                }
              }}
              onMouseLeave={(e) => {
                if (selectedId !== f.id) {
                  e.currentTarget.style.borderColor = "#475569"
                  e.currentTarget.style.background = "rgba(51, 65, 85, 0.3)"
                  e.currentTarget.style.transform = "translateX(0)"
                }
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  color: "#fbbf24",
                  fontSize: "1rem",
                  marginBottom: "0.35rem",
                }}
              >
                {f.id}
              </div>
              <div
                style={{
                  fontSize: "0.8rem",
                  color: "#a1afc9",
                  marginBottom: "0.35rem",
                }}
              >
                Points: {f.track.length}
              </div>
              {f.fire_summary?.min_distance_km != null && (
                <div
                  style={{
                    fontSize: "0.8rem",
                    marginTop: "0.35rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.4rem",
                  }}
                >
                  <span style={{ color: "#cbd5e1" }}>🔥 Nearest:</span>
                  <span
                    style={{
                      fontWeight: 600,
                      color: f.fire_summary.min_distance_km < 10 ? "#ff6b35" : "#fbbf24",
                    }}
                  >
                    {f.fire_summary.min_distance_km.toFixed(1)} km
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {/* Map */}
        <div style={{ flex: 1, minHeight: "50vh" }}>
          <MapContainer center={mapCenter} zoom={4} scrollWheelZoom={true} style={{ width: "100%", height: "100%" }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {/* Auto-fit map to selected track */}
            {trackPositions.length > 0 && <FitToTrack positions={trackPositions} />}

            {/* Selected balloon track + animated balloon */}
            {trackPositions.length > 0 && (
              <>
                <Polyline positions={trackPositions} />
                <Marker position={trackPositions[animIndex]} icon={balloonIcon}>
                  <Popup>
                    <div style={{ fontSize: "0.75rem" }}>
                      <strong>{selected.id}</strong>
                      <div>
                        Lat: {trackPositions[animIndex][0].toFixed(3)}, Lon: {trackPositions[animIndex][1].toFixed(3)}
                      </div>
                    </div>
                  </Popup>
                </Marker>
              </>
            )}

            {/* Fires as fire-emoji markers */}
            {fires.map((fire, idx) => (
              <Marker key={idx} position={[fire.lat, fire.lon]} icon={fireIcon}>
                <Popup>
                  <div style={{ fontSize: "0.75rem" }}>
                    <div>
                      <strong>Fire hotspot</strong>
                    </div>
                    {fire.acq_date && <div>Date: {fire.acq_date}</div>}
                    {fire.acq_time && <div>Time: {fire.acq_time}</div>}
                    {fire.brightness && <div>Brightness: {fire.brightness}</div>}
                    {fire.confidence && <div>Confidence: {fire.confidence}</div>}
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>

        {/* Selected balloon details */}
        <div
          style={{
            borderTop: "1px solid #eee",
            padding: "0.75rem 1rem",
            fontSize: "0.8rem",
            maxHeight: "40vh",
            overflowY: "auto",
          }}
        >
          <h2 style={{ margin: 0, marginBottom: "0.5rem", fontSize: "1rem" }}>{selected.id} details</h2>
          <div style={{ marginBottom: "0.5rem", color: "#555" }}>
            Latest position: lat {selected.latest.lat.toFixed(3)}, lon {selected.latest.lon.toFixed(3)}{" "}
            {selected.latest.altitude != null && `(alt ${selected.latest.altitude.toFixed(1)}m)`}
          </div>
          {selected.fire_summary && (
            <div style={{ marginBottom: "0.5rem" }}>
              <strong>Fire proximity:</strong>{" "}
              {selected.fire_summary.min_distance_km != null
                ? `${selected.fire_summary.min_distance_km.toFixed(1)} km to nearest hotspot`
                : "No fires found in region"}
            </div>
          )}

          <details>
            <summary>Raw track (oldest → newest)</summary>
            <div style={{ marginTop: "0.5rem", fontFamily: "monospace" }}>
              {selected.track.map((p, i) => (
                <div key={i}>
                  {p.timestamp} — lat {p.lat.toFixed(3)}, lon {p.lon.toFixed(3)}{" "}
                  {p.altitude != null && `alt ${p.altitude.toFixed(1)}m`}
                </div>
              ))}
            </div>
          </details>
        </div>
      </main>
    </div>
  )
}

export default App
