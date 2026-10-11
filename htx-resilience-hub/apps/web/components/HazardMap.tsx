"use client";
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { AirStation, AnomalyEvent, HazardReading, Location } from "@/lib/types";

export default function HazardMap({ readings, locations, anomalies, airStations }: { readings: HazardReading[]; locations: Location[]; anomalies: AnomalyEvent[]; airStations: AirStation[] }) {
  const [flood, setFlood] = useState(true), [places, setPlaces] = useState(true), [air, setAir] = useState(true);
  const canvas = useRef<HTMLDivElement>(null), map = useRef<L.Map | null>(null), layers = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    if (!canvas.current) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const instance = L.map(canvas.current, { center: [29.749, -95.367], zoom: 11, scrollWheelZoom: false, zoomAnimation: !still, fadeAnimation: !still, markerZoomAnimation: !still });
    map.current = instance;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(instance);
    layers.current = L.layerGroup().addTo(instance);
    const observer = new ResizeObserver(() => instance.invalidateSize());
    observer.observe(canvas.current);
    return () => { observer.disconnect(); instance.remove(); map.current = null; layers.current = null; };
  }, []);
  useEffect(() => {
    const group = layers.current;
    if (!group) return;
    group.clearLayers();
    if (flood) readings.filter((r) => r.metric.toLowerCase().includes("gage height")).forEach((reading) => {
      const content = document.createElement("div");
      const title = document.createElement("strong"); title.textContent = reading.station_name; content.append(title);
      for (const text of [reading.value + " " + reading.unit + " · stage not rated",
        new Date(reading.time).toLocaleString(), "A gauge does not establish road safety."]) {
        const paragraph = document.createElement("p"); paragraph.textContent = text; content.append(paragraph);
      }
      L.circleMarker([reading.lat, reading.lon], { radius: 9, className: "map-marker", color: "#6aaeb3", fillOpacity: .8 }).bindPopup(content).addTo(group);
    });
    if (places) locations.forEach((location) => {
      const label = document.createElement("span"); label.textContent = location.name;
      L.circleMarker([location.lat, location.lon], { radius: 6, className: "map-marker", color: "#d76338", fillOpacity: 1 }).bindPopup(label).addTo(group);
    });
    if (air) airStations.filter((station) => station.fresh).forEach((station) => {
      const content = document.createElement("div");
      const title = document.createElement("strong"); title.textContent = station.station_name; content.append(title);
      const detail = document.createElement("p"); detail.textContent = `Observed PM2.5: ${station.value.toFixed(1)} ${station.unit} · ${new Date(station.time).toLocaleString()} · AirNow`; content.append(detail);
      L.circleMarker([station.lat, station.lon], { radius: 7, className: "map-marker", color: "#3cc9bd", fillColor: "#3cc9bd", fillOpacity: .75 }).bindPopup(content).addTo(group);
    });
    anomalies.slice(0, 20).forEach((event) => {
      if ((event.hazard === "flood" && !flood) || (event.hazard === "air" && !air)) return;
      const content = document.createElement("div");
      const label = event.hazard === "flood" ? "Rising gage height" : "PM2.5 anomaly";
      const title = document.createElement("strong"); title.textContent = event.is_simulated ? `DEMO · ${label}` : label; content.append(title);
      for (const line of [event.station_name, `${event.value.toFixed(1)} ${event.unit} vs ${event.baseline.toFixed(1)} baseline`,
        `${new Date(event.observed_at).toLocaleString()} · ${event.status}`,
        ...(event.hazard === "flood" ? ["Station trend; not an official flood warning or road-safety finding."] : [])]) {
        const detail = document.createElement("p"); detail.textContent = line; content.append(detail);
      }
      L.circleMarker([event.lat, event.lon], { radius: 12, color: event.is_simulated ? "#eba66b" : event.hazard === "flood" ? "#4da9e4" : "#fb7569", weight: 3, fillOpacity: .4, className: "map-marker" }).bindPopup(content).addTo(group);
    });
  }, [readings, locations, anomalies, airStations, flood, places, air]);
  return <section aria-label="Houston environmental evidence map" className="map-panel">
    <div className="map-controls"><label><input type="checkbox" checked={air} onChange={() => setAir(!air)} /> Air monitors</label><label><input type="checkbox" checked={flood} onChange={() => setFlood(!flood)} /> Bayou gauges</label><label><input type="checkbox" checked={places} onChange={() => setPlaces(!places)} /> Your places</label><span className="tiny">Large rings mark unusual readings</span></div>
    <div className="map-canvas"><div ref={canvas} style={{ height: "100%", width: "100%" }} /></div>
  </section>;
}
