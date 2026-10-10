"use client";
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { HazardReading, Location } from "@/lib/types";

export default function HazardMap({ readings, locations }: { readings: HazardReading[]; locations: Location[] }) {
  const [flood, setFlood] = useState(true), [places, setPlaces] = useState(true);
  const canvas = useRef<HTMLDivElement>(null), map = useRef<L.Map | null>(null), layers = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    if (!canvas.current) return;
    const instance = L.map(canvas.current, { center: [29.749, -95.367], zoom: 11, scrollWheelZoom: false });
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
      for (const text of [reading.value + " " + reading.unit + " · app " + reading.severity,
        new Date(reading.time).toLocaleString(), "A gauge does not establish road safety."]) {
        const paragraph = document.createElement("p"); paragraph.textContent = text; content.append(paragraph);
      }
      L.circleMarker([reading.lat, reading.lon], { radius: 9, color: reading.severity === "warning" ? "#bc4136" : reading.severity === "watch" ? "#e48436" : "#497b69", fillOpacity: .8 }).bindPopup(content).addTo(group);
    });
    if (places) locations.forEach((location) => {
      const label = document.createElement("span"); label.textContent = location.name;
      L.circleMarker([location.lat, location.lon], { radius: 6, color: "#d76338", fillOpacity: 1 }).bindPopup(label).addTo(group);
    });
  }, [readings, locations, flood, places]);
  return <section aria-label="Houston environmental evidence map" className="map-panel">
    <div className="map-controls"><label><input type="checkbox" checked={flood} onChange={() => setFlood(!flood)} /> Bayou gauges</label><label><input type="checkbox" checked={places} onChange={() => setPlaces(!places)} /> Your places</label><span className="tiny">Grid overlays deferred · AQI shown in briefing</span></div>
    <div className="map-canvas"><div ref={canvas} style={{ height: "100%", width: "100%" }} /></div>
  </section>;
}
