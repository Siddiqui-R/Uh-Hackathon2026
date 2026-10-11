"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import AskBox from "@/components/AskBox";
import AccountPanel from "@/components/AccountPanel";
import PreferencesEditor from "@/components/PreferencesEditor";
import ModuleCard from "@/components/ModuleCard";
import RecommendationCard from "@/components/RecommendationCard";
import SiteNavigation from "@/components/SiteNavigation";
import PlanningHeader from "@/components/PlanningHeader";
import { demoBriefing, initialPreferences } from "@/lib/demo";
import { forecastTime, forecastNumber } from "@/lib/forecastPresentation";
import { localTime } from "@/lib/format";
import type { AirStation, AnomalyEvent, Briefing, EnvironmentalAlert, HazardReading, Operations, UserPrefs } from "@/lib/types";

const HazardMap = dynamic(() => import("@/components/HazardMap"), { ssr: false, loading: () => <div className="map-loading">Loading Houston map…</div> });
const ConditionsMap = dynamic(() => import("@/components/ConditionsMap"), { ssr: false, loading: () => <div className="map-loading">Loading Houston map…</div> });
function featuredGauge(rows: HazardReading[]): HazardReading | undefined {
  return rows.filter((row) => row.metric.toLowerCase().includes("gage height") && row.unit === "ft")
    .sort((left, right) => Date.parse(right.time) - Date.parse(left.time))[0];
}
function Sparkline({ points }: { points: { time: string; value: number }[] }) {
  if (points.length < 2) return <p className="tiny">Hourly history will appear after enough observations are aggregated.</p>;
  const values = points.map((p) => p.value), min = Math.min(...values), spread = Math.max(...values) - min || 1;
  const line = points.map((point, index) => `${index / (points.length - 1) * 300},${68 - (point.value - min) / spread * 56}`).join(" ");
  return <div className="trend"><svg viewBox="0 0 300 80" role="img" aria-label={`Hourly gage history: latest ${points[points.length - 1].value.toFixed(2)} feet`}><polyline points={line} fill="none" stroke="#497b69" strokeWidth="3" /></svg><p className="tiny">Hourly station average · past 24 hours</p></div>;
}

export type WorkspacePage = "dashboard" | "places" | "routines" | "recommendations" | "monitor" | "assistant" | "settings";
const navigation: { page: WorkspacePage; label: string; href: string }[] = [
  { page: "dashboard", label: "Dashboard", href: "/" },
  { page: "places", label: "Places", href: "/places" },
  { page: "routines", label: "Routines", href: "/routines" },
  { page: "recommendations", label: "Recommendations", href: "/recommendations" },
  { page: "monitor", label: "Live Monitor", href: "/monitor" },
  { page: "assistant", label: "Ask the Assistant", href: "/assistant" },
  { page: "settings", label: "Settings", href: "/settings" },
];
const pageDescriptions: Record<WorkspacePage, string> = {
  dashboard: "Your environmental overview and alerts.",
  places: "Save the Houston places that matter to your plans.",
  routines: "Build a schedule for the activities you care about.",
  recommendations: "Find a better time for your outdoor plans.",
  monitor: "Explore observed conditions and unusual station readings.",
  assistant: "Ask grounded questions about your plans and local conditions.",
  settings: "Manage your profile, thresholds and notification preferences.",
};

export default function Workspace({ page, returnToPlanner = false }: { page: WorkspacePage; returnToPlanner?: boolean }) {
  const [briefing, setBriefing] = useState<Briefing | null>(null), [prefs, setPrefs] = useState(initialPreferences);
  const [operations, setOperations] = useState<Operations | null>(null), [error, setError] = useState("");
  const [prefsError, setPrefsError] = useState("");
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [viewer, setViewer] = useState<{ mode: "account" | "demo"; email?: string; display_name?: string } | null>(null);
  const [sessionError, setSessionError] = useState("");
  const [alerts, setAlerts] = useState<EnvironmentalAlert[]>([]), [stream, setStream] = useState("Connecting");
  const [readingId, setReadingId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState("Enable notifications"), [voice, setVoice] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false), [audioError, setAudioError] = useState("");
  const [history, setHistory] = useState<{ time: string; value: number }[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyEvent[]>([]), [airStations, setAirStations] = useState<AirStation[]>([]);
  const [monitorStatus, setMonitorStatus] = useState("Connecting"), [demoBusy, setDemoBusy] = useState(false);
  const voiceRef = useRef(false), notifyRef = useRef(false), audioRef = useRef<HTMLAudioElement | null>(null), audioUrl = useRef<string | null>(null);
  const lastId = useRef(0);
  const knownAlertIds = useRef<Set<string>>(new Set());
  const readOverrides = useRef<Map<string, string | null>>(new Map());
  const alertCacheKey = useRef<string | null>(null);
  const view = briefing;
  const forecast = view?.forecasts[0];
  const current = forecast?.hours.find((hour) => Date.parse(hour.time) <= Date.now() && Date.now() < Date.parse(hour.time) + 3_600_000);
  const gauge = featuredGauge(view?.hazards ?? []);
  const gaugeStale = gauge && Date.now() - Date.parse(gauge.time) > 3_600_000;
  const observedAir = airStations.filter((station) => station.fresh).sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0];
  const demo = view?.source_status.weather === "demo" && view.source_status.air === "demo";
  const hasDemoSource = view && Object.values(view.source_status).some((s) => s === "demo");
  const temporary = view?.source_status.preferences === "temporary memory";
  const unreadCount = alerts.filter((alert) => !alert.read_at).length;
  const grid = view?.grid;

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/briefing", { cache: "no-store" });
      if (response.status === 401) { setSessionError("Your account session expired. Sign in again."); return; }
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
    const [statusResult, anomaliesResult, airResult] = await Promise.allSettled([
      fetch("/api/status", { cache: "no-store" }), fetch("/api/anomalies", { cache: "no-store" }),
      fetch("/api/air/stations", { cache: "no-store" }),
    ]);
    if (statusResult.status === "fulfilled" && statusResult.value.ok) setOperations(await statusResult.value.json() as Operations);
    else setOperations(null);
    if (anomaliesResult.status === "fulfilled" && anomaliesResult.value.ok) setAnomalies(await anomaliesResult.value.json() as AnomalyEvent[]);
    if (airResult.status === "fulfilled" && airResult.value.ok) setAirStations(await airResult.value.json() as AirStation[]);
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
    let events: EventSource | null = null, anomalyEvents: EventSource | null = null, interval: ReturnType<typeof setInterval> | null = null, cancelled = false;
    async function init() {
      let cacheKey: string | null = null;
      let session: { mode: "account" | "demo"; email?: string; display_name?: string };
      try {
        const sessionResponse = await fetch("/api/session", { cache: "no-store" });
        if (!sessionResponse.ok) { if (!cancelled) setSessionError("Your account session expired or could not be verified."); return; }
        session = await sessionResponse.json() as { mode: "account" | "demo"; email?: string; display_name?: string };
        if (!cancelled) setViewer(session);
      } catch { if (!cancelled) setSessionError("Your session could not be loaded. Please try again."); return; }
      try {
        const response = await fetch("/api/prefs");
        if (response.status === 401) { if (!cancelled) setSessionError("Your account session expired. Sign in again."); return; }
        if (response.ok) {
          const payload = await response.json() as { preferences: UserPrefs };
          cacheKey = `guardian_alerts_v3:${payload.preferences.user_id}`;
          if (!cancelled) {
            const next = session.mode === "demo" && !payload.preferences.locations.length
              ? { ...initialPreferences, user_id: payload.preferences.user_id } : payload.preferences;
            setPrefs(next); setPrefsLoaded(true); setVoice(next.voice_enabled ?? false);
            voiceRef.current = next.voice_enabled ?? false;
            notifyRef.current = next.notifications_enabled ?? false;
          }
        } else if (!cancelled) setPrefsError("Saved preferences are unavailable. Showing available conditions.");
      } catch { if (!cancelled) setPrefsError("Saved preferences are unavailable. Showing available conditions."); }
      if (cancelled) return;
      alertCacheKey.current = cacheKey;
      lastId.current = 0;
      try {
        const cached = cacheKey ? JSON.parse(sessionStorage.getItem(cacheKey) ?? "[]") as EnvironmentalAlert[] : [];
        knownAlertIds.current = new Set(cached.map((alert) => alert.id));
        setAlerts(cached);
      } catch { knownAlertIds.current = new Set(); setAlerts([]); }
      void refresh(); interval = setInterval(() => void refresh(), 60_000);
      const streamOpenedAt = Date.now();
      events = new EventSource("/api/alerts?after=0");
      events.addEventListener("ready", () => setStream("Connected"));
      events.addEventListener("status", () => setStream("Alert storage unavailable"));
      events.onerror = () => setStream("Reconnecting");
      events.addEventListener("alert", (event) => {
        let alert: EnvironmentalAlert;
        try { alert = JSON.parse((event as MessageEvent<string>).data) as EnvironmentalAlert; } catch { return; }
        if (readOverrides.current.has(alert.id)) alert = { ...alert, read_at: readOverrides.current.get(alert.id) };
        if (Number(alert.id) <= lastId.current) return;
        lastId.current = Number(alert.id);
        const alreadyKnown = knownAlertIds.current.has(alert.id);
        knownAlertIds.current.add(alert.id);
        setAlerts((old) => {
          const next = [alert, ...old.filter((entry) => entry.id !== alert.id)].sort((left, right) => Number(right.id) - Number(left.id)).slice(0, 12);
          if (alertCacheKey.current) sessionStorage.setItem(alertCacheKey.current, JSON.stringify(next));
          return next;
        });
        const alertTime = new Date(alert.time).getTime();
        const recent = !alreadyKnown && alertTime >= streamOpenedAt && Date.now() - alertTime < 120_000;
        if (recent && notifyRef.current && "Notification" in window && Notification.permission === "granted") {
          const notice = new Notification(alert.demo ? "DEMO · Noach" : "Noach · conditions changed", {
            body: alert.message, tag: `guardian:${alert.location_id}:${alert.hazard}`,
          });
          notice.onclick = () => { window.focus(); document.getElementById("alerts")?.scrollIntoView({ behavior: "smooth" }); notice.close(); };
        }
        if (recent && voiceRef.current) void play((alert.demo ? "Demonstration alert. " : "") + alert.message);
        void refresh();
      });
      anomalyEvents = new EventSource("/api/anomalies/stream");
      anomalyEvents.addEventListener("ready", () => setMonitorStatus("Live"));
      anomalyEvents.addEventListener("status", () => setMonitorStatus("Data unavailable"));
      anomalyEvents.onerror = () => setMonitorStatus("Reconnecting");
      anomalyEvents.addEventListener("anomaly", (event) => {
        try {
          const anomaly = JSON.parse((event as MessageEvent<string>).data) as AnomalyEvent;
          setAnomalies((old) => [anomaly, ...old.filter((entry) => entry.id !== anomaly.id)].slice(0, 20));
        } catch { /* Ignore malformed stream events. */ }
      });
    }
    void init();
    return () => { cancelled = true; events?.close(); anomalyEvents?.close(); if (interval) clearInterval(interval); audioRef.current?.pause(); if (audioUrl.current) URL.revokeObjectURL(audioUrl.current); };
  }, [play, refresh]);

  async function toggleAlertRead(alert: EnvironmentalAlert) {
    const read = !alert.read_at;
    setReadingId(alert.id);
    try {
      const response = await fetch("/api/alerts/read", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alert_id: Number(alert.id), read }) });
      if (!response.ok) throw new Error("Could not update this alert. Please try again.");
      const updated = await response.json() as { id: string; read_at: string | null };
      readOverrides.current.set(updated.id, updated.read_at);
      setAlerts((old) => {
        const next = old.map((item) => item.id === updated.id ? { ...item, read_at: updated.read_at } : item);
        if (alertCacheKey.current) sessionStorage.setItem(alertCacheKey.current, JSON.stringify(next));
        return next;
      });
    } catch (failure: unknown) { setError(failure instanceof Error ? failure.message : "Alert update unavailable"); }
    finally { setReadingId(null); }
  }

  async function save(value: UserPrefs): Promise<string> {
    const currentResponse = await fetch("/api/prefs", { cache: "no-store" });
    if (!currentResponse.ok) throw new Error("Saved preferences are unavailable. Please try again.");
    const current = (await currentResponse.json() as { preferences: UserPrefs }).preferences;
    const updated: UserPrefs = page === "places" ? { ...current, locations: value.locations, routines: value.routines }
      : page === "routines" ? { ...current, locations: viewer?.mode === "demo" && !current.locations.length ? value.locations : current.locations, routines: value.routines }
      : { ...current, timezone: value.timezone, thresholds: value.thresholds, memory_enabled: value.memory_enabled,
          notifications_enabled: value.notifications_enabled, voice_enabled: value.voice_enabled };
    const response = await fetch("/api/prefs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updated) });
    const payload = await response.json() as { preferences: UserPrefs; storage: string; memory?: string; detail?: string; error?: string };
    if (!response.ok) throw new Error(payload.detail ?? payload.error ?? "Preferences were not saved");
    setPrefs(payload.preferences); await refresh();
    setPrefsError("");
    notifyRef.current = payload.preferences.notifications_enabled ?? false;
    voiceRef.current = payload.preferences.voice_enabled ?? false;
    setVoice(payload.preferences.voice_enabled ?? false);
    return `Saved to ${payload.storage}. Memory: ${payload.memory ?? "off"}.`;
  }
  async function logout() {
    const response = await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (response.ok) window.location.replace("/login");
    else setSessionError("Could not end the session. Please try again.");
  }
  async function enableNotifications() {
    if (!("Notification" in window)) { setNotifications("Browser notifications unsupported"); return; }
    try { const permission = await Notification.requestPermission(); setNotifications(permission === "granted" ? "Notifications enabled" : "Notifications not enabled"); }
    catch { setNotifications("Notifications unavailable"); }
  }
  async function sendDemo(kind: "air" | "flood") {
    setDemoBusy(true);
    try {
      const response = await fetch("/api/demo/simulate-anomaly", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }) });
      if (!response.ok) throw new Error(response.status === 404 ? "Simulation is disabled in this environment." : "Simulation needs the backend, database and latest migration.");
      const result = await response.json() as { event?: AnomalyEvent };
      if (result.event) setAnomalies((old) => [result.event!, ...old.filter((event) => event.id !== result.event!.id)].slice(0, 20));
      setError(`DEMO: A synthetic ${kind === "flood" ? "gage-height rise" : "PM2.5 spike"} passed through the detector. Nearby saved places receive an in-app alert.`);
    } catch (failure: unknown) { setError(failure instanceof Error ? failure.message : "Demo anomaly unavailable"); }
    finally { setDemoBusy(false); }
  }

  return <div className={`app-shell${page === "places" ? " planning-workspace" : ""}`}>
    <SiteNavigation path={navigation.find((item) => item.page === page)?.href ?? "/"} unreadCount={unreadCount}
      account={<span className="account-status">{viewer?.mode === "account" ? <><span>{viewer.display_name ?? viewer.email}</span><button className="quiet" onClick={() => void logout()}>Log out</button></> : <span>Checking sign-in…</span>}</span>} />
    <main id="main-content" tabIndex={-1}>
      {sessionError ? <section className="panel signed-out"><h1>Sign in again</h1><p className="muted">{sessionError}</p><div className="hero-actions"><a className="primary" href={`/login?next=${encodeURIComponent(navigation.find((item) => item.page === page)?.href ?? "/")}`}>Sign in</a></div></section> : <>
      {page === "dashboard" ? <section className="hero" id="today"><div><p className="section-label">ENVIRONMENTAL INTELLIGENCE FOR HOUSTON</p><h1>Know what’s changing.<br /><em>Plan around it.</em></h1><p className="hero-copy">Weather, air and bayou conditions in one place. Get a grounded answer for your plans and a heads-up when a nearby reading changes.</p><div className="hero-actions"><a className="primary" href="/routines">Plan an activity ↗</a><a className="secondary" href="/monitor">Explore live monitor</a></div></div><div className="hero-stamp"><span className="stamp-symbol" aria-hidden>◎</span><span>LOCAL SIGNALS<br />BETTER DECISIONS</span></div></section> : page === "places" ? <PlanningHeader step="places" prefs={prefsLoaded ? prefs : null} /> :
        <section className="page-intro"><p className="section-label">NOACH / HOUSTON</p><h1>{navigation.find((item) => item.page === page)?.label}</h1><p className="muted">{pageDescriptions[page]}</p></section>}
      {viewer?.mode === "demo" && <div className="demo-banner">You are exploring with a browser demo. <a href="/signup">Create an account</a> to save your plan across devices.</div>}
      {!viewer && <p className="muted" role="status">Loading your plan…</p>}
      {error && <div className="notice" role="status">{error}</div>}
      {prefsError && <div className="notice" role="status">{prefsError}</div>}
      {hasDemoSource && <div className="notice">Demo data is visible. Simulated values are not live observations.</div>}
      {temporary && <div className="notice">Local rehearsal: saved plans, simulated events and alerts are temporary and reset when the API restarts. Weather and AQI are live modeled forecasts only when labeled as such.</div>}
      {(page === "dashboard" || page === "recommendations") && <section className="conditions" aria-label="Current environmental conditions"><div className="section-heading"><div><p className="section-label">01 / THE CURRENT PICTURE</p><h2>Houston at a glance</h2></div><span className="tiny">Forecasts and observations are labeled separately</span></div>
        <div className="module-grid">
          <ModuleCard title="Temperature" value={forecastNumber(current?.temperature_2m, "°F")} status={view?.source_status.weather ?? "connecting"} caption={forecast ? `${forecast.location.name} · ${demo ? "illustrative preview" : "Open-Meteo forecast"} · retrieved ${forecastTime(forecast.retrieved_at, view?.timezone)} · valid ${forecastTime(current?.time, view?.timezone)}` : "Awaiting forecast"} />
          <ModuleCard title="Air quality" value={observedAir ? observedAir.value.toFixed(1) + " µg/m³" : current?.us_aqi !== undefined ? Math.round(current.us_aqi) + " US AQI" : "Unavailable"} status={observedAir ? "observed PM2.5" : view?.source_status.air ?? "connecting"} caption={observedAir ? `${observedAir.station_name} · AirNow observation · ${forecastTime(observedAir.time, view?.timezone)}` : demo ? "Illustrative preview · not a live AQI" : `Modeled AQI · CAMS / Open-Meteo · retrieved ${forecastTime(forecast?.retrieved_at, view?.timezone)} · valid ${forecastTime(current?.time, view?.timezone)}`} accent="orange" />
          <ModuleCard title="Bayou gauge" value={gauge ? gauge.value.toFixed(2) + " ft" : "Unavailable"} status={gaugeStale ? "stale observation" : view?.source_status.flood ?? "connecting"} caption={gauge ? `${gauge.station_name} · ${view?.source_status.flood === "demo" ? "simulated reading" : "USGS observation"} · stage not rated · ${forecastTime(gauge.time, view?.timezone)}` : "Awaiting USGS observation"} />
        </div>
      </section>}
      {page === "dashboard" && current?.data_quality_notes?.length ? <div className="forecast-quality"><strong>Forecast data quality needs review</strong>{current.data_quality_notes.map((note) => <p key={note}>{note} Valid {forecastTime(current.time, view?.timezone)}.</p>)}</div> : null}
      {page === "dashboard" && <div className="feature-cards">
        <a href="/places" className="panel"><span className="section-label">01 / PLACES</span><strong>Save your places ↗</strong><span>Get conditions around where you live, study, or work.</span></a>
        <a href="/recommendations" className="panel"><span className="section-label">02 / RECOMMENDATIONS</span><strong>Plan a better hour ↗</strong><span>Compare your next routine with nearby forecast hours.</span></a>
        <a href="/assistant" className="panel"><span className="section-label">03 / ASSISTANT</span><strong>Ask a question ↗</strong><span>Get grounded guidance for your plans.</span></a>
      </div>}
      {page === "assistant" && <div className="assistant-page"><AskBox /></div>}
      {page === "recommendations" && <section className="panel briefing-panel"><div className="panel-heading"><div><p className="section-label">YOUR OUTDOOR PLAN</p><h2>A clearer time to go</h2></div><span className="tag">Modeled forecast</span></div>
          <div className="weather-strip"><div><span className="big-number">{current?.temperature_2m !== undefined ? Math.round(current.temperature_2m) + "°F" : "—"}</span><span className="tiny">{forecast?.location.name ?? "Houston"} · {demo ? "illustrative preview" : "model forecast"}</span></div><div><strong>{current?.apparent_temperature !== undefined ? Math.round(current.apparent_temperature) + "°F" : "—"}</strong><span className="tiny">Feels like</span></div><div><strong>{current?.us_aqi !== undefined ? Math.round(current.us_aqi) : "—"}</strong><span className="tiny">{demo ? "Demo US AQI" : "Modeled US AQI"}</span></div></div>
          {!view && <p className="muted">Gathering environmental context…</p>}
          <div className="recommendations">{view?.recommendations.length ? view.recommendations.map((card) => <RecommendationCard key={card.id} card={card} timezone={view.timezone} />) : view ? <p className="empty-events">No routine recommendations yet. <a href="/routines">Add a routine</a> to personalize this page.</p> : null}</div>
          <button className="secondary listen-button" disabled={!voice || audioBusy || !view} onClick={() => void play((demo ? "Demonstration briefing. " : "") + (view?.recommendations.map((r) => r.title + ". " + r.reason).join(" ") ?? ""))}>{audioBusy ? "Preparing audio…" : "◖ Listen to my briefing"}</button>
          <p className="tiny">{view ? "Updated " + localTime(view.generated_at, view.timezone) : "Waiting for data"} · <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> / <a href="https://atmosphere.copernicus.eu/" target="_blank" rel="noreferrer">CAMS</a></p>
        </section>}
      {page === "places" && prefsLoaded && <div className="settings-anchor"><PreferencesEditor value={prefs} onSave={save} section="places" />
        {returnToPlanner && <p className="notice"><a href="/routines">← Back to the activity planner</a> after saving your place.</p>}</div>}
      {page === "routines" && <div className="settings-anchor"><PreferencesEditor value={prefs} onSave={save} section="routines" /></div>}
      {page === "places" && !prefsLoaded && <p className="tiny" role="status">{prefsError ? "Saved places unavailable. Try reloading." : "Loading saved places…"}</p>}
      {page === "places" && prefsLoaded && <section id="map" className="map-section"><div className="section-heading"><div><p className="section-label">FIELD MAP / HOUSTON</p><h2>Explore conditions</h2></div><span className="tiny">Select a place or drop a pin.</span></div>
        <ConditionsMap readings={view?.hazards ?? []} prefs={prefs} grid={grid} gaugeMode={view?.source_status.flood} />
      </section>}
      {page === "monitor" && <section id="monitor" className="monitor-section"><div className="section-heading"><div><p className="section-label">WATCHING FOR CHANGE</p><h2>Live environmental monitor</h2></div><span className="tag"><span className="live-dot" /> {monitorStatus}</span></div>
        <div className="monitor-grid"><div className="panel monitor-map"><HazardMap readings={view?.hazards ?? []} locations={prefs.locations} anomalies={anomalies} airStations={airStations} /><Sparkline points={history} /><p className="tiny">{view?.coverage}</p></div>
          <div className="panel event-panel"><div className="panel-heading"><div><p className="section-label">STATION SIGNALS</p><h3>Unusual readings</h3></div><span className="tag">{anomalies.length} recorded</span></div>
            <p className="muted">New station readings are compared with that station’s recent history. An anomaly needs review; it does not confirm an emergency.</p>
            <div className="event-list" aria-live="polite">{anomalies.length ? anomalies.slice(0, 5).map((event) => <article className="event-card" key={event.id}><div className="event-top"><span className="tag">{event.is_simulated ? "DEMO" : event.severity} · {event.hazard === "flood" ? "WATER" : "AIR"}</span><span className="tiny">{localTime(event.observed_at)}</span></div><strong>{event.station_name}</strong><p>{event.hazard === "flood" ? "Gage height" : "PM2.5"} {event.value.toFixed(1)} {event.unit} <span>vs {event.baseline.toFixed(1)} {event.hazard === "flood" ? "about an hour earlier" : "recent average"}</span></p><span className="tiny">{event.source} · {event.sample_count} prior samples · {event.status}{event.hazard === "flood" ? ` · ${event.score.toFixed(2)} ft/hour rise` : ""}</span></article>) : <p className="empty-events">No unusual station readings recorded yet.</p>}</div>
            <div className="demo-actions"><button className="secondary demo-button" disabled={demoBusy} onClick={() => void sendDemo("air")}>{demoBusy ? "Running simulation…" : "Run labeled PM2.5 demo ↗"}</button><button className="secondary demo-button" disabled={demoBusy} onClick={() => void sendDemo("flood")}>Run labeled bayou-rise demo ↗</button></div><p className="tiny">Synthetic samples run through the detectors and stay out of real sensor history. Simulation requires database setup and demo access.</p>
          </div></div>
      </section>}
      {page === "settings" && viewer && <><AccountPanel viewer={viewer} onUpdate={(display_name) => setViewer({ ...viewer, display_name })} onLogout={logout} /><PreferencesEditor value={prefs} onSave={save} section="settings" /><div className="notification-controls"><button className="secondary" onClick={() => void enableNotifications()}>{notifications}</button><span className="tiny">Enable browser permission after saving your notification preference.</span></div></>}
      {(page === "dashboard" || page === "monitor") && <section id="alerts" className="panel alerts-panel"><div className="panel-heading"><div><p className="section-label">PERSONAL HEADS-UP</p><h2>Alerts for your places and plans</h2></div><span className="tag">{unreadCount} unread · {stream}</span></div>
        <p className="tiny">Notifications work while this dashboard is running. Routine checks use your saved forecast thresholds; station alerts describe observed changes. These are not official emergency alerts.</p>
        {audioError && <p className="notice" role="status">{audioError}</p>}
        {!alerts.length && <div className="empty-alert"><span aria-hidden>◎</span><div><strong>We’ll let you know when conditions change.</strong><p className="muted">Save a routine to personalize your alerts, or try a clearly labeled demonstration.</p></div></div>}
        <div className="alert-list" aria-live="polite">{alerts.map((alert) => <article className={`alert-card ${alert.read_at ? "is-read" : "is-unread"}`} key={alert.id}><div className="alert-meta"><span className="tag">{alert.demo ? "DEMO" : alert.severity} · {alert.hazard}</span><span className="tiny">{alert.read_at ? "Read" : "Unread"}</span></div><p>{alert.message}</p><span className="tiny">{localTime(alert.time)}</span><div className="action-links">{alert.suggestions.map((s) => <a href={s.source_url} key={s.title} target="_blank" rel="noreferrer">{s.title} ↗</a>)}</div><button className="quiet alert-read-toggle" disabled={readingId === alert.id} onClick={() => void toggleAlertRead(alert)}>{readingId === alert.id ? "Saving…" : alert.read_at ? "Mark unread" : "Mark as read"}</button></article>)}</div>
      </section>}
      {page === "dashboard" && <details className="panel operations"><summary><span><span className="live-dot" /> Keeping your context current</span><span className="tiny">{operations?.hosting ?? "Checking deployment"} · View system status +</span></summary>
        <p className="muted">The cloud workers collect environmental data every 15 minutes and evaluate routines every minute.</p>
        <div className="status-grid"><div><span className="tiny">API</span><strong>{operations?.api ?? "unavailable"}</strong></div><div><span className="tiny">Tiger Data</span><strong>{operations?.database ?? "unavailable"}</strong></div><div><span className="tiny">Latest flood observation</span><strong>{operations?.latest_flood_observation ? localTime(operations.latest_flood_observation) : "No observation"}</strong></div></div>
        {operations?.jobs.map((job) => <p key={job.job} className="tiny">{job.job.replaceAll("_", " ")} · {job.status} · heartbeat {localTime(job.heartbeat)} · last success {job.last_success ? localTime(job.last_success) : "never"} · {job.rows_written} rows</p>)}
        <p className="tiny">Configured does not mean verified: {operations && Object.entries(operations.integrations).map(([key, value]) => key + ": " + value).join(" · ")}</p>
      </details>}
      </>}
    </main>
    <footer><a className="wordmark" href="/"><span className="brand-icon">✳</span> Noach</a><p>Local awareness. Everyday resilience.</p><span className="tiny">Built for Houston · CodeRED: Orion 2026</span></footer>
  </div>;
}
