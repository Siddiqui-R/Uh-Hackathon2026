import { backendUrl } from "@/lib/backend";

export const dynamic = "force-dynamic";

interface AreaCell {
  lat: number;
  lon: number;
  apparent_temperature?: number;
  us_aqi?: number;
}

interface AreaResponse {
  generated_at: string;
  cells: AreaCell[];
  source_status: Record<string, string>;
}

interface GaugeReading {
  station_name: string;
  metric: string;
  value: number;
  unit: string;
  time: string;
}

async function fromApi<T>(path: string): Promise<{ data: T; mode: string }> {
  const response = await fetch(backendUrl(path), {
    headers: { "x-internal-token": process.env.INTERNAL_API_TOKEN ?? "" },
    cache: "no-store",
    signal: AbortSignal.timeout(35_000),
  });
  if (!response.ok) throw new Error(`Environmental API returned ${response.status}`);
  return { data: await response.json() as T, mode: response.headers.get("X-Data-Mode") ?? "unavailable" };
}

function nearest(cells: AreaCell[], field: "apparent_temperature" | "us_aqi"): AreaCell | undefined {
  // The University of Houston anchors the citywide preview; no account location is used.
  return cells.filter((cell) => Number.isFinite(cell[field]))
    .sort((a, b) => (a.lat - 29.7199) ** 2 + (a.lon + 95.3422) ** 2
      - (b.lat - 29.7199) ** 2 - (b.lon + 95.3422) ** 2)[0];
}

export async function GET(): Promise<Response> {
  const [areaResult, gaugeResult] = await Promise.allSettled([
    fromApi<AreaResponse>("/api/conditions/area"),
    fromApi<GaugeReading[]>("/api/hazards"),
  ]);
  if (areaResult.status === "rejected" && gaugeResult.status === "rejected") {
    return Response.json({ error: "Current conditions are unavailable. Please try again shortly." }, { status: 502 });
  }

  const area = areaResult.status === "fulfilled" ? areaResult.value.data : null;
  const cells = Array.isArray(area?.cells) ? area.cells : [];
  const weather = area?.source_status?.weather === "live model" ? nearest(cells, "apparent_temperature") : undefined;
  const air = area?.source_status?.air === "live model" ? nearest(cells, "us_aqi") : undefined;
  const readings = gaugeResult.status === "fulfilled" && Array.isArray(gaugeResult.value.data) ? gaugeResult.value.data : [];
  const gauge = readings.filter((row) => row.metric?.toLowerCase().includes("gage height") && row.unit === "ft"
    && Number.isFinite(row.value) && Number.isFinite(Date.parse(row.time)))
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0];

  return Response.json({
    retrievedAt: area?.generated_at ?? null,
    feelsLikeF: weather?.apparent_temperature ?? null,
    usAqi: air?.us_aqi ?? null,
    gauge: gauge ? {
      valueFt: gauge.value,
      station: gauge.station_name,
      observedAt: gauge.time,
      mode: gaugeResult.status === "fulfilled" ? gaugeResult.value.mode : "unavailable",
    } : null,
  }, { headers: { "Cache-Control": "no-store" } });
}
