"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import RecommendationCard from "@/components/RecommendationCard";
import MapLayerControls from "@/components/MapLayerControls";
import { gridAvailable, layerAvailable, modelLayers, validatedLayerValue, type ModelLayer } from "@/lib/mapLayers";
import { forecastNumber, forecastTime, forecastFreshness } from "@/lib/forecastPresentation";
import type { AreaCell, AreaConditions, GridStatus, HazardReading, Location, PlaceMatch, PointConditions, UserPrefs } from "@/lib/types";

type Band = { max: number; color: string; label: string };
type Scale = { metric: keyof AreaCell; source: string; title: string; unit: string; suffix: string; bands: Band[]; stops?: [number, string][] };
type Pin = { lat: number; lon: number; name: string; focus?: boolean };
const SCALES: Record<ModelLayer, Scale> = {
  // AQI keeps the official EPA category colors; heat and rain use continuous ramps so local differences stay visible.
  air: { metric: "us_aqi", source: "air", title: "Air quality", unit: "US AQI", suffix: "", bands: [
    { max: 50, color: "#4fae5b", label: "Good" }, { max: 100, color: "#e8c547", label: "Moderate" },
    { max: 150, color: "#ef8a3c", label: "Sensitive groups" }, { max: 200, color: "#d64541", label: "Unhealthy" },
    { max: 300, color: "#8f3f97", label: "Very unhealthy" }, { max: Infinity, color: "#7e0023", label: "Hazardous" }] },
  heat: { metric: "apparent_temperature", source: "weather", title: "Feels like", unit: "°F feels like", suffix: "°", bands: [
    { max: 80, color: "", label: "Below 80°F" }, { max: 90, color: "", label: "80–90°F" }, { max: 103, color: "", label: "90–103°F" },
    { max: 125, color: "", label: "103–125°F" }, { max: Infinity, color: "", label: "Above 125°F" }],
    stops: [[65, "#3f7fb5"], [75, "#5aae8f"], [82, "#d8d65a"], [90, "#f2a03d"], [100, "#e0532f"], [110, "#a3202a"]] },
  rain: { metric: "precipitation_probability", source: "weather", title: "Rain chance", unit: "% chance of rain", suffix: "%", bands: [
    { max: 10, color: "", label: "0–10% chance" }, { max: 40, color: "", label: "10–40% chance" }, { max: 70, color: "", label: "40–70% chance" }, { max: Infinity, color: "", label: "70–100% chance" }],
    stops: [[0, "#f4f7fa"], [20, "#bcd5e8"], [50, "#6aa0cc"], [80, "#2f6aa3"], [100, "#173f6e"]] },
};
const SEVERITY_COLORS = { normal: "#527d70", watch: "#b78352", warning: "#ae6054", unrated: "#7d8e88" };
const LIMITS = { south: 29.0, north: 30.7, west: -96.4, east: -94.4 };
const inLimits = (lat: number, lon: number) => lat >= LIMITS.south && lat <= LIMITS.north && lon >= LIMITS.west && lon <= LIMITS.east;
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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

export default function ConditionsMap({ readings, prefs, grid, gaugeMode }: { readings: HazardReading[]; prefs: UserPrefs; grid?: GridStatus; gaugeMode?: string }) {
  const [layers, setLayers] = useState<Record<ModelLayer, boolean>>({ air: true, heat: false, rain: false });
  const [shade, setShade] = useState<ModelLayer>("air"), [showGrid, setShowGrid] = useState(true);
  const [gauges, setGauges] = useState(true), [places, setPlaces] = useState(true);
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
    const still = reducedMotion();
    const instance = L.map(canvas.current, { center: [29.76, -95.37], zoom: 10, scrollWheelZoom: false, zoomAnimation: !still, fadeAnimation: !still, markerZoomAnimation: !still });
    map.current = instance;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(instance);
    instance.createPane("fills").style.zIndex = "350";
    instance.createPane("labels").style.zIndex = "360";
    instance.createPane("pin").style.zIndex = "450";
    fills.current = L.layerGroup().addTo(instance); markers.current = L.layerGroup().addTo(instance); pinLayer.current = L.layerGroup().addTo(instance);
    instance.on("click", (event: L.LeafletMouseEvent) => {
      const { lat, lng } = event.latlng;
      if (!inLimits(lat, lng)) {
        request.current++; setLoading(false); setPin(null); setPoint(null); setPointError("Pick a spot within the greater Houston area."); return;
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
        setAreaError(Object.values(payload.source_status).every((s) => s === "unavailable") ? "Modeled map layers are unavailable." : "");
      } catch { if (!cancelled) setAreaError("Modeled layers unavailable. Your places and available gauges still work."); }
    }
    void load();
    const interval = setInterval(() => void load(), 15 * 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  useEffect(() => {
    const group = fills.current;
    if (!group) return;
    group.clearLayers();
    if (!area) return;
    const enabled = (Object.keys(modelLayers) as ModelLayer[]).filter((key) => layers[key] && layerAvailable(area, key));
    if (!enabled.length) return;
    const fillLayer = enabled.includes(shade) ? shade : enabled[0], scale = SCALES[fillLayer];
    for (const cell of area.cells) {
      const items = enabled.flatMap((key) => {
        const value = validatedLayerValue(cell, key);
        return value === undefined ? [] : [{ key, value }];
      });
      if (!items.length) continue;
      const value = validatedLayerValue(cell, fillLayer), { dlat, dlon } = area.cell;
      const evidence = items.map(({ key, value }) => `${modelLayers[key].label}: ${Math.round(value)} ${modelLayers[key].unit} · ${modelLayers[key].provider} model · valid ${forecastTime(cell.valid_at?.[modelLayers[key].source], prefs.timezone)}`);
      if (value !== undefined) L.rectangle([[cell.lat - dlat / 2, cell.lon - dlon / 2], [cell.lat + dlat / 2, cell.lon + dlon / 2]],
        { pane: "fills", className: "cell-fill", color: "#fffefa", weight: .5, opacity: .6, fillColor: colorFor(scale, value), fillOpacity: .4 })
        .bindTooltip(evidence.join("<br/>"), { sticky: true }).addTo(group);
      L.marker([cell.lat, cell.lon], { pane: "labels", interactive: false, keyboard: false,
        icon: L.divIcon({ className: "cell-layer-label", html: items.map(({ key, value }) => `<span aria-hidden="true">${key === "air" ? "AQI " : key === "heat" ? "Feels " : "Rain "}${Math.round(value)}${key === "heat" ? "°F" : key === "rain" ? "%" : ""}</span>`).join(""), iconSize: [70, items.length * 15], iconAnchor: [35, items.length * 7.5] }) }).addTo(group);
    }
  }, [area, layers, shade, prefs.timezone]);

  useEffect(() => {
    const group = markers.current;
    if (!group) return;
    group.clearLayers();
    if (gauges) readings.filter((r) => r.metric.toLowerCase().includes("gage height") && Number.isFinite(r.value)).forEach((reading) => {
      L.circleMarker([reading.lat, reading.lon], { radius: 8, className: "map-marker", color: SEVERITY_COLORS[reading.severity], fillOpacity: .85, bubblingMouseEvents: false })
        .bindPopup(popup(reading.station_name, [reading.value + " " + reading.unit, gaugeMode === "demo" || /demo/i.test(reading.station_name) ? "Simulated reading" : "USGS observation · stage unrated", "Observed " + forecastTime(reading.time, prefs.timezone), "A gauge does not establish road safety."]))
        .addTo(group);
    });
    if (places) prefs.locations.forEach((location: Location) => {
      L.circleMarker([location.lat, location.lon], { radius: 7, className: "map-marker", color: "#26362e", weight: 2, fillColor: "#d76338", fillOpacity: 1, bubblingMouseEvents: false })
        .bindTooltip(location.name).on("click", () => setPin({ lat: location.lat, lon: location.lon, name: location.name })).addTo(group);
    });
  }, [readings, prefs.locations, prefs.timezone, gauges, places, gaugeMode]);

  useEffect(() => {
    const group = pinLayer.current;
    if (!group) return;
    group.clearLayers();
    if (!pin) return;
    // A single ripple marks where the pin landed; reduced motion hides it in CSS.
    L.circleMarker([pin.lat, pin.lon], { pane: "pin", className: "map-pin-ring", radius: 11, color: "#26362e", weight: 2, fill: false, interactive: false }).addTo(group);
    L.circleMarker([pin.lat, pin.lon], { pane: "pin", className: "map-pin", radius: 11, color: "#fffefa", weight: 3, fillColor: "#26362e", fillOpacity: 1, interactive: false }).addTo(group);
    if (pin.focus && map.current) {
      const zoom = Math.max(map.current.getZoom(), 13);
      if (reducedMotion()) map.current.setView([pin.lat, pin.lon], zoom, { animate: false });
      else map.current.flyTo([pin.lat, pin.lon], zoom, { duration: .8 });
    }
  }, [pin]);

  useEffect(() => {
    if (!pin) return;
    const id = ++request.current;
    setLoading(true); setPoint(null); setPointError("");
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
  const enabledLayers = (Object.keys(modelLayers) as ModelLayer[]).filter((key) => layers[key] && layerAvailable(area, key));
  const fillLayer = enabledLayers.includes(shade) ? shade : enabledLayers[0];
  const scale = fillLayer ? SCALES[fillLayer] : null, now = point?.current;
  const currentCell = point && now ? { ...now, lat: point.location.lat, lon: point.location.lon } : undefined;
  const aqi = currentCell && validatedLayerValue(currentCell,"air") !== undefined ? band(SCALES.air, currentCell.us_aqi!) : null;

  return <div className="map-layout">
    <section aria-label="Houston conditions map" className="map-panel">
      <div className="location-bar">
        <form className="location-search" onSubmit={(event) => void search(event)} role="search">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Enter an address, ZIP code or place in Houston" aria-label="Search a location" maxLength={200} />
          <button className="primary" disabled={searching} aria-busy={searching || undefined}>{searching ? "Searching…" : "Get advice"}</button>
        </form>
        <button className="secondary" onClick={locate} disabled={locating} aria-busy={locating || undefined}>{locating ? "Locating…" : "◎ Use my location"}</button>
        {matches && <ul className="place-matches" aria-label="Matching places">{matches.map((match) => <li key={match.address}><button onClick={() => choose(match)}><strong>{match.name}</strong><span className="tiny">{match.address}</span></button></li>)}</ul>}
      </div>
      {findError && <p className="notice" role="status">{findError}</p>}
      <MapLayerControls area={area} readings={readings} grid={status} gaugeMode={gaugeMode} timezone={prefs.timezone} layers={layers} shade={shade} gauges={gauges} places={places} showGrid={showGrid}
        onLayer={(key, enabled) => { setLayers((current) => ({ ...current, [key]: enabled })); if (enabled) setShade(key); }} onShade={setShade} onGauges={setGauges} onPlaces={setPlaces} onGrid={setShowGrid} />
      <div className="map-canvas">
        <div ref={canvas} style={{ height: "100%", width: "100%" }} />
        {showGrid && gridAvailable(status) && status && <a className="map-overlay grid-chip" href={status.source_url} target="_blank" rel="noreferrer" title={status.scope}>
          <span className="grid-dot" style={{ background: status.severity ? SEVERITY_COLORS[status.severity] : "#aaa99b" }} />
          <span><strong>Power grid / {status.title}</strong><span className="tiny">{status.reserves_mw ? status.reserves_mw + " MW reserves · " : ""}ERCOT statewide · {forecastFreshness(status.updated)}</span></span>
        </a>}
        {!area && !areaError && <div className="map-overlay map-status" aria-hidden><span className="spinner" />Loading modeled layers…</div>}
        {scale && area && <div className="map-overlay map-legend" aria-label="Map legend" key={fillLayer}>
          <strong>{scale.title} <span className="tiny">· {scale.unit}</span></strong>
          {scale.stops ? <>
            <i className="legend-ramp" style={{ background: `linear-gradient(90deg, ${scale.stops.map(([at, color]) => `${color} ${(at - scale.stops![0][0]) / (scale.stops![scale.stops!.length - 1][0] - scale.stops![0][0]) * 100}%`).join(", ")})` }} />
            <span className="legend-ticks">{scale.stops.map(([at]) => <span key={at}>{at}{scale.suffix}</span>)}</span>
          </> : scale.bands.map((b) => <span key={b.label}><i style={{ background: b.color }} />{b.label}</span>)}
          <span className="tiny">Modeled forecast · ~11 km cells</span>
        </div>}

      </div>
      <p className="tiny" role="status">{areaError || (area ? `Model retrieved ${forecastTime(area.generated_at, prefs.timezone)} · ~11 km cells` : "Loading modeled layers…")}</p>
      <div className="map-place-picker"><label>Focus a saved place<select value={prefs.locations.find((place) => place.lat === pin?.lat && place.lon === pin?.lon)?.id ?? ""} onChange={(event) => { const place = prefs.locations.find((item) => item.id === event.target.value); if (place) setPin({ lat: place.lat, lon: place.lon, name: place.name, focus: true }); }}><option value="">Choose a place</option>{prefs.locations.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}</select></label><a href="/routines">Plan an activity →</a></div>
    </section>

    <aside className="panel map-advice" aria-live="polite">
      {!pin && !pointError && <div className="map-empty"><span aria-hidden>⌖</span><strong>Pick a spot on the map.</strong>
        <p className="muted">Search Houston, tap the map, or choose a saved place.</p></div>}
      {(pin || pointError) && <div className="panel-heading"><div><p className="section-label">POINT OUTLOOK</p><h3>{pin?.name ?? "Outside coverage"}</h3>{pin && <p className="tiny">{pin.lat.toFixed(3)}, {pin.lon.toFixed(3)}</p>}</div><button className="quiet" onClick={clear}>Clear ✕</button></div>}
      {pointError && <p className="notice" role="status">{pointError}</p>}
      {loading && !point && <div role="status"><p className="loading-line"><span className="spinner" aria-hidden />Checking conditions here…</p><div className="spot-stats" aria-hidden>{[0, 1, 2, 3].map((key) => <div key={key}><span className="skeleton skeleton-value" /><span className="skeleton skeleton-line short" /></div>)}</div></div>}
      {point && pin && <div className={loading ? "refreshing" : ""}>
        <div className="spot-stats">
          <div><strong>{currentCell && now?.apparent_temperature != null && validatedLayerValue(currentCell,"heat") === undefined ? "Review data" : forecastNumber(now?.apparent_temperature, "°F")}</strong><span className="tiny">Modeled feels like</span></div>
          <div><strong>{now?.us_aqi != null && now.us_aqi < 0 ? "Review data" : forecastNumber(now?.us_aqi, " US AQI")}</strong><span className="tiny">{aqi ? "Modeled AQI · " + aqi.label : "Modeled US AQI"}</span></div>
          <div><strong>{now?.precipitation_probability != null && now.precipitation_probability >= 0 && now.precipitation_probability <= 100 ? forecastNumber(now.precipitation_probability, "%") : "Unavailable"}</strong><span className="tiny">Forecast rain chance</span></div>
          <div><strong style={{ color: point.grid.severity ? SEVERITY_COLORS[point.grid.severity] : undefined }}>{!gridAvailable(point.grid) ? "Unavailable" : point.grid.title}</strong><span className="tiny">ERCOT statewide report</span></div>
        </div>
        <p className="tiny">Modeled forecast · valid {forecastTime(now?.time, point.timezone)}</p>
        <div className="recommendations"><p className="tiny">What if your saved activities happened here? Your plans are unchanged.</p>{point.recommendations.map((card) => <RecommendationCard key={card.id} card={{ ...card, location: pin.name }} timezone={point.timezone} />)}</div>
        <details className="layer-sources"><summary>Point sources and coverage</summary><p>Retrieved {forecastTime(point.forecast_retrieved_at, point.timezone)} · {point.forecast_attribution ?? "Source attribution unavailable"}</p><p className="tiny">{point.coverage}</p>{now?.data_quality_notes?.map((note) => <p key={note}>{note} Valid {forecastTime(now.time, point.timezone)}.</p>)}</details>
      </div>}
    </aside>
  </div>;
}
