"use client";
import { useEffect, useState } from "react";
import type { UserPrefs, Location } from "@/lib/types";
interface Props { value: UserPrefs; onSave: (prefs: UserPrefs) => Promise<string>; section: "places" | "routines" | "settings"; }
export default function PreferencesEditor({ value, onSave, section }: Props) {
  const [draft, setDraft] = useState(value), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { setDraft(value); }, [value]);
  function changeLocation(index: number, patch: Partial<Location>) {
    setDraft((old) => ({ ...old, locations: old.locations.map((loc, i) => i === index ? { ...loc, ...patch } : loc) }));
  }
  return <section className="panel preferences">
    <div className="section-heading"><div><span className="section-label">MAKE IT YOURS</span><h2>{section === "places" ? "Your places" : section === "routines" ? "Your routines" : "Your preferences"}</h2></div></div>
    <form onSubmit={(event) => { event.preventDefault(); setBusy(true); void onSave(draft).then(setMessage).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Save failed")).finally(() => setBusy(false)); }}>
      {section === "places" && <>
      <p className="muted">Save up to five Houston places for local forecasts and nearby alerts. Coordinates are sent to weather providers.</p>
      {!draft.locations.length && <p className="empty-events">No saved places yet. Add one to personalize conditions and routines.</p>}
      {draft.locations.map((location, index) => <fieldset key={location.id} className="editor-row">
        <legend>Location {index + 1}</legend>
        <label>Name<input required maxLength={80} value={location.name} onChange={(event) => changeLocation(index, { name: event.target.value })} /></label>
        <label>Type<select value={location.kind} onChange={(event) => changeLocation(index, { kind: event.target.value as Location["kind"] })}>{["home","school","work","other"].map((kind) => <option key={kind}>{kind}</option>)}</select></label>
        <label>Latitude<input required type="number" step="any" min={-90} max={90} value={location.lat} onChange={(event) => changeLocation(index, { lat: Number(event.target.value) })} /></label>
        <label>Longitude<input required type="number" step="any" min={-180} max={180} value={location.lon} onChange={(event) => changeLocation(index, { lon: Number(event.target.value) })} /></label>
        <button type="button" className="quiet" onClick={() => setDraft((old) => ({ ...old, locations: old.locations.filter((loc) => loc.id !== location.id), routines: old.routines.filter((r) => r.location_id !== location.id) }))}>Remove</button>
      </fieldset>)}
      <button type="button" className="secondary" disabled={draft.locations.length >= 5} onClick={() => setDraft((old) => ({ ...old, locations: [...old.locations, { id: crypto.randomUUID(), name: "New location", kind: "other", lat: 29.7199, lon: -95.3422 }] }))}>+ Add a place</button>
      </>}
      {section === "routines" && <>
      <p className="muted">Routines use your saved places and local schedule to find useful forecast windows.</p>
      {!draft.locations.length && <p className="notice">Add a place first, then return here to create a routine.</p>}
      {!draft.routines.length && <p className="empty-events">No routines saved yet.</p>}
      {draft.routines.map((routine, index) => <fieldset key={routine.id} className="routine-row">
        <legend>Routine {index + 1}</legend>
        <div className="editor-row">
          <label>Activity<input required maxLength={100} value={routine.activity} onChange={(event) => setDraft((old) => ({ ...old, routines: old.routines.map((r, i) => i === index ? { ...r, activity: event.target.value } : r) }))} /></label>
          <label>At<select value={routine.location_id} onChange={(event) => setDraft((old) => ({ ...old, routines: old.routines.map((r, i) => i === index ? { ...r, location_id: event.target.value } : r) }))}>{draft.locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}</select></label>
          <label>Local time<input required type="time" value={routine.local_time} onChange={(event) => setDraft((old) => ({ ...old, routines: old.routines.map((r, i) => i === index ? { ...r, local_time: event.target.value } : r) }))} /></label>
          <button type="button" className="quiet" onClick={() => setDraft((old) => ({ ...old, routines: old.routines.filter((r) => r.id !== routine.id) }))}>Remove</button>
        </div>
        <div className="weekday-row">{["M","T","W","T","F","S","S"].map((name, day) => <label key={day} title={["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"][day]}>
          <input type="checkbox" checked={routine.weekdays.includes(day)} onChange={() => setDraft((old) => ({ ...old, routines: old.routines.map((r, i) => i === index ? { ...r, weekdays: r.weekdays.includes(day) ? r.weekdays.filter((d) => d !== day) : [...r.weekdays, day] } : r) }))} />{name}
        </label>)}</div>
      </fieldset>)}
      <button type="button" className="secondary" disabled={!draft.locations.length || draft.routines.length >= 10} onClick={() => setDraft((old) => ({ ...old, routines: [...old.routines, { id: crypto.randomUUID(), activity: "Outdoor exercise", location_id: old.locations[0].id, local_time: "17:00", weekdays: [0,1,2,3,4,5,6] }] }))}>+ Add a routine</button>
      </>}
      {section === "settings" && <>
      <p className="muted">Choose how your plan is evaluated and which updates reach this browser.</p>
      <div className="editor-row">
        <label>Timezone<input required value={draft.timezone} onChange={(event) => setDraft((old) => ({ ...old, timezone: event.target.value }))} /></label>
        <label>Feels-like alert (°F)<input type="number" min={0} max={500} value={draft.thresholds.feels_like_f ?? 95} onChange={(event) => setDraft((old) => ({ ...old, thresholds: { ...old.thresholds, feels_like_f: Number(event.target.value) } }))} /></label>
        <label>US AQI alert above<input type="number" min={0} max={500} value={draft.thresholds.us_aqi ?? 100} onChange={(event) => setDraft((old) => ({ ...old, thresholds: { ...old.thresholds, us_aqi: Number(event.target.value) } }))} /></label>
      </div>
      <label className="consent"><input type="checkbox" checked={draft.notifications_enabled ?? false} onChange={(event) => setDraft((old) => ({ ...old, notifications_enabled: event.target.checked }))} />Show browser notifications while the app is open</label>
      <label className="consent"><input type="checkbox" checked={draft.voice_enabled ?? false} onChange={(event) => setDraft((old) => ({ ...old, voice_enabled: event.target.checked }))} />Play voice briefings for new alerts</label>
      <label className="consent"><input type="checkbox" checked={draft.memory_enabled} onChange={(event) => setDraft((old) => ({ ...old, memory_enabled: event.target.checked }))} />Remember these saved preferences with Backboard and use them in Gemini answers.</label>
      <p className="tiny">Gemini receives saved preferences and environmental context when you ask. Turning off memory stops future Backboard use; it does not delete already stored provider memory.</p>
      </>}
      <button className="primary" disabled={busy}>{busy ? "Saving…" : "Save my preferences"}</button><p role="status" className="tiny">{message}</p>
    </form>
  </section>;
}
