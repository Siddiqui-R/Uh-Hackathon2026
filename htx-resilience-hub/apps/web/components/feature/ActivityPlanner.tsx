"use client";
import { useEffect, useState } from "react";
import type { Routine, UserPrefs } from "@/lib/types";
import PreferencesEditor from "@/components/PreferencesEditor";
import FeatureFrame from "./FeatureFrame";
import styles from "./features.module.css";

type PlannedRoutine = Routine & { start_date?: string | null; duration_minutes?: number; recurrence?: "none" | "weekly"; alerts_enabled?: boolean };
const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function todayIn(zone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const piece = (name: string) => parts.find((p) => p.type === name)?.value ?? "";
  return `${piece("year")}-${piece("month")}-${piece("day")}`;
}
function displayDate(date: string | null | undefined): string { return date || "Start on the next selected weekday"; }
export default function ActivityPlanner() {
  const [prefs, setPrefs] = useState<UserPrefs | null>(null), [draft, setDraft] = useState<PlannedRoutine[]>([]);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [schemaReady, setSchemaReady] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  async function load() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/prefs", { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 401 ? "Your session expired. Sign in again or continue the demo." : "Your activities could not be loaded.");
      const data = await response.json() as { preferences: UserPrefs; planner_schema_version?: number };
      setPrefs(data.preferences); setDraft(data.preferences.routines as PlannedRoutine[]);
      setSchemaReady((data.planner_schema_version ?? 0) >= 2);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Activities unavailable."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  function change(id: string, patch: Partial<PlannedRoutine>) { setDraft((old) => old.map((item) => item.id === id ? { ...item, ...patch } : item)); setMessage(""); }
  function add() {
    if (!prefs?.locations.length) return;
    setDraft((old) => [...old, { id: crypto.randomUUID(), activity: "Outdoor activity", location_id: prefs.locations[0].id,
      start_date: todayIn(prefs.timezone), local_time: "17:00", duration_minutes: 60, recurrence: "none", weekdays: [0,1,2,3,4,5,6], alerts_enabled: true }]);
    setMessage("");
  }
  async function save() {
    if (!prefs) return;
    if (!schemaReady) { setError("Durable activity storage is awaiting the planner API update. Your edits have not been sent to the server."); return; }
    setSaving(true); setError(""); setMessage("");
    try {
      if (draft.some((r) => !r.activity.trim() || !r.location_id || !r.start_date || (r.recurrence === "weekly" && !r.weekdays.length)))
        throw new Error("Every activity needs a name, saved place, date, time, and at least one weekday when repeating.");
      const currentResponse = await fetch("/api/prefs", { cache: "no-store" });
      if (!currentResponse.ok) throw new Error("Current preferences could not be loaded. Nothing was saved.");
      const current = (await currentResponse.json() as { preferences: UserPrefs }).preferences;
      const response = await fetch("/api/prefs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...current, routines: draft }) });
      const body = await response.json() as { preferences?: UserPrefs; error?: string; detail?: string };
      if (!response.ok || !body.preferences) throw new Error(body.error ?? body.detail ?? "Activities could not be saved.");
      const saved = body.preferences.routines as PlannedRoutine[];
      const durable = draft.every((r) => {
        const got = saved.find((item) => item.id === r.id);
        return got && got.start_date === r.start_date && got.duration_minutes === r.duration_minutes && got.recurrence === r.recurrence && got.alerts_enabled === r.alerts_enabled;
      });
      setPrefs(body.preferences);
      if (!durable) throw new Error("The server saved the basic schedule but does not yet support date, duration, repeat, and alert fields. Ask the API owner to add those routine fields before relying on this plan.");
      setDraft(saved); setMessage("Activities saved. Recommendations will use your latest forecast and settings.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Save failed."); }
    finally { setSaving(false); }
  }
  async function saveLegacy(value: UserPrefs): Promise<string> {
    const currentResponse = await fetch("/api/prefs", { cache: "no-store" });
    if (!currentResponse.ok) throw new Error("Current preferences are unavailable.");
    const current = (await currentResponse.json() as { preferences: UserPrefs }).preferences;
    const response = await fetch("/api/prefs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...current, routines: value.routines }) });
    if (!response.ok) throw new Error("Basic routines could not be saved.");
    const saved = (await response.json() as { preferences: UserPrefs }).preferences;
    setPrefs(saved); setDraft(saved.routines as PlannedRoutine[]);
    return "Basic weekly routines saved. Dated activity fields await the planner API update.";
  }
  return <FeatureFrame path="/routines" eyebrow="YOUR OUTDOOR PLANS" title="Activity planner" description="Plan a specific outing or a repeating routine at one of your saved places. Recommendations use your saved heat and air-quality thresholds.">
    <div className={styles.stack}>
      {loading && <div className={styles.loading} role="status">Loading activities…</div>}
      {error && <div className={styles.error} role="alert">{error} {loading || saving ? null : <button className={styles.quiet} onClick={() => void load()}>Reload saved activities</button>}</div>}
      {!loading && prefs && <>
        {!schemaReady && <p className={styles.notice} role="status">The dated planner form is ready, but the API still stores only basic weekly routines. Use the existing routine editor below until the planner API update is merged.</p>}
        <section className={styles.panel}><div className={styles.between}><div><h2>Your activities</h2><p className={styles.muted}>Times use {prefs.timezone}. Up to 10 activities can be saved.</p></div><button className={styles.button} disabled={!schemaReady || !prefs.locations.length || draft.length >= 10} onClick={add}>+ New activity</button></div>
          {!prefs.locations.length && <p className={styles.notice}>Save a location on the <a className={styles.inlineLink} href="/places">Places page</a> before planning an outing.</p>}
          {!draft.length && <p className={styles.empty}>{schemaReady ? "No activities yet. Add your first outing to compare its planned time with forecast alternatives." : "No weekly routines saved yet. Use the editor below to add one."}</p>}
          <div className={styles.stack}>{draft.map((routine) => <fieldset className={styles.card} key={routine.id} disabled={!schemaReady}><legend><strong>{routine.activity || "New activity"}</strong></legend>
            <div className={styles.fields}><label>Activity name or type<input required maxLength={100} value={routine.activity} onChange={(event) => change(routine.id, { activity: event.target.value })} /></label>
              <label>Saved place<select value={routine.location_id} onChange={(event) => change(routine.id, { location_id: event.target.value })}>{prefs.locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}</select></label>
              <label>Start date<input required type="date" value={routine.start_date ?? ""} onChange={(event) => change(routine.id, { start_date: event.target.value })} /></label>
              <label>Local start time<input required type="time" value={routine.local_time} onChange={(event) => change(routine.id, { local_time: event.target.value })} /></label>
              <label>Estimated duration<select value={routine.duration_minutes ?? 60} onChange={(event) => change(routine.id, { duration_minutes: Number(event.target.value) })}>{[30,60,90,120,180,240].map((n) => <option value={n} key={n}>{n} minutes</option>)}</select></label>
              <label>Repeat<select value={routine.recurrence ?? "weekly"} onChange={(event) => change(routine.id, { recurrence: event.target.value as "none" | "weekly" })}><option value="none">One time</option><option value="weekly">Weekly</option></select></label>
              {routine.recurrence !== "none" && <div className={styles.wide}><span className={styles.small}>Repeat on</span><div className={styles.days}>{dayNames.map((day, index) => <label key={day+index}><input type="checkbox" checked={routine.weekdays.includes(index)} onChange={() => change(routine.id, { weekdays: routine.weekdays.includes(index) ? routine.weekdays.filter((d) => d !== index) : [...routine.weekdays, index].sort() })} />{day}</label>)}</div></div>}
              <label className={styles.wide}><span>Alerts for this activity</span><span className={styles.row}><input type="checkbox" checked={routine.alerts_enabled ?? true} onChange={(event) => change(routine.id, { alerts_enabled: event.target.checked })} /> Evaluate against your saved heat and AQI thresholds</span></label>
            </div><p className={styles.source}>First date: {displayDate(routine.start_date)} · browser notifications also require permission in Settings and an open app.</p>
            <button className={styles.quiet} onClick={() => { setDraft((old) => old.filter((r) => r.id !== routine.id)); setMessage(""); }}>Remove activity</button>
          </fieldset>)}</div>
          <div className={styles.actions}>{schemaReady && <button className={styles.button} disabled={saving || draft.length > 10} onClick={() => void save()}>{saving ? "Saving…" : "Save activities"}</button>}<a className={styles.inlineLink} href="/recommendations">View recommendations</a><a className={styles.inlineLink} href="/settings">Alert thresholds and notifications</a></div>
          {message && <p className={styles.notice} role="status">{message}</p>}
        </section>
        {!schemaReady && <PreferencesEditor value={prefs} onSave={saveLegacy} section="routines" />}
      </>}
    </div>
  </FeatureFrame>;
}
