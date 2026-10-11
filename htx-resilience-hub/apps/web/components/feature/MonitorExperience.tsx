"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AirStation, AnomalyEvent, Briefing, HazardReading } from "@/lib/types";
import FeatureFrame from "./FeatureFrame";
import styles from "./features.module.css";

const HazardMap = dynamic(() => import("@/components/HazardMap"), { ssr: false, loading: () => <div className={styles.loading}>Loading map…</div> });
type Point = { time: string; value: number };
function when(value: string): string { return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
function age(value: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000));
  return minutes < 60 ? `${minutes} min old` : `${Math.round(minutes / 60)} hr old`;
}
function Trend({ points, unit, label }: { points: Point[]; unit: string; label: string }) {
  if (points.length < 2) return <p className={styles.empty}>Trend unavailable: at least two hourly observations are needed. The hourly aggregate can lag new readings.</p>;
  const values = points.map((p) => p.value), min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const coords = points.map((p, i) => `${40 + i * 630 / (points.length - 1)},${170 - (p.value - min) * 130 / span}`);
  return <div><svg className={styles.chart} viewBox="0 0 710 210" role="img" aria-label={`${label} trend from ${when(points[0].time)} to ${when(points[points.length - 1].time)}; latest ${values[values.length - 1].toFixed(2)} ${unit}`}>
    <title>{label} hourly trend</title><line x1="40" y1="170" x2="670" y2="170" stroke="#d5e0d7" />
    <polyline points={coords.join(" ")} /><circle cx={coords[coords.length - 1].split(",")[0]} cy={coords[coords.length - 1].split(",")[1]} r="5" />
    <text x="40" y="198">{when(points[0].time)}</text><text x="670" y="198" textAnchor="end">{when(points[points.length - 1].time)}</text>
    <text x="40" y="28">{max.toFixed(2)} {unit}</text><text x="40" y="164">{min.toFixed(2)} {unit}</text>
  </svg><p className={styles.source}>Hourly station averages, past 24 hours. Latest {values[values.length - 1].toFixed(2)} {unit} at {when(points[points.length - 1].time)}.</p></div>;
}

export default function MonitorExperience() {
  const [briefing, setBriefing] = useState<Briefing | null>(null), [air, setAir] = useState<AirStation[]>([]), [events, setEvents] = useState<AnomalyEvent[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [selected, setSelected] = useState(""), [trend, setTrend] = useState<Point[]>([]), [trendState, setTrendState] = useState(""), [demoBusy, setDemoBusy] = useState(false);
  const load = useCallback(async () => {
    setError("");
    const [b, a, e] = await Promise.allSettled([
      fetch("/api/briefing", { cache: "no-store" }), fetch("/api/air/stations", { cache: "no-store" }), fetch("/api/anomalies", { cache: "no-store" }),
    ]);
    const missing: string[] = [];
    if (b.status === "fulfilled" && b.value.ok) setBriefing(await b.value.json() as Briefing);
    else if (b.status === "fulfilled" && b.value.status === 401) missing.push("your signed-in session (sign in again)");
    else missing.push("environmental briefing");
    if (a.status === "fulfilled" && a.value.ok) setAir(await a.value.json() as AirStation[]); else missing.push("air stations");
    if (e.status === "fulfilled" && e.value.ok) setEvents(await e.value.json() as AnomalyEvent[]); else missing.push("event history");
    if (missing.length) setError(`Could not load ${missing.join(", ")}. Try again.`);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 60_000); return () => clearInterval(timer); }, [load]);
  const gauges = useMemo(() => (briefing?.hazards ?? []).filter((r) => r.metric.toLowerCase().includes("gage height") && r.unit === "ft"), [briefing]);
  const selectedGauge: HazardReading | undefined = gauges.find((r) => r.station_id === selected) ?? gauges[0];
  useEffect(() => {
    if (!selectedGauge) { setTrend([]); setTrendState("No gauge selected."); return; }
    let active = true;
    setTrendState("Loading trend…");
    const query = new URLSearchParams({ station_id: selectedGauge.station_id, metric: selectedGauge.metric });
    fetch(`/api/hazards/history?${query}`, { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("Hourly trend unavailable.");
      return await response.json() as Point[];
    }).then((points) => { if (active) { setTrend(points); setTrendState(""); } }).catch(() => { if (active) { setTrend([]); setTrendState("Hourly trend unavailable."); } });
    return () => { active = false; };
  }, [selectedGauge?.station_id, selectedGauge?.metric]);
  async function simulate(kind: "air" | "flood") {
    setDemoBusy(true);
    try {
      const response = await fetch("/api/demo/simulate-anomaly", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) });
      if (!response.ok) throw new Error("Simulation is unavailable in this environment.");
      await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Simulation unavailable."); }
    finally { setDemoBusy(false); }
  }
  return <FeatureFrame path="/monitor" eyebrow="WATCHING FOR CHANGE" title="Live environmental monitor" description="Observed Houston station readings, their recent trends, and events requiring review.">
    <div className={styles.stack}>
      {loading && <div className={styles.loading} role="status">Loading station observations and event history…</div>}
      {error && <div className={styles.error} role="alert">{error} <button className={styles.quiet} onClick={() => void load()}>Retry</button> <a className={styles.inlineLink} href="/login">Sign in</a></div>}
      {!loading && <>
        <div className={styles.grid}><section className={styles.panel}><h2>Houston evidence map</h2><HazardMap readings={briefing?.hazards ?? []} locations={briefing?.locations ?? []} anomalies={events} airStations={air} />
          <p className={styles.source}>{briefing?.coverage ?? "Map coverage is unavailable."} Rings show unusual readings; orange or DEMO events are simulations.</p></section>
          <section className={styles.panel}><h2>Monitoring stations</h2><p className={styles.muted}>AirNow PM2.5 is an observed concentration. A bayou gauge shows observed height, not a flood stage or road-safety rating.</p>
            {!gauges.length && !air.length && <p className={styles.empty}>No station readings are available right now.</p>}
            <div className={styles.cards}>{gauges.map((gauge) => <article className={styles.card} key={gauge.station_id}><h3>{gauge.station_name}</h3><p><strong>{gauge.value.toFixed(2)} {gauge.unit}</strong> · gage height</p><p className={styles.small}>USGS · observed {when(gauge.time)} · {age(gauge.time)} {Date.now() - Date.parse(gauge.time) > 3_600_000 ? "· stale" : ""}</p><p className={styles.small}>Station ID {gauge.station_id} · stage unrated</p></article>)}</div>
            <div className={styles.cards}>{air.map((station) => <article className={styles.card} key={station.station_id}><h3>{station.station_name}</h3><p><strong>{station.value.toFixed(1)} {station.unit}</strong> · PM2.5</p><p className={styles.small}>{station.source} · observed {when(station.time)} · {age(station.time)} · {station.fresh ? "recent" : "stale"}</p><p className={styles.small}>Station ID {station.station_id}. Historical air trend is unavailable.</p></article>)}</div>
          </section></div>
        <div className={styles.grid}><section className={styles.panel}><div className={styles.between}><div><h2>Bayou height trend</h2><p className={styles.muted}>Compare the selected gauge with its own recent hourly history.</p></div>
          {gauges.length > 0 && <label className={`${styles.field} ${styles.selector}`}>Station<select value={selectedGauge?.station_id ?? ""} onChange={(event) => setSelected(event.target.value)}>{gauges.map((g) => <option value={g.station_id} key={g.station_id}>{g.station_name}</option>)}</select></label>}</div>
          {trendState && <p className={styles.small} role="status">{trendState}</p>}{selectedGauge && <Trend points={trend} unit={selectedGauge.unit} label={selectedGauge.station_name} />}</section>
          <section className={styles.panel}><div className={styles.between}><div><h2>Recent station events</h2><p className={styles.muted}>Unverified anomalies; check official sources before acting.</p></div><span className={styles.badge}>{events.length} recent</span></div>
            {!events.length && <p className={styles.empty}>No unusual station readings recorded yet.</p>}
            <div className={styles.eventList}>{events.map((event) => <article className={styles.event} key={event.id}><div className={styles.meta}><span className={`${styles.badge} ${event.is_simulated ? styles.warn : ""}`}>{event.is_simulated ? "SIMULATION" : event.severity.toUpperCase()}</span><span className={styles.badge}>{event.hazard === "flood" ? "BAYOU" : "AIR"}</span></div><strong>{event.station_name}</strong><p>{event.value.toFixed(1)} {event.unit} vs {event.baseline.toFixed(1)} {event.hazard === "flood" ? "earlier reading" : "recent baseline"}</p><p className={styles.source}>{event.source} · observed {when(event.observed_at)} · detected {when(event.detected_at)} · {event.sample_count} prior samples · {event.status}</p></article>)}</div>
            <div className={styles.actions}><button className={styles.button} disabled={demoBusy} onClick={() => void simulate("air")}>Run PM2.5 simulation</button><button className={styles.button} disabled={demoBusy} onClick={() => void simulate("flood")}>Run bayou simulation</button></div><p className={styles.source}>Simulation controls are available only when the backend permits them. Synthetic samples are not station observations.</p>
          </section></div>
      </>}
    </div>
  </FeatureFrame>;
}
