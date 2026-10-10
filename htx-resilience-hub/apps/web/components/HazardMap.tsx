"use client";

import { useState } from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import type { Hazard } from "@/lib/types";

const labels: Record<Hazard, string> = { flood: "Flood", grid: "Grid stress", air: "Air quality" };

export default function HazardMap() {
  const [layers, setLayers] = useState<Record<Hazard, boolean>>({ flood: true, grid: true, air: true });
  // TODO: Render real gauge markers, grid regions, and air monitor overlays for enabled layers.
  return <section aria-label="Houston hazard map" className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
    <div className="flex flex-wrap gap-5 p-4">
      {(Object.keys(labels) as Hazard[]).map((hazard) => <label key={hazard} className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={layers[hazard]} onChange={() => setLayers((prev) => ({ ...prev, [hazard]: !prev[hazard] }))} />
        {labels[hazard]}
      </label>)}
    </div>
    <div className="h-[420px]">
      <MapContainer center={[29.7604, -95.3698]} zoom={10} scrollWheelZoom={false}>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      </MapContainer>
    </div>
    <p className="p-4 text-xs text-slate-500">Base map only. Hazard layers are placeholders; no live sensor data is connected.</p>
  </section>;
}
