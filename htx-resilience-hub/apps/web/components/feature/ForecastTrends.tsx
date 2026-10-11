import type { Forecast, ForecastHour } from "@/lib/types";
import styles from "./features.module.css";

function Series({ hours, keyName, label, unit }: { hours: ForecastHour[]; keyName: "apparent_temperature" | "us_aqi"; label: string; unit: string }) {
  const points = hours.map((h, i) => ({ i, time: h.time, value: h[keyName] })).filter((p): p is { i: number; time: string; value: number } => typeof p.value === "number" && Number.isFinite(p.value));
  if (points.length < 2) return <p className={styles.empty}>{label} trend unavailable: fewer than two forecast values.</p>;
  const min = Math.min(...points.map((p) => p.value)), max = Math.max(...points.map((p) => p.value)), span = max - min || 1;
  const x = (i: number) => 38 + i * 632 / Math.max(1, hours.length - 1);
  const y = (value: number) => 155 - (value - min) * 115 / span;
  const segments: typeof points[] = [];
  for (const point of points) {
    if (!segments.length || point.i > segments[segments.length - 1][segments[segments.length - 1].length - 1].i + 1) segments.push([]);
    segments[segments.length - 1].push(point);
  }
  const first = points[0], last = points[points.length - 1];
  return <div><h3>{label}</h3><svg className={styles.chart} viewBox="0 0 710 200" role="img" aria-label={`${label} modeled forecast from ${new Date(first.time).toLocaleString()} to ${new Date(last.time).toLocaleString()}; latest ${last.value.toFixed(0)} ${unit}`}>
    <title>{label} modeled forecast trend</title><line x1="38" y1="155" x2="670" y2="155" stroke="#d5e0d7" />
    {segments.map((segment, index) => <polyline key={index} points={segment.map((p) => `${x(p.i)},${y(p.value)}`).join(" ")} />)}
    <circle cx={x(last.i)} cy={y(last.value)} r="5" /><text x="38" y="184">{new Date(first.time).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" })}</text>
    <text x="670" y="184" textAnchor="end">{new Date(last.time).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" })}</text>
    <text x="38" y="27">{max.toFixed(0)} {unit}</text><text x="38" y="149">{min.toFixed(0)} {unit}</text>
  </svg><p className={styles.source}>Modeled hourly forecast. Gaps mean the source did not provide a value. This is not an observed station trend.</p></div>;
}
export default function ForecastTrends({ forecast }: { forecast: Forecast }) {
  const hours = forecast.hours.filter((hour) => Date.parse(hour.time) >= Date.now() - 3_600_000).slice(0, 24);
  return <div className={styles.grid}><Series hours={hours} keyName="apparent_temperature" label="Feels-like temperature" unit="°F" /><Series hours={hours} keyName="us_aqi" label="US AQI" unit="index" /></div>;
}
