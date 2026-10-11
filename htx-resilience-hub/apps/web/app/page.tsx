"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import AskBox from "@/components/AskBox";
import PreferencesEditor from "@/components/PreferencesEditor";
import ModuleCard from "@/components/ModuleCard";
import RecommendationCard from "@/components/RecommendationCard";
import { demoBriefing, initialPreferences } from "@/lib/demo";
import { localTime } from "@/lib/format";
import type { Briefing, EnvironmentalAlert, HazardReading, Operations, UserPrefs } from "@/lib/types";

const ConditionsMap = dynamic(() => import("@/components/ConditionsMap"), { ssr: false, loading: () => <div className="map-loading">Loading Houston map…</div> });
function featuredGauge(rows: HazardReading[]): HazardReading | undefined {
  const rank = { normal: 0, watch: 1, warning: 2 };
  return rows.filter((row) => row.metric.toLowerCase().includes("gage height"))
    .sort((left, right) => rank[right.severity] - rank[left.severity] || Date.parse(right.time) - Date.parse(left.time))[0];
}
function Sparkline({ points }: { points: { time: string; value: number }[] }) {
  if (points.length < 2) return <p className="tiny">Hourly history will appear after enough observations are aggregated.</p>;
  const values = points.map((p) => p.value), min = Math.min(...values), spread = Math.max(...values) - min || 1;
  const line = points.map((point, index) => `${index / (points.length - 1) * 300},${68 - (point.value - min) / spread * 56}`).join(" ");
  return <div className="trend"><svg viewBox="0 0 300 80" role="img" aria-label={`Hourly gage history: latest ${points[points.length - 1].value.toFixed(2)} feet`}><polyline points={line} fill="none" stroke="#497b69" strokeWidth="3" /></svg><p className="tiny">Hourly station average · past 24 hours</p></div>;
}

export default function Home() {
  const [briefing, setBriefing] = useState<Briefing | null>(null), [prefs, setPrefs] = useState(initialPreferences);
  const [operations, setOperations] = useState<Operations | null>(null), [error, setError] = useState("");
  const [alerts, setAlerts] = useState<EnvironmentalAlert[]>([]), [stream, setStream] = useState("Connecting");
  const [notifications, setNotifications] = useState("Enable notifications"), [voice, setVoice] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false), [audioError, setAudioError] = useState("");
  const [history, setHistory] = useState<{ time: string; value: number }[]>([]);
  const voiceRef = useRef(false), audioRef = useRef<HTMLAudioElement | null>(null), audioUrl = useRef<string | null>(null);
  const lastId = useRef(0);
  const view = briefing;
  const forecast = view?.forecasts[0], current = forecast?.hours[0];
  const gauge = featuredGauge(view?.hazards ?? []);
  const gaugeStale = gauge && Date.now() - Date.parse(gauge.time) > 3_600_000;
  const demo = view && Object.values(view.source_status).some((s) => s === "demo");
  const grid = view?.grid;

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/briefing", { cache: "no-store" });
      if (!response.ok) throw new Error("Live briefing unavailable. Showing a labeled preview.");
      const payload = await response.json() as Briefing;
      setBriefing(payload); setError("");
      const gage = featuredGauge(payload.hazards);
      if (gage) {
        const trend = await fetch("/api/hazards/history?" + new URLSearchParams({ station_id: gage.station_id, metric: gage.metric }));
        if (trend.ok) setHistory(await trend.json() as { time: string; value: number }[]);
      }
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : "Unable to connect");
      setBriefing(demoBriefing()); setHistory([]);
    }
    try { const response = await fetch("/api/status"); if (response.ok) setOperations(await response.json() as Operations); } catch { setOperations(null); }
  }, []);

  const play = useCallback(async (text: string) => {
    setAudioError(""); setAudioBusy(true);
    try {
      const response = await fetch("/api/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: text.slice(0, 1800) }) });
      if (!response.ok) throw new Error("Voice is unavailable. Your text briefing is still here.");
      audioRef.current?.pause();
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
      audioUrl.current = URL.createObjectURL(await response.blob());
      const audio = new Audio(audioUrl.current); audioRef.current = audio;
      await audio.play();
    } catch (failure: unknown) { setAudioError(failure instanceof Error ? failure.message : "Audio playback unavailable"); }
    finally { setAudioBusy(false); }
  }, []);

  useEffect(() => {
    let events: EventSource | null = null, interval: ReturnType<typeof setInterval> | null = null, cancelled = false;
    async function init() {
      try {
        await fetch("/api/session");
        const response = await fetch("/api/prefs");
        if (response.ok) {
          const payload = await response.json() as { preferences: UserPrefs };
          if (!cancelled) setPrefs(payload.preferences.locations.length ? payload.preferences : { ...initialPreferences, user_id: payload.preferences.user_id });
        }
      } catch { /* Labeled frontend preview remains available. */ }
      if (cancelled) return;
      lastId.current = Number(sessionStorage.getItem("noach_last_alert") ?? "0") || 0;
      try { setAlerts(JSON.parse(sessionStorage.getItem("noach_alerts") ?? "[]") as EnvironmentalAlert[]); } catch { setAlerts([]); }
      void refresh(); interval = setInterval(() => void refresh(), 60_000);
      events = new EventSource("/api/alerts?after=" + lastId.current);
      events.addEventListener("ready", () => setStream("Connected"));
      events.addEventListener("status", () => setStream("Alert storage unavailable"));
      events.onerror = () => setStream("Reconnecting");
      events.addEventListener("alert", (event) => {
        let alert: EnvironmentalAlert;
        try { alert = JSON.parse((event as MessageEvent<string>).data) as EnvironmentalAlert; } catch { return; }
        if (Number(alert.id) <= lastId.current) return;
        lastId.current = Number(alert.id); sessionStorage.setItem("noach_last_alert", alert.id);
        setAlerts((old) => { const next = [alert, ...old].slice(0, 12); sessionStorage.setItem("noach_alerts", JSON.stringify(next)); return next; });
        const recent = Date.now() - new Date(alert.time).getTime() < 120_000;
        if (recent && "Notification" in window && Notification.permission === "granted") {
          const notice = new Notification(alert.demo ? "DEMO · noach.select" : "noach.select · conditions changed", {
            body: alert.message, tag: `noach:${alert.location_id}:${alert.hazard}`,
          });
          notice.onclick = () => { window.focus(); document.getElementById("alerts")?.scrollIntoView({ behavior: "smooth" }); notice.close(); };
        }
        if (recent && voiceRef.current) void play((alert.demo ? "Demonstration alert. " : "") + alert.message);
        void refresh();
      });
    }
    void init();
    return () => { cancelled = true; events?.close(); if (interval) clearInterval(interval); audioRef.current?.pause(); if (audioUrl.current) URL.revokeObjectURL(audioUrl.current); };
  }, [play, refresh]);

  async function save(value: UserPrefs): Promise<string> {
    const response = await fetch("/api/prefs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
    const payload = await response.json() as { preferences: UserPrefs; storage: string; memory?: string; detail?: string; error?: string };
    if (!response.ok) throw new Error(payload.detail ?? payload.error ?? "Preferences were not saved");
    setPrefs(payload.preferences); await refresh();
    return `Saved to ${payload.storage}. Memory: ${payload.memory ?? "off"}.`;
  }
  async function enableNotifications() {
    if (!("Notification" in window)) { setNotifications("Browser notifications unsupported"); return; }
    try { const permission = await Notification.requestPermission(); setNotifications(permission === "granted" ? "Notifications enabled" : "Notifications not enabled"); }
    catch { setNotifications("Notifications unavailable"); }
  }
  async function sendDemo() {
    try {
      const response = await fetch("/api/alerts/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "Explicit demo alert" }) });
      if (!response.ok) throw new Error("Demo alert could not reach the worker storage. Start the backend and apply migrations.");
      setError("Demo alert queued. The worker will deliver it within a minute; local fallback delivery is labeled separately.");
    } catch (failure: unknown) { setError(failure instanceof Error ? failure.message : "Demo alert unavailable"); }
  }

  return <div className="app-shell">
    <header className="site-header"><a href="/" className="wordmark">noach<span className="orange-dot" />select</a><nav aria-label="Main navigation"><a href="#today">Today</a><a href="#map">Map</a><a href="#evidence">Conditions</a><a href="#alerts">Alerts <span className="nav-count">{alerts.length}</span></a></nav><span className="header-location">HOUSTON, TX <span className="live-dot" /></span></header>
    <main>
      <section className="hero" id="today"><div><p className="section-label">YOUR DAY, WITH A LITTLE MORE CLARITY</p><h1>Good plans start with<br /><em>knowing your surroundings.</em></h1><p className="hero-copy">Your personal environmental assistant. Local conditions,<br className="desktop-break" /> thoughtful recommendations, and a heads-up when things change.</p></div><div className="hero-stamp"><span className="stamp-symbol" aria-hidden>↗</span><span>SMALL DECISIONS.<br />A MORE RESILIENT HOUSTON.</span></div></section>
      {error && <div className="notice" role="status">{error}</div>}
      {demo && <div className="notice">Demo data is visible. Simulated values are not live observations.</div>}
      <div className="workspace">
        <AskBox />
        <section className="panel briefing-panel"><div className="panel-heading"><div><p className="section-label">THE DAILY BRIEF</p><h2>What should I do today?</h2></div><span className="brief-icon" aria-hidden>☀</span></div>
          <div className="weather-strip"><div><span className="big-number">{current?.temperature_2m !== undefined ? Math.round(current.temperature_2m) + "°" : "—"}</span><span className="tiny">{forecast?.location.name ?? "Houston"} · model forecast</span></div><div><strong>{current?.apparent_temperature !== undefined ? Math.round(current.apparent_temperature) + "°F" : "—"}</strong><span className="tiny">Feels like</span></div><div><strong>{current?.us_aqi !== undefined ? Math.round(current.us_aqi) : "—"}</strong><span className="tiny">Modeled US AQI</span></div></div>
          {!view && <p className="muted">Gathering environmental context…</p>}
          <div className="recommendations">{view?.recommendations.map((card) => <RecommendationCard key={card.id} card={card} timezone={view.timezone} />)}</div>
          <button className="secondary listen-button" disabled={!voice || audioBusy || !view} onClick={() => void play((demo ? "Demonstration briefing. " : "") + (view?.recommendations.map((r) => r.title + ". " + r.reason).join(" ") ?? ""))}>{audioBusy ? "Preparing audio…" : "◖ Listen to my briefing"}</button>
          <p className="tiny">{view ? "Updated " + localTime(view.generated_at, view.timezone) : "Waiting for data"} · <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> / <a href="https://atmosphere.copernicus.eu/" target="_blank" rel="noreferrer">CAMS</a></p>
        </section>
      </div>
      <section id="map" className="map-section"><div className="section-heading"><div><p className="section-label">THE MAP</p><h2>Check any spot in Houston.</h2></div><span className="tiny">Air quality, heat, rain, bayou gauges and the power grid, with advice that follows where you tap</span></div>
        <ConditionsMap readings={view?.hazards ?? []} prefs={prefs} grid={grid} />
      </section>
      <PreferencesEditor value={prefs} onSave={save} />
      <section id="alerts" className="panel alerts-panel"><div className="panel-heading"><div><p className="section-label">A HEADS-UP, WHEN IT MATTERS</p><h2>You don’t have to keep checking.</h2></div><span className="tag">{stream}</span></div>
        <div className="notification-controls"><button className="secondary" onClick={() => void enableNotifications()}>{notifications}</button><label className="voice-toggle"><input type="checkbox" checked={voice} onChange={(event) => { setVoice(event.target.checked); voiceRef.current = event.target.checked; if (!event.target.checked) audioRef.current?.pause(); }} />Enable voice briefings</label><button className="quiet" onClick={() => void sendDemo()}>Try demo alert ↗</button></div>
        <p className="tiny">Notifications work while this dashboard is running. Routine checks use your saved time and thresholds; these are not official emergency alerts.</p>
        {audioError && <p className="notice" role="status">{audioError}</p>}
        {!alerts.length && <div className="empty-alert"><span aria-hidden>◎</span><div><strong>We’ll let you know when conditions change.</strong><p className="muted">Save a routine to personalize your alerts, or try a clearly labeled demonstration.</p></div></div>}
        <div className="alert-list" aria-live="polite">{alerts.map((alert) => <article className="alert-card" key={alert.id}><span className="tag">{alert.demo ? "DEMO" : alert.severity} · {alert.hazard}</span><p>{alert.message}</p><span className="tiny">{localTime(alert.time)}</span><div className="action-links">{alert.suggestions.map((s) => <a href={s.source_url} key={s.title} target="_blank" rel="noreferrer">{s.title} ↗</a>)}</div></article>)}</div>
      </section>
      <section id="evidence"><div className="section-heading"><div><p className="section-label">THE CONTEXT BEHIND THE ADVICE</p><h2>Houston, at a glance.</h2></div><span className="tiny">Observations and forecasts are labeled separately</span></div>
        <div className="module-grid">
          <ModuleCard title="Bayou conditions" value={gauge ? gauge.value.toFixed(2) + " ft" : "Awaiting gauges"} status={gaugeStale ? "stale observation" : view?.source_status.flood ?? "connecting"} caption={gauge ? gauge.station_name + " · " + localTime(gauge.time) + " · app " + gauge.severity : "USGS instantaneous observations"} />
          <ModuleCard title="Air quality" value={current?.us_aqi !== undefined ? Math.round(current.us_aqi) + " US AQI" : "Unavailable"} status={view?.source_status.air ?? "connecting"} caption="Modeled forecast · CAMS / Open-Meteo" accent="orange" />
          <ModuleCard title="Power grid" value={grid ? grid.title : "Connecting"} status={grid?.status ?? "connecting"} caption={grid?.status === "live" ? (grid.reserves_mw ? grid.reserves_mw + " MW operating reserves · " : "") + "ERCOT statewide, not an outage map" : grid?.note ?? "ERCOT grid conditions"} accent={!grid?.severity ? "neutral" : grid.severity === "normal" ? undefined : "orange"} />
        </div>
        <details className="panel evidence-details"><summary>Explore hourly bayou history <span>+</span></summary>
          <Sparkline points={history} />
          <p className="tiny">{view?.coverage}</p>
        </details>
      </section>
      <details className="panel operations"><summary><span><span className="live-dot" /> Keeping your context current</span><span className="tiny">{operations?.hosting ?? "Checking deployment"} · View system status +</span></summary>
        <p className="muted">The cloud workers collect environmental data every 15 minutes and evaluate routines every minute.</p>
        <div className="status-grid"><div><span className="tiny">API</span><strong>{operations?.api ?? "unavailable"}</strong></div><div><span className="tiny">Tiger Data</span><strong>{operations?.database ?? "unavailable"}</strong></div><div><span className="tiny">Latest flood observation</span><strong>{operations?.latest_flood_observation ? localTime(operations.latest_flood_observation) : "No observation"}</strong></div></div>
        {operations?.jobs.map((job) => <p key={job.job} className="tiny">{job.job.replaceAll("_", " ")} · {job.status} · heartbeat {localTime(job.heartbeat)} · last success {job.last_success ? localTime(job.last_success) : "never"} · {job.rows_written} rows</p>)}
        <p className="tiny">Configured does not mean verified: {operations && Object.entries(operations.integrations).map(([key, value]) => key + ": " + value).join(" · ")}</p>
      </details>
    </main>
    <footer><a className="wordmark" href="/">noach<span className="orange-dot" />select</a><p>Local awareness. Everyday resilience.</p><span className="tiny">Built for Houston · CodeRED: Orion 2026</span></footer>
  </div>;
}
