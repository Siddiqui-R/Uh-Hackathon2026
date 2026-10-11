import type { AreaCell, AreaConditions, GridStatus } from "./types";
import { forecastTime } from "./forecastPresentation";

export type ModelLayer = "air" | "heat" | "rain";
export const modelLayers = {
  air: { label: "Air quality", metric: "us_aqi", source: "air", provider: "CAMS / Open-Meteo", unit: "US AQI" },
  heat: { label: "Feels like", metric: "apparent_temperature", source: "weather", provider: "Open-Meteo", unit: "°F" },
  rain: { label: "Rain chance", metric: "precipitation_probability", source: "weather", provider: "Open-Meteo", unit: "%" },
} as const;

export function validatedLayerValue(cell: AreaCell, layer: ModelLayer): number | undefined {
  const value = cell[modelLayers[layer].metric];
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (layer === "rain" && (value < 0 || value > 100)) return undefined;
  if (layer === "air" && value < 0) return undefined;
  if (layer === "heat" && (value < -20 || value > 160 || cell.data_quality_notes?.some((note) => /feels-like|Fahrenheit/.test(note)))) return undefined;
  return value;
}

export function layerAvailable(area: AreaConditions | null, layer: ModelLayer): boolean {
  return ["live model", "demo"].includes(area?.source_status[modelLayers[layer].source] ?? "") && area!.cells.some((cell) => validatedLayerValue(cell, layer) !== undefined);
}

export function layerValidTime(area: AreaConditions | null, layer: ModelLayer, zone: string): string {
  const times = [...new Set(area?.cells.filter((cell) => validatedLayerValue(cell, layer) !== undefined).map((cell) => cell.valid_at?.[modelLayers[layer].source]).filter(Boolean))];
  if (!times.length) return "Valid time unavailable";
  return times.length === 1 ? `Valid ${forecastTime(times[0], zone)}` : "Valid time varies by model cell";
}

export function gridAvailable(grid: GridStatus | undefined): boolean {
  return grid?.status === "live" && grid.severity !== null && Boolean(grid.updated && Number.isFinite(Date.parse(grid.updated)));
}
