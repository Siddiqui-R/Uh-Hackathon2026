"use client";
import { useEffect, useRef, useState } from "react";
import type { Location, Routine, UserPrefs } from "@/lib/types";
import styles from "./activityOnboarding.module.css";

type Plan = Routine & { start_date: string; duration_minutes: number; recurrence: "none" | "weekly"; alerts_enabled: boolean };
type Match = { name: string; address: string; lat: number; lon: number };
const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const durations = [30, 60, 90, 120, 180, 240];

function localNow(zone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
function freshPlan(prefs: UserPrefs): Plan {
  const now = localNow(prefs.timezone);
  const date = new Date(`${now.slice(0, 10)}T12:00:00Z`);
  if (now.slice(11) >= "17:00") date.setUTCDate(date.getUTCDate() + 1);
  const start_date = date.toISOString().slice(0, 10);
  return { id: crypto.randomUUID(), activity: "", location_id: prefs.locations[0]?.id ?? "", start_date,
    local_time: "17:00", weekdays: [(date.getUTCDay() + 6) % 7], duration_minutes: 60, recurrence: "none", alerts_enabled: true };
}
function planSummary(plan: Plan, prefs: UserPrefs) {
  const place = prefs.locations.find((item) => item.id === plan.location_id)?.name ?? "your place";
  const time = new Date(`2000-01-01T${plan.local_time}:00`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const date = new Date(`${plan.start_date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const when = plan.recurrence === "weekly" ? `${plan.weekdays.length ? `every ${plan.weekdays.map((day) => days[day]).join(", ")}` : "on your selected days"}, starting ${date}` : `on ${date}`;
  return `${plan.activity.trim() || "Your activity"} at ${place}, ${when} at ${time}, for ${plan.duration_minutes} minutes.`;
}
async function readPrefs(): Promise<{ preferences: UserPrefs; planner_schema_version?: number }> {
  const response = await fetch("/api/prefs", { cache: "no-store" });
  if (!response.ok) throw new Error(response.status === 401 ? "Your session could not be verified. Please sign in again." : "Your account details could not be loaded. Try again.");
  return response.json();
}
async function writePrefs(prefs: UserPrefs): Promise<void> {
  const response = await fetch("/api/prefs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(prefs) });
  const body = await response.json() as { error?: string; detail?: string; preferences?: UserPrefs };
  if (!response.ok || !body.preferences) throw new Error(body.error ?? body.detail ?? "Your changes could not be saved.");
}

export default function ActivityOnboardingModal({ onClose, onSaved, onSkip }: { onClose: () => void; onSaved: () => void; onSkip: () => void }) {
  const [prefs, setPrefs] = useState<UserPrefs | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [schemaReady, setSchemaReady] = useState(false);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [placeName, setPlaceName] = useState("");
  const [placeQuery, setPlaceQuery] = useState("");
  const [selected, setSelected] = useState<Match | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [coordinates, setCoordinates] = useState(false);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void readPrefs().then((data) => {
      if (!active) return;
      setPrefs(data.preferences); setPlan(freshPlan(data.preferences)); setSchemaReady((data.planner_schema_version ?? 0) >= 2);
    }).catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : "Account details unavailable."); });
    return () => { active = false; };
  }, []);
  useEffect(() => { dialog.current?.focus(); }, []);
  useEffect(() => { first.current?.focus(); }, [Boolean(plan), placeOpen]);
  useEffect(() => {
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = old; };
  }, []);

  function keyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); if (!busy && !searching) onClose(); return; }
    if (event.key !== "Tab" || !dialog.current) return;
    const items = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]'));
    if (!items.length) return;
    const firstItem = items[0], lastItem = items[items.length - 1];
    if (event.shiftKey && document.activeElement === firstItem) { event.preventDefault(); lastItem.focus(); }
    else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); firstItem.focus(); }
  }
  function change(patch: Partial<Plan>) { setPlan((current) => current ? { ...current, ...patch } : current); setError(""); }
  async function searchPlace() {
    if (placeQuery.trim().length < 3) { setError("Enter at least three characters to search for a location."); return; }
    setSearching(true); setError(""); setMatches([]); setSelected(null);
    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(placeQuery.trim())}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Location search is unavailable. You can enter coordinates instead.");
      const rows = await response.json() as Match[];
      setMatches(rows);
      if (!rows.length) setError("No Houston locations matched. Try another search or enter coordinates.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Location search failed."); }
    finally { setSearching(false); }
  }
  async function savePlace() {
    if (busy) return;
    const lat = coordinates ? Number(latitude) : selected?.lat;
    const lon = coordinates ? Number(longitude) : selected?.lon;
    if (!placeName.trim() || lat === undefined || lon === undefined || !Number.isFinite(lat) || !Number.isFinite(lon) ||
        lat < -90 || lat > 90 || lon < -180 || lon > 180 || (coordinates && (!latitude || !longitude))) {
      setError("Enter a place name and choose a search result or valid coordinates."); return;
    }
    setBusy(true); setError("");
    try {
      const current = (await readPrefs()).preferences;
      if (current.locations.length >= 5) throw new Error("You can save up to five places. Choose an existing place instead.");
      const place: Location = { id: crypto.randomUUID(), name: placeName.trim(), kind: "other", lat, lon };
      await writePrefs({ ...current, locations: [...current.locations, place] });
      const verified = (await readPrefs()).preferences;
      const saved = verified.locations.find((item) => item.id === place.id);
      if (!saved || saved.name !== place.name || saved.lat !== place.lat || saved.lon !== place.lon) throw new Error("The place was submitted but could not be verified. Try reloading before continuing.");
      setPrefs(verified); change({ location_id: place.id }); setPlaceOpen(false); setMatches([]); setSelected(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Place could not be saved."); }
    finally { setBusy(false); }
  }
  async function saveActivity() {
    if (!plan || !prefs || busy) return;
    if (!schemaReady) { setError("Activity saving is unavailable until the planner API supports all details."); return; }
    const clean = { ...plan, activity: plan.activity.trim() };
    if (!clean.activity || !clean.location_id || !clean.start_date || !clean.local_time || (clean.recurrence === "weekly" && !clean.weekdays.length)) {
      setError("Add an activity name, place, date and time. Weekly plans also need a day."); return;
    }
    if (clean.recurrence === "none" && `${clean.start_date}T${clean.local_time}` <= localNow(prefs.timezone)) {
      setError("Choose a future date and time for a one-time activity."); return;
    }
    setBusy(true); setError("");
    try {
      const data = await readPrefs();
      if ((data.planner_schema_version ?? 0) < 2) throw new Error("The planner API cannot save every activity detail yet.");
      const current = data.preferences;
      if (!current.locations.some((item) => item.id === clean.location_id)) throw new Error("The selected place is no longer saved.");
      if (current.routines.length >= 10) throw new Error("You can save up to ten activities.");
      await writePrefs({ ...current, routines: [...current.routines, clean] });
      const verified = (await readPrefs()).preferences;
      const saved = verified.routines.find((item) => item.id === clean.id);
      if (!saved || saved.activity !== clean.activity || saved.location_id !== clean.location_id || saved.start_date !== clean.start_date ||
          saved.local_time !== clean.local_time || saved.duration_minutes !== clean.duration_minutes || saved.recurrence !== clean.recurrence ||
          saved.alerts_enabled !== clean.alerts_enabled || JSON.stringify([...saved.weekdays].sort()) !== JSON.stringify([...clean.weekdays].sort())) {
        throw new Error("The activity was submitted, but every saved detail could not be verified. Reload before relying on it.");
      }
      onSaved();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Activity could not be saved."); }
    finally { setBusy(false); }
  }

  return <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget && !busy && !searching) onClose(); }}>
    <div ref={dialog} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="onboarding-title" aria-describedby="onboarding-description" tabIndex={-1} onKeyDown={keyDown}>
      <header className={styles.header}><div><p className="section-label">WELCOME TO NOACH · YOUR FIRST PLAN</p><h2 id="onboarding-title">Plan something outdoors</h2>
        <p id="onboarding-description">A place and time help us make your recommendations personal. You can set this up later.</p></div>
        <button type="button" className={styles.close} aria-label="Cancel activity setup" disabled={busy || searching} onClick={onClose}>×</button></header>
      <div className={styles.content}>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {!plan || !prefs ? <p role="status">Loading your new account…</p> : placeOpen ? <form onSubmit={(event) => { event.preventDefault(); void savePlace(); }}>
          <div className={styles.subheading}><span className={styles.number}>02</span><div><h3>Add a place</h3><p>Search for a Houston location, then give it a name you’ll recognize.</p></div></div>
          <label className={styles.field}>Place name<input ref={first} required maxLength={80} placeholder="e.g. University of Houston" value={placeName} onChange={(event) => setPlaceName(event.target.value)} /></label>
          <div className={styles.searchRow}><label className={styles.field}>Location<input value={placeQuery} placeholder="Search an address or landmark" onChange={(event) => { setPlaceQuery(event.target.value); setSelected(null); }} /></label>
            <button type="button" className={styles.secondary} disabled={busy || searching} onClick={() => void searchPlace()}>{searching ? "Searching…" : "Search"}</button></div>
          {!!matches.length && <div className={styles.matches} role="group" aria-label="Location search results">{matches.map((match) => <button type="button" key={`${match.lat}:${match.lon}`} className={selected === match ? styles.selected : ""} onClick={() => { setSelected(match); setCoordinates(false); if (!placeName) setPlaceName(match.name); }}><strong>{match.name}</strong><span>{match.address}</span></button>)}</div>}
          {selected && !coordinates && <p className={styles.selectedPlace}>Selected: {selected.address}</p>}
          <details className={styles.coordinates} open={coordinates} onToggle={(event) => setCoordinates(event.currentTarget.open)}><summary>Enter coordinates instead</summary>
            <div className={styles.two}><label className={styles.field}>Latitude<input type="number" step="any" min={-90} max={90} value={latitude} onChange={(event) => setLatitude(event.target.value)} /></label>
              <label className={styles.field}>Longitude<input type="number" step="any" min={-180} max={180} value={longitude} onChange={(event) => setLongitude(event.target.value)} /></label></div></details>
          <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy || searching}>{busy ? "Saving place…" : "Save place"}</button>
            <button type="button" className={styles.textButton} disabled={busy || searching} onClick={() => { setPlaceOpen(false); setError(""); }}>Cancel</button></div>
        </form> : <form onSubmit={(event) => { event.preventDefault(); void saveActivity(); }}>
          <div className={styles.grid}>
            <section className={styles.step}><span className={styles.number}>01</span><div><h3>What would you like to do?</h3><label className={styles.field}>Activity name<input ref={first} required maxLength={100} placeholder="Basketball, a walk, gardening…" value={plan.activity} onChange={(event) => change({ activity: event.target.value })} /></label></div></section>
            <section className={styles.step}><span className={styles.number}>02</span><div><h3>Where will you go?</h3>{prefs.locations.length ? <label className={styles.field}>Saved place<select required value={plan.location_id} onChange={(event) => change({ location_id: event.target.value })}>{prefs.locations.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}</select></label> : <p className={styles.hint}>Add your first place to continue.</p>}
              {prefs.locations.length < 5 && <button type="button" className={styles.addPlace} onClick={() => { setPlaceOpen(true); setError(""); }}>+ Add a place</button>}</div></section>
            <section className={styles.step}><span className={styles.number}>03</span><div><h3>When?</h3><p className={styles.hint}>Local time in {prefs.timezone}</p><div className={styles.two}>
              <label className={styles.field}>Date<input required type="date" value={plan.start_date} onChange={(event) => change({ start_date: event.target.value })} /></label>
              <label className={styles.field}>Time<input required type="time" value={plan.local_time} onChange={(event) => change({ local_time: event.target.value })} /></label></div></div></section>
            <section className={styles.step}><span className={styles.number}>04</span><div><h3>Repeat</h3><div className={styles.choices}><label><input type="radio" name="onboarding-repeat" checked={plan.recurrence === "none"} onChange={() => change({ recurrence: "none" })} />Just once</label>
              <label><input type="radio" name="onboarding-repeat" checked={plan.recurrence === "weekly"} onChange={() => change({ recurrence: "weekly" })} />Every week</label></div>
              {plan.recurrence === "weekly" && <fieldset className={styles.weekdays}><legend>Choose days</legend>{days.map((day, index) => <label key={day}><input type="checkbox" checked={plan.weekdays.includes(index)} onChange={() => change({ weekdays: plan.weekdays.includes(index) ? plan.weekdays.filter((value) => value !== index) : [...plan.weekdays, index].sort() })} />{day}</label>)}</fieldset>}</div></section>
            <section className={styles.step}><span className={styles.number}>05</span><div><h3>How long?</h3><label className={styles.field}>Duration<select value={plan.duration_minutes} onChange={(event) => change({ duration_minutes: Number(event.target.value) })}>{durations.map((value) => <option key={value} value={value}>{value} minutes</option>)}</select></label></div></section>
            <section className={styles.step}><span className={styles.number}>06</span><div><h3>Forecast alerts</h3><p className={styles.hint}>Compare the forecast with your saved heat and AQI thresholds. Browser notifications need permission and an open page.</p>
              <label className={styles.alertChoice}><input type="checkbox" checked={plan.alerts_enabled} onChange={(event) => change({ alerts_enabled: event.target.checked })} />Alert me about this activity</label></div></section>
          </div>
          <div className={styles.review}><p className="section-label">YOUR PLAN</p><strong>{planSummary(plan, prefs)}</strong><span>Forecast alerts {plan.alerts_enabled ? "on" : "off"}</span></div>
          <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy || !schemaReady || !plan.location_id}>{busy ? "Saving activity…" : "Save activity"}</button>
            <button type="button" className={styles.textButton} disabled={busy} onClick={onSkip}>Skip for now</button>
            <button type="button" className={styles.textButton} disabled={busy} onClick={onClose}>Cancel</button></div>
          {!schemaReady && <p className={styles.error} role="status">The planner API cannot save all activity details yet. You can skip and return later.</p>}
        </form>}
      </div>
    </div>
  </div>;
}
