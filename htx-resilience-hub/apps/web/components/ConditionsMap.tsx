"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import RecommendationCard from "@/components/RecommendationCard";
import type { AreaCell, AreaConditions, GridStatus, HazardReading, Location, PlaceMatch, PointConditions, UserPrefs } from "@/lib/types";

type Fill = "air" | "heat" | "rain" | "off";
type Band = { max: number; color: string; label: string };
type Scale = { metric: keyof AreaCell; source: string; title: string; unit: string; suffix: string; bands: Band[]; stops?: [number, string][] };
type Pin = { lat: number; lon: number; name: string; focus?: boolean };
const SCALES: Record<Exclude<Fill, "off">, Scale> = {
  // AQI keeps the official EPA category colors; heat and rain use continuous ramps so local differences stay visible.
  air: { metric: "us_aqi", source: "air", title: "Air quality", unit: "US AQI", suffix: "", bands: [
    { max: 50, color: "#4fae5b", label: "Good" }, { max: 100, color: "#e8c547", label: "Moderate" },
    { max: 150, color: "#ef8a3c", label: "Sensitive groups" }, { max: 200, color: "#d64541", label: "Unhealthy" },
    { max: 300, color: "#8f3f97", label: "Very unhealthy" }, { max: Infinity, color: "#7e0023", label: "Hazardous" }] },
  heat: { metric: "apparent_temperature", source: "weather", title: "Heat", unit: "°F feels like", suffix: "°", bands: [
    { max: 80, color: "", label: "Comfortable" }, { max: 90, color: "", label: "Caution" }, { max: 103, color: "", label: "Extreme caution" },
    { max: 125, color: "", label: "Danger" }, { max: Infinity, color: "", label: "Extreme danger" }],
    stops: [[65, "#3f7fb5"], [75, "#5aae8f"], [82, "#d8d65a"], [90, "#f2a03d"], [100, "#e0532f"], [110, "#a3202a"]] },
  rain: { metric: "precipitation_probability", source: "weather", title: "Rain chance", unit: "% chance of rain", suffix: "%", bands: [
    { max: 10, color: "", label: "Dry" }, { max: 40, color: "", label: "Slight chance" }, { max: 70, color: "", label: "Likely" }, { max: Infinity, color: "", label: "Very likely" }],
    stops: [[0, "#f4f7fa"], [20, "#bcd5e8"], [50, "#6aa0cc"], [80, "#2f6aa3"], [100, "#173f6e"]] },
};
const SEVERITY_COLORS = { normal: "#527d70", watch: "#b78352", warning: "#ae6054", unrated: "#7d8e88" };
const LIMITS = { south: 29.0, north: 30.7, west: -96.4, east: -94.4 };
const inLimits = (lat: number, lon: number) => lat >= LIMITS.south && lat <= LIMITS.north && lon >= LIMITS.west && lon <= LIMITS.east;
const band = (scale: Scale, value: number) => scale.bands.find((b) => value <= b.max) ?? scale.bands[scale.bands.length - 1];
function mix(stops: [number, string][], value: number): string {
  const [first, last] = [stops[0], stops[stops.length - 1]];
  if (value <= first[0]) return first[1];
  if (value >= last[0]) return last[1];
  const index = stops.findIndex(([at]) => at >= value), [a, from] = stops[index - 1], [b, to] = stops[index];
  const t = (value - a) / (b - a), channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16);
  return "#" + [1, 3, 5].map((at) => Math.round(channel(from, at) + (channel(to, at) - channel(from, at)) * t).toString(16).padStart(2, "0")).join("");
}
const colorFor = (scale: Scale, value: number) => scale.stops ? mix(scale.stops, value) : band(scale, value).color;

function popup(title: string, lines: string[]): HTMLElement {
  const content = document.createElement("div");
  const heading = document.createElement("strong"); heading.textContent = title; content.append(heading);
  for (const text of lines) { const paragraph = document.createElement("p"); paragraph.textContent = text; content.append(paragraph); }
  return content;
}

export default function ConditionsMap({ readings, prefs, grid }: { readings: HazardReading[]; prefs: UserPrefs; grid?: GridStatus }) {
  const [fill, setFill] = useState<Fill>("air"), [gauges, setGauges] = useState(true), [places, setPlaces] = useState(true);
  const [area, setArea] = useState<AreaConditions | null>(null), [areaError, setAreaError] = useState("");
  const [pin, setPin] = useState<Pin | null>(null), [point, setPoint] = useState<PointConditions | null>(null);
  const [loading, setLoading] = useState(false), [pointError, setPointError] = useState("");
  const [query, setQuery] = useState(""), [matches, setMatches] = useState<PlaceMatch[] | null>(null);
  const [searching, setSearching] = useState(false), [locating, setLocating] = useState(false), [findError, setFindError] = useState("");
  const canvas = useRef<HTMLDivElement>(null), map = useRef<L.Map | null>(null), request = useRef(0);
  const fills = useRef<L.LayerGroup | null>(null), markers = useRef<L.LayerGroup | null>(null), pinLayer = useRef<L.LayerGroup | null>(null);
  // Advice depends on saved routines and thresholds, so re-check the pin when they change.
  const adviceKey = useMemo(() => JSON.stringify([prefs.routines, prefs.thresholds]), [prefs.routines, prefs.thresholds]);
  const status = point?.grid ?? grid;

  useEffect(() => {
    if (!canvas.current) return;
    const instance = L.map(canvas.current, { center: [29.76, -95.37], zoom: 10, scrollWheelZoom: false });
    map.current = instance;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(instance);
    instance.createPane("fills").style.zIndex = "350";
    instance.createPane("labels").style.zIndex = "360";
    instance.createPane("pin").style.zIndex = "450";
    fills.current = L.layerGroup().addTo(instance); markers.current = L.layerGroup().addTo(instance); pinLayer.current = L.layerGroup().addTo(instance);
    instance.on("click", (event: L.LeafletMouseEvent) => {
      const { lat, lng } = event.latlng;
      if (!inLimits(lat, lng)) {
        setPin(null); setPoint(null); setPointError("Pick a spot within the greater Houston area."); return;
      }
      setPin({ lat, lon: lng, name: "Dropped pin" });
    });
    const observer = new ResizeObserver(() => instance.invalidateSize());
    observer.observe(canvas.current);
    return () => { observer.disconnect(); instance.remove(); map.current = null; fills.current = markers.current = pinLayer.current = null; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/conditions/area", { cache: "no-store" });
        if (!response.ok) throw new Error();
        const payload = await response.json() as AreaConditions;
        if (cancelled) return;
        setArea(payload);
        setAreaError(Object.values(payload.source_status).every((s) => s === "unavailable") ? "Area-wide air and heat layers are unavailable right now." : "");
      } catch { if (!cancelled) setAreaError("Area-wide air and heat layers need the backend. Markers and your places still work."); }
    }
    void load();
    const interval = setInterval(() => void load(), 15 * 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  useEffect(() => {
    const group = fills.current;
    if (!group) return;
    group.clearLayers();
    if (fill === "off" || !area) return;
    const scale = SCALES[fill];
    for (const cell of area.cells) {
      const value = cell[scale.metric];
      if (value === undefined) continue;
      const { dlat, dlon } = area.cell, level = band(scale, value);
      L.rectangle([[cell.lat - dlat / 2, cell.lon - dlon / 2], [cell.lat + dlat / 2, cell.lon + dlon / 2]],
        { pane: "fills", color: "#fffefa", weight: .5, opacity: .6, fillColor: colorFor(scale, value), fillOpacity: .45 })
        .bindTooltip(`${scale.title}: ${Math.round(value)} ${scale.unit} · ${level.label}`, { sticky: true }).addTo(group);
      L.marker([cell.lat, cell.lon], { pane: "labels", interactive: false, keyboard: false,
        icon: L.divIcon({ className: "cell-label", html: Math.round(value) + scale.suffix, iconSize: [40, 16], iconAnchor: [20, 8] }) }).addTo(group);
    }
  }, [area, fill]);

  useEffect(() => {
    const group = markers.current;
    if (!group) return;
    group.clearLayers();
    if (gauges) readings.filter((r) => r.metric.toLowerCase().includes("gage height")).forEach((reading) => {
      L.circleMarker([reading.lat, reading.lon], { radius: 8, color: SEVERITY_COLORS[reading.severity], fillOpacity: .85, bubblingMouseEvents: false })
        .bindPopup(popup(reading.station_name, [reading.value + " " + reading.unit + " · app " + reading.severity, new Date(reading.time).toLocaleString(), "A gauge does not establish road safety."]))
        .addTo(group);
    });
    if (places) prefs.locations.forEach((location: Location) => {
      L.circleMarker([location.lat, location.lon], { radius: 7, color: "#26362e", weight: 2, fillColor: "#d76338", fillOpacity: 1, bubblingMouseEvents: false })
        .bindTooltip(location.name).on("click", () => setPin({ lat: location.lat, lon: location.lon, name: location.name })).addTo(group);
    });
  }, [readings, prefs.locations, gauges, places]);

  useEffect(() => {
    const group = pinLayer.current;
    if (!group) return;
    group.clearLayers();
    if (!pin) return;
    L.circleMarker([pin.lat, pin.lon], { pane: "pin", radius: 11, color: "#fffefa", weight: 3, fillColor: "#26362e", fillOpacity: 1, interactive: false }).addTo(group);
    if (pin.focus) map.current?.flyTo([pin.lat, pin.lon], Math.max(map.current.getZoom(), 13), { duration: .8 });
  }, [pin]);

  useEffect(() => {
    if (!pin) return;
    const id = ++request.current;
    setLoading(true); setPointError("");
    (async () => {
      try {
        const response = await fetch("/api/conditions/point?" + new URLSearchParams({ lat: String(pin.lat), lon: String(pin.lon) }), { cache: "no-store" });
        if (!response.ok) throw new Error("Conditions for this spot are unavailable. Try again shortly.");
        const payload = await response.json() as PointConditions;
        if (id === request.current) setPoint(payload);
      } catch (failure: unknown) {
        if (id === request.current) { setPoint(null); setPointError(failure instanceof Error ? failure.message : "Conditions unavailable"); }
      } finally { if (id === request.current) setLoading(false); }
    })();
  }, [pin, adviceKey]);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    const text = query.trim();
    if (text.length < 3) { setFindError("Type at least 3 characters."); return; }
    setSearching(true); setFindError(""); setMatches(null);
    try {
      const response = await fetch("/api/geocode?" + new URLSearchParams({ q: text }), { cache: "no-store" });
      if (!response.ok) throw new Error("Address search is unavailable. Tap the map or use your location instead.");
      const results = await response.json() as PlaceMatch[];
      if (!results.length) setFindError("No matches in the Houston area. Try adding a street, ZIP code or landmark.");
      else if (results.length === 1) choose(results[0]);
      else setMatches(results);
    } catch (failure: unknown) { setFindError(failure instanceof Error ? failure.message : "Address search unavailable"); }
    finally { setSearching(false); }
  }
  function choose(match: PlaceMatch) { setMatches(null); setQuery(match.name); setPin({ lat: match.lat, lon: match.lon, name: match.name, focus: true }); }
  function locate() {
    if (!("geolocation" in navigator)) { setFindError("This browser can't share your location. Search an address instead."); return; }
    setLocating(true); setFindError(""); setMatches(null);
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      setLocating(false);
      if (!inLimits(coords.latitude, coords.longitude)) { setFindError("You appear to be outside the Houston area. Search a Houston address instead."); return; }
      setPin({ lat: coords.latitude, lon: coords.longitude, name: "Your current location", focus: true });
    }, (failure) => {
      setLocating(false);
      setFindError(failure.code === failure.PERMISSION_DENIED ? "Location permission was declined. Search an address instead." : "Couldn't get your location. Search an address instead.");
    }, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 });
  }
  function clear() { request.current++; setPin(null); setPoint(null); setPointError(""); setLoading(false); }
  const scale = fill === "off" ? null : SCALES[fill], now = point?.current;
  const layerMissing = Boolean(scale && area && !area.cells.some((cell) => cell[scale.metric] !== undefined));
  const aqi = now?.us_aqi !== undefined ? band(SCALES.air, now.us_aqi) : null;

  return <div className="map-layout">
    <section aria-label="Houston conditions map" className="map-panel">
      <div className="location-bar">
        <form className="location-search" onSubmit={(event) => void search(event)} role="search">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Enter an address, ZIP code or place in Houston" aria-label="Search a location" maxLength={200} />
          <button className="primary" disabled={searching}>{searching ? "Searching…" : "Get advice"}</button>
        </form>
        <button className="secondary" onClick={locate} disabled={locating}>{locating ? "Locating…" : "◎ Use my location"}</button>
        {matches && <ul className="place-matches" aria-label="Matching places">{matches.map((match) => <li key={match.address}><button onClick={() => choose(match)}><strong>{match.name}</strong><span className="tiny">{match.address}</span></button></li>)}</ul>}
      </div>
      {findError && <p className="notice" role="status">{findError}</p>}
      <div className="map-controls">
        <div className="segmented" role="radiogroup" aria-label="Map shading">
          {(["air", "heat", "rain", "off"] as Fill[]).map((value) => <button key={value} role="radio" aria-checked={fill === value} className={fill === value ? "active" : ""} onClick={() => setFill(value)}>
            {{ air: "Air quality", heat: "Heat", rain: "Rain", off: "No shading" }[value]}</button>)}
        </div>
        <label><input type="checkbox" checked={gauges} onChange={() => setGauges(!gauges)} /> Bayou gauges</label>
        <label><input type="checkbox" checked={places} onChange={() => setPlaces(!places)} /> Your places</label>
      </div>
      <div className="map-canvas">
        <div ref={canvas} style={{ height: "100%", width: "100%" }} />
        {status && <a className="map-overlay grid-chip" href={status.source_url} target="_blank" rel="noreferrer" title={status.scope}>
          <span className="grid-dot" style={{ background: status.severity ? SEVERITY_COLORS[status.severity] : "#aaa99b" }} />
          <span><strong>⚡ Power grid · {status.title}</strong><span className="tiny">{status.status === "live" ? (status.reserves_mw ? status.reserves_mw + " MW reserves · " : "") + "ERCOT statewide" : status.status === "demo" ? "Demo value" : "Check ERCOT directly"}</span></span>
        </a>}
        {scale && area && !layerMissing && <div className="map-overlay map-legend" aria-label="Map legend">
          <strong>{scale.title} <span className="tiny">· {scale.unit}</span></strong>
          {scale.stops ? <>
            <i className="legend-ramp" style={{ background: `linear-gradient(90deg, ${scale.stops.map(([at, color]) => `${color} ${(at - scale.stops![0][0]) / (scale.stops![scale.stops!.length - 1][0] - scale.stops![0][0]) * 100}%`).join(", ")})` }} />
            <span className="legend-ticks">{scale.stops.map(([at]) => <span key={at}>{at}{scale.suffix}</span>)}</span>
          </> : scale.bands.map((b) => <span key={b.label}><i style={{ background: b.color }} />{b.label}</span>)}
          <span className="tiny">Modeled now · ~11 km cells</span>
        </div>}
        {scale && area && layerMissing && <div className="map-overlay map-missing" role="status"><strong>{scale.title} data is temporarily unavailable.</strong><span className="tiny">The forecast service didn&apos;t respond. It retries automatically within a few minutes.</span></div>}
      </div>
      <p className="tiny">{areaError || area?.attribution || "Loading area-wide conditions…"} Your device location is only used to place the pin; it isn't saved. Address search by <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap Nominatim</a>.</p>
    </section>

    <aside className="panel map-advice" aria-live="polite">
      {!pin && !pointError && <div className="map-empty"><span aria-hidden>⌖</span><strong>Pick a spot on the map.</strong>
        <p className="muted">Enter an address, use your current location, or tap anywhere in Houston to see the air, heat, flooding and power conditions there and how your plans should change.</p></div>}
      {(pin || pointError) && <div className="panel-heading"><div><p className="section-label">ADVICE FOR THIS SPOT</p><h3>{pin?.name ?? "Outside coverage"}</h3>{pin && <p className="tiny">{pin.lat.toFixed(3)}, {pin.lon.toFixed(3)}</p>}</div><button className="quiet" onClick={clear}>Clear ✕</button></div>}
      {pointError && <p className="notice" role="status">{pointError}</p>}
      {loading && !point && <p className="muted">Checking conditions here…</p>}
      {point && pin && <div className={loading ? "refreshing" : ""}>
        <div className="spot-stats">
          <div><strong>{now?.apparent_temperature !== undefined ? Math.round(now.apparent_temperature) + "°F" : "—"}</strong><span className="tiny">Feels like</span></div>
          <div><strong>{now?.us_aqi !== undefined ? Math.round(now.us_aqi) : "—"}</strong><span className="tiny">{aqi ? "AQI · " + aqi.label : "US AQI"}</span></div>
          <div><strong>{now?.precipitation_probability !== undefined ? Math.round(now.precipitation_probability) + "%" : "—"}</strong><span className="tiny">Rain chance</span></div>
          <div><strong style={{ color: point.grid.severity ? SEVERITY_COLORS[point.grid.severity] : undefined }}>{point.grid.severity === "normal" ? "Normal" : point.grid.severity === "watch" ? "Conserve" : point.grid.severity === "warning" ? "Emergency" : "—"}</strong><span className="tiny">Power grid</span></div>
        </div>
        <div className="recommendations">{point.recommendations.map((card) => <RecommendationCard key={card.id} card={{ ...card, location: pin.name }} timezone={point.timezone} />)}</div>
        <p className="tiny">{point.coverage}</p>
      </div>}
    </aside>
  </div>;
}
