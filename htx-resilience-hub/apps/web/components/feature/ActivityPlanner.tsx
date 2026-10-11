"use client";
import { useEffect, useRef, useState } from "react";
import type { Routine, UserPrefs } from "@/lib/types";
import FeatureFrame from "./FeatureFrame";
import styles from "./features.module.css";

type PlannedRoutine = Routine & {
  start_date?: string | null;
  duration_minutes?: number;
  recurrence?: "none" | "weekly";
  alerts_enabled?: boolean;
};
const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const durations = [30, 60, 90, 120, 180, 240];

function todayIn(zone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const piece = (name: string) => parts.find((part) => part.type === name)?.value ?? "";
  return `${piece("year")}-${piece("month")}-${piece("day")}`;
}
function timeIn(zone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
}
function newActivity(prefs: UserPrefs, placeId?: string): PlannedRoutine {
  let startDate = todayIn(prefs.timezone);
  if (timeIn(prefs.timezone) >= "17:00") {
    const tomorrow = new Date(`${startDate}T12:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    startDate = tomorrow.toISOString().slice(0, 10);
  }
  const weekday = (new Date(`${startDate}T12:00:00Z`).getUTCDay() + 6) % 7;
  return { id: crypto.randomUUID(), activity: "", location_id: prefs.locations.find((place) => place.id === placeId)?.id ?? prefs.locations[0]?.id ?? "",
    start_date: startDate, local_time: "17:00", duration_minutes: 60,
    recurrence: "none", weekdays: [weekday], alerts_enabled: true };
}
function dateLabel(value: string | null | undefined): string {
  if (!value) return "the next selected day";
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function timeLabel(value: string): string {
  const [hour, minute] = value.split(":").map(Number);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return value;
  return `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, "0")}` : ""} ${hour < 12 ? "AM" : "PM"}`;
}
function summary(routine: PlannedRoutine, prefs: UserPrefs): string {
  const place = prefs.locations.find((item) => item.id === routine.location_id)?.name ?? "a saved place";
  const schedule = routine.recurrence === "none"
    ? `on ${dateLabel(routine.start_date)}`
    : `every ${routine.weekdays.map((day) => days[day]).join(", ") || "selected day"}${routine.start_date ? `, starting ${dateLabel(routine.start_date)}` : ""}`;
  return `${routine.activity.trim() || "Your activity"} at ${place}, ${schedule} at ${timeLabel(routine.local_time)}, for ${routine.duration_minutes ?? 60} minutes.`;
}

export default function ActivityPlanner({ onboarding = false, continuePath = "/", placeId, activityId }: { onboarding?: boolean; continuePath?: string; placeId?: string; activityId?: string }) {
  const [prefs, setPrefs] = useState<UserPrefs | null>(null);
  const [draft, setDraft] = useState<PlannedRoutine | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [schemaReady, setSchemaReady] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/prefs", { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 401 ? "Your session expired. Sign in again." : "Your activities could not be loaded.");
      const data = await response.json() as { preferences: UserPrefs; planner_schema_version?: number };
      setPrefs(data.preferences);
      const ready = (data.planner_schema_version ?? 0) >= 2;
      setSchemaReady(ready);
      const selected = data.preferences.routines.find((activity) => activity.id === activityId);
      if (ready && selected) setDraft({ ...selected });
      else if (ready && placeId && data.preferences.locations.some((place) => place.id === placeId)) setDraft(newActivity(data.preferences, placeId));
      if (onboarding && ready && data.preferences.locations.length && !data.preferences.routines.length) setDraft(newActivity(data.preferences, placeId));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Activities unavailable."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  // When someone opens the editor, move them to it; auto-opened onboarding drafts keep the reading position.
  const editorRef = useRef<HTMLElement>(null), focusEditor = useRef(false);
  function openDraft(next: PlannedRoutine) { focusEditor.current = true; setDraft(next); setMessage(""); }
  useEffect(() => {
    if (!draft || !focusEditor.current || !editorRef.current) return;
    focusEditor.current = false;
    editorRef.current.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    editorRef.current.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  }, [draft?.id]);

  function change(patch: Partial<PlannedRoutine>) {
    setDraft((current) => current ? { ...current, ...patch } : current);
    setError("");
  }
  function cancel() { setDraft(null); setError(""); }

  async function save() {
    if (!prefs || !draft || saving) return;
    if (!schemaReady) { setError("Activity saving is unavailable until the planner API supports dates, duration, repeat, and alerts."); return; }
    if (!draft.activity.trim() || !draft.location_id || !draft.start_date || !draft.local_time ||
        (draft.recurrence === "weekly" && !draft.weekdays.length)) {
      setError("Add an activity name, place, date, and time. Repeating activities need at least one weekday.");
      return;
    }
    if (draft.recurrence === "none" && `${draft.start_date}T${draft.local_time}` <= `${todayIn(prefs.timezone)}T${timeIn(prefs.timezone)}`) {
      setError("Choose a future date and time for a one-time activity.");
      return;
    }
    setSaving(true); setError(""); setMessage("");
    try {
      const currentResponse = await fetch("/api/prefs", { cache: "no-store" });
      if (!currentResponse.ok) throw new Error("Current preferences could not be loaded. Nothing was saved.");
      const currentData = await currentResponse.json() as { preferences: UserPrefs; planner_schema_version?: number };
      if ((currentData.planner_schema_version ?? 0) < 2) throw new Error("The planner API cannot save all activity details yet. Nothing was sent.");
      const current = currentData.preferences;
      if (!current.locations.some((place) => place.id === draft.location_id)) throw new Error("This place is no longer saved. Choose another place.");
      const updated: PlannedRoutine = { ...draft, activity: draft.activity.trim(), duration_minutes: draft.duration_minutes ?? 60,
        recurrence: draft.recurrence ?? "weekly", alerts_enabled: draft.alerts_enabled ?? true };
      const routines = current.routines.some((item) => item.id === updated.id)
        ? current.routines.map((item) => item.id === updated.id ? updated : item)
        : [...current.routines, updated];
      if (routines.length > 10) throw new Error("You can save up to 10 activities.");
      const response = await fetch("/api/prefs", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...current, routines }) });
      const body = await response.json() as { preferences?: UserPrefs; error?: string; detail?: string };
      if (!response.ok || !body.preferences) throw new Error(body.error ?? body.detail ?? "Activity could not be saved.");
      const reload = await fetch("/api/prefs", { cache: "no-store" });
      if (!reload.ok) throw new Error("The activity was submitted, but saved details could not be verified. Reload before relying on it.");
      const persisted = (await reload.json() as { preferences: UserPrefs }).preferences;
      const saved = persisted.routines.find((item) => item.id === updated.id) as PlannedRoutine | undefined;
      if (!saved || saved.activity !== updated.activity || saved.location_id !== updated.location_id ||
          saved.start_date !== updated.start_date || saved.local_time !== updated.local_time ||
          saved.duration_minutes !== updated.duration_minutes || saved.recurrence !== updated.recurrence ||
          saved.alerts_enabled !== updated.alerts_enabled ||
          JSON.stringify([...saved.weekdays].sort()) !== JSON.stringify([...updated.weekdays].sort())) {
        throw new Error("The server did not retain every activity detail. Reload before relying on this plan.");
      }
      setPrefs(persisted); setDraft(null);
      setMessage(`${updated.activity} saved. Check its scheduled time on Outlook.`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Save failed."); }
    finally { setSaving(false); }
  }

  async function remove(routine: PlannedRoutine) {
    if (!prefs || saving || !window.confirm(`Remove ${routine.activity}?`)) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const currentResponse = await fetch("/api/prefs", { cache: "no-store" });
      if (!currentResponse.ok) throw new Error("Current preferences could not be loaded.");
      const currentData = await currentResponse.json() as { preferences: UserPrefs; planner_schema_version?: number };
      if ((currentData.planner_schema_version ?? 0) < 2) throw new Error("The planner API cannot safely update activities right now.");
      const current = currentData.preferences;
      const response = await fetch("/api/prefs", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...current, routines: current.routines.filter((item) => item.id !== routine.id) }) });
      if (!response.ok) throw new Error("Activity could not be removed.");
      const reload = await fetch("/api/prefs", { cache: "no-store" });
      if (!reload.ok) throw new Error("Removal could not be verified. Reload the page.");
      const persisted = (await reload.json() as { preferences: UserPrefs }).preferences;
      if (persisted.routines.some((item) => item.id === routine.id)) throw new Error("Activity is still saved. Please try again.");
      setPrefs(persisted); setDraft(null); setMessage(`${routine.activity} removed.`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Remove failed."); }
    finally { setSaving(false); }
  }

  return <FeatureFrame path="/routines" eyebrow="YOUR OUTDOOR PLANS" title="Activity planner"
    description="Choose a place and a schedule." planningPrefs={prefs}>
    <div className={styles.stack}>
      {loading && <div className={styles.skeletonList} role="status"><p className="loading-line"><span className="spinner" aria-hidden />Loading your activities…</p>{[0, 1, 2].map((key) => <div className={styles.skeletonCard} key={key} aria-hidden><span className="skeleton skeleton-value" /><span className="skeleton skeleton-line short" /></div>)}</div>}
      {error && <div className={styles.error} role="alert">{error} {!prefs && !loading && <button className={styles.quiet} onClick={() => void load()}>Try again</button>}</div>}
      {!loading && prefs && <>
        {onboarding && !prefs.routines.length && <section className={styles.plannerWelcome}>
          <p className="section-label">WELCOME TO NOACH</p><h2>Make your first plan</h2>
          <p>A saved activity helps us compare the forecast for the time and place you choose. You can set this up now or come back later.</p>
          <div className={styles.actions}><a className={styles.inlineLink} href={continuePath}>Skip for now</a></div>
        </section>}
        {!schemaReady && <p className={styles.notice} role="status">Your saved activities are visible, but editing is temporarily unavailable until the planner API supports all activity details.</p>}
        <section className={styles.panel} aria-label="Your planned activities">
          <div className={styles.between}><div><p className="section-label">ACTIVITY BOOK</p><h2>Your plans</h2>
            <p className={styles.muted}>{prefs.timezone} · {prefs.routines.length}/10 activities</p></div>
            {!draft && schemaReady && !!prefs.locations.length && prefs.routines.length < 10 &&
              <button className={styles.button} onClick={() => openDraft(newActivity(prefs, placeId))}>+ Plan an activity</button>}
          </div>
          {!prefs.locations.length && <div className={styles.plannerEmpty}><h3>First, save a place</h3><p>Choose where you want to go so Noach can use the forecast for that area.</p>
            <a className={styles.button} href="/places?from=planner">Add a saved place ↗</a></div>}
          {!!prefs.locations.length && !prefs.routines.length && !draft && <div className={styles.plannerEmpty}><h3>No activities planned yet</h3>
            <p>Start with something you enjoy outdoors. You can change the details any time.</p>
            {schemaReady && <button className={styles.button} onClick={() => openDraft(newActivity(prefs, placeId))}>Plan your first activity</button>}</div>}
          {!!prefs.routines.length && <div className={styles.planList}>{prefs.routines.map((item) => {
            const activity = item as PlannedRoutine;
            return <article className={styles.activityItem} key={item.id}><div><h3>{item.activity}</h3>
              <p className={styles.placeLine}><span className="place-chip">{prefs.locations.find((place) => place.id === item.location_id)?.name ?? "Saved place unavailable"}</span></p><p className={styles.scheduleLine}>{activity.recurrence === "none" ? dateLabel(activity.start_date) : activity.weekdays.map((day) => days[day].slice(0, 3)).join(" · ")} / {timeLabel(activity.local_time)} / {activity.duration_minutes ?? 60} min</p><span className={`${styles.small} ${styles.alertState}${activity.alerts_enabled === false ? "" : ` ${styles.alertOn}`}`}>{activity.alerts_enabled === false ? "Forecast alerts off" : "Forecast alerts on"}</span></div>
              <div className={styles.activityActions}><a className={styles.outlookLink} href={`/recommendations#activity-${item.id}`}>Outlook ↗</a>{schemaReady && <button className={styles.quiet} disabled={saving || !!draft} onClick={() => openDraft({ ...activity })}>Edit</button>}
                {schemaReady && <button className={styles.quiet} disabled={saving || !!draft} onClick={() => void remove(activity)}>Remove</button>}</div></article>;
          })}</div>}
          {message && <div className={styles.notice} role="status">{message} <a className={styles.inlineLink} href="/recommendations">View outlook ↗</a></div>}
        <div className={styles.planningNext}><a className={styles.inlineLink} href="/places?from=planner">+ Add a place</a><a className={styles.inlineLink} href="/recommendations">Check outlook →</a></div>
        </section>

        {draft && schemaReady && <section ref={editorRef} className={`${styles.panel} ${styles.plannerEditor}`} aria-label={prefs.routines.some((item) => item.id === draft.id) ? "Edit activity" : "New activity"}>
          <div className={styles.between}><div><p className="section-label">{prefs.routines.some((item) => item.id === draft.id) ? "EDIT YOUR PLAN" : "A NEW PLAN"}</p>
            <h2>{prefs.routines.some((item) => item.id === draft.id) ? "Edit activity" : "Plan an activity"}</h2>
            </div>
            <button className={styles.quiet} disabled={saving} onClick={cancel}>Cancel</button></div>
          <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <div className={styles.plannerQuestions}>
              <section className={styles.plannerQuestion}><span className={styles.stepNumber}>01</span><div><h3>Activity</h3><label className={styles.field}>Activity name<input required maxLength={100} placeholder="e.g. Basketball, a walk, gardening" value={draft.activity} onChange={(event) => change({ activity: event.target.value })} /></label></div></section>
              <section className={styles.plannerQuestion}><span className={styles.stepNumber}>02</span><div><h3>Place</h3>
                <p><a className={styles.inlineLink} href="/places?from=planner">Add another place ↗</a></p>
                <label className={styles.field}>Saved place<select required value={draft.location_id} onChange={(event) => change({ location_id: event.target.value })}>{prefs.locations.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}</select></label></div></section>
              <section className={styles.plannerQuestion}><span className={styles.stepNumber}>03</span><div><h3>Schedule</h3>
                <p>Local time / {prefs.timezone}</p><div className={styles.plannerTwoColumns}>
                  <label className={styles.field}>Start date<input required type="date" value={draft.start_date ?? ""} onChange={(event) => change({ start_date: event.target.value })} /></label>
                  <label className={styles.field}>Start time<input required type="time" value={draft.local_time} onChange={(event) => change({ local_time: event.target.value })} /></label>
                </div></div></section>
              <section className={styles.plannerQuestion}><span className={styles.stepNumber}>04</span><div><h3>Repeat</h3>
                <div className={styles.choiceRow}><label className={styles.choice}><input type="radio" name="repeat" checked={draft.recurrence === "none"} onChange={() => change({ recurrence: "none" })} />Just this once</label>
                  <label className={styles.choice}><input type="radio" name="repeat" checked={draft.recurrence !== "none"} onChange={() => change({ recurrence: "weekly" })} />Repeat weekly</label></div>
                {draft.recurrence === "weekly" && <fieldset className={styles.weekdays}><legend>Repeat on</legend><div className={styles.days}>{days.map((day, index) => <label key={day} className={styles.choice}>
                  <input type="checkbox" checked={draft.weekdays.includes(index)} onChange={() => change({ weekdays: draft.weekdays.includes(index) ? draft.weekdays.filter((value) => value !== index) : [...draft.weekdays, index].sort() })} />{day.slice(0, 3)}</label>)}</div></fieldset>}</div></section>
              <section className={styles.plannerQuestion}><span className={styles.stepNumber}>05</span><div><h3>Duration</h3><label className={styles.field}>Duration<select value={draft.duration_minutes ?? 60} onChange={(event) => change({ duration_minutes: Number(event.target.value) })}>
                  {durations.map((value) => <option key={value} value={value}>{value} minutes</option>)}</select></label></div></section>
              <section className={styles.plannerQuestion}><span className={styles.stepNumber}>06</span><div><h3>Forecast alerts</h3>
                <details className={styles.inlineDetails}><summary>How alerts work</summary><p>Forecasts across this activity are compared with your saved heat and AQI thresholds in <a className={styles.inlineLink} href="/settings">Settings</a>. Browser notifications need permission and an open app.</p></details>
                <label className={styles.choice}><input type="checkbox" checked={draft.alerts_enabled ?? true} onChange={(event) => change({ alerts_enabled: event.target.checked })} />Alert me about this activity</label>
                </div></section>
            </div>
            <div className={styles.plannerReview}><p className="section-label">YOUR PLAN AT A GLANCE</p><strong>{summary(draft, prefs)}</strong>
              <span>{draft.alerts_enabled === false ? "Forecast alerts off" : "Forecast alerts on"}</span></div>
            <div className={styles.actions}><button className={styles.button} disabled={saving} aria-busy={saving || undefined} type="submit">{saving ? "Saving…" : "Save activity"}</button>
              <button className={styles.quiet} disabled={saving} type="button" onClick={cancel}>Cancel</button></div>
          </form>
        </section>}
      </>}
    </div>
  </FeatureFrame>;
}
