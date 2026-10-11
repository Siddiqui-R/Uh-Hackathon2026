export type Hazard = "flood" | "grid" | "air";
export type Severity = "normal" | "watch" | "warning";
export interface HazardReading {
  time: string; station_id: string; station_name: string; hazard: Hazard;
  lat: number; lon: number; metric: string; value: number; unit: string; severity: Severity;
}
export interface Location { id: string; name: string; kind: "home" | "school" | "work" | "other"; lat: number; lon: number; }
export interface Routine { id: string; activity: string; location_id: string; local_time: string; weekdays: number[]; }
export interface UserPrefs {
  user_id: string; locations: Location[]; routines: Routine[]; timezone: string;
  thresholds: Record<string, number>; memory_enabled: boolean;
}
export interface Suggestion { title: string; description: string; source_url: string; }
export interface Recommendation {
  id: string; title: string; location: string; time: string; category: string; status: string;
  reason: string; alternative_time: string | null; suggestions: Suggestion[]; demo: boolean;
}
export interface ForecastHour {
  time: string; temperature_2m?: number; relative_humidity_2m?: number; apparent_temperature?: number;
  precipitation_probability?: number; us_aqi?: number; pm2_5?: number;
}
export interface Forecast {
  location: Location; retrieved_at: string; hours: ForecastHour[]; source_status: Record<string,string>;
  attribution: string; source_url: string; storage: string;
}
export interface GridStatus {
  status: "live" | "unavailable" | "demo"; severity: Severity | null; title: string; note: string;
  eea_level: number | null; reserves_mw: string | null; updated: string | null; scope: string; source_url: string;
}
export interface AreaCell {
  lat: number; lon: number; us_aqi?: number; pm2_5?: number; ozone?: number;
  apparent_temperature?: number; precipitation_probability?: number;
}
export interface AreaConditions {
  generated_at: string; bounds: { south: number; north: number; west: number; east: number };
  cell: { dlat: number; dlon: number }; cells: AreaCell[]; source_status: Record<string,string>; attribution: string;
}
export interface PlaceMatch { name: string; address: string; lat: number; lon: number; }
export interface PointConditions {
  generated_at: string; timezone: string; location: Location; current: ForecastHour;
  nearby_gauges: (HazardReading & { distance_km: number })[]; grid: GridStatus;
  recommendations: Recommendation[]; source_status: Record<string,string>; coverage: string;
}
export interface Briefing {
  generated_at: string; timezone: string; locations: Location[]; forecasts: Forecast[]; hazards: HazardReading[]; grid?: GridStatus;
  recommendations: Recommendation[]; source_status: Record<string,string>; coverage: string;
}
export interface EnvironmentalAlert {
  id: string; time: string; user_id: string; hazard: string; severity: Severity; message: string;
  location_id: string | null; station_id: string | null; suggestions: Suggestion[]; demo: boolean;
}
export interface Operations {
  api: string; database: string; hosting: string; latest_flood_observation: string | null;
  jobs: { job: string; heartbeat: string; last_success: string | null; status: string; rows_written: number }[];
  integrations: Record<string,string>;
}
