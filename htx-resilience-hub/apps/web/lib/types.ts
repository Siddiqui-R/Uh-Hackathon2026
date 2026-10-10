export type Hazard = "flood" | "grid" | "air";
export type Severity = "unknown" | "low" | "moderate" | "high" | "critical";
export interface SensorReading {
  time: string;
  station_id: string;
  hazard: Hazard;
  metric: string;
  value: number;
  unit: string;
}
export interface HazardSummary {
  hazard: Hazard;
  severity: Severity;
  latest: SensorReading | null;
  history: SensorReading[];
}
export interface UserPrefs {
  user_id: string;
  home_lat: number | null;
  home_lon: number | null;
  work_lat: number | null;
  work_lon: number | null;
  thresholds: Record<string, number>;
}
