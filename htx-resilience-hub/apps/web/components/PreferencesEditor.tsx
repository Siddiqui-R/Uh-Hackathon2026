"use client";
import { useEffect, useState } from "react";
import type { UserPrefs, Location, PlaceMatch } from "@/lib/types";

const HOUSTON_PRESETS: Array<{ name: string; kind: Location["kind"]; lat: number; lon: number }> = [
  { name: "University of Houston (Main Campus)", kind: "school", lat: 29.7199, lon: -95.3422 },
  { name: "UH Downtown (UHD)", kind: "school", lat: 29.7661, lon: -95.3601 },
  { name: "Rice University", kind: "school", lat: 29.7174, lon: -95.4018 },
  { name: "Texas Medical Center (TMC)", kind: "work", lat: 29.7080, lon: -95.3995 },
  { name: "Downtown Houston / Discovery Green", kind: "work", lat: 29.7533, lon: -95.3585 },
  { name: "Memorial Park & Running Trails", kind: "other", lat: 29.7681, lon: -95.4338 },
  { name: "Hermann Park", kind: "other", lat: 29.7130, lon: -95.3910 },
  { name: "Buffalo Bayou Park", kind: "other", lat: 29.7615, lon: -95.3853 },
  { name: "The Galleria / Uptown", kind: "other", lat: 29.7397, lon: -95.4654 },
  { name: "Energy Corridor", kind: "work", lat: 29.7850, lon: -95.6350 },
  { name: "The Heights / 19th St", kind: "home", lat: 29.8028, lon: -95.4000 },
  { name: "Montrose / Midtown", kind: "home", lat: 29.7420, lon: -95.3900 },
  { name: "Meyerland", kind: "home", lat: 29.6700, lon: -95.4800 },
  { name: "Sugar Land (Town Square)", kind: "home", lat: 29.5984, lon: -95.6219 },
  { name: "The Woodlands (Town Center)", kind: "home", lat: 30.1600, lon: -95.4600 },
  { name: "Houston Ship Channel / Pasadena", kind: "work", lat: 29.7289, lon: -95.2210 },
];

interface Props { value: UserPrefs; onSave: (prefs: UserPrefs) => Promise<string>; section: "places" | "routines" | "settings"; }

export default function PreferencesEditor({ value, onSave, section }: Props) {
  const [draft, setDraft] = useState(value), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const [searchResults, setSearchResults] = useState<Record<string, PlaceMatch[]>>({});
  const [searchError, setSearchError] = useState<Record<string, string>>({});
  const [searchingIndex, setSearchingIndex] = useState<number | null>(null);

  useEffect(() => { setDraft(value); }, [value]);

  function changeLocation(index: number, patch: Partial<Location>) {
    setDraft((old) => ({ ...old, locations: old.locations.map((loc, i) => i === index ? { ...loc, ...patch } : loc) }));
  }

  async function searchAddress(index: number, query: string) {
    const loc = draft.locations[index];
    if (!loc) return;
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setSearchError((prev) => ({ ...prev, [loc.id]: "Type at least 3 characters." }));
      return;
    }
    setSearchingIndex(index);
    setSearchError((prev) => ({ ...prev, [loc.id]: "" }));
    try {
      const res = await fetch("/api/geocode?" + new URLSearchParams({ q: trimmed }));
      if (!res.ok) throw new Error("Search service unavailable. Try a landmark above.");
      const matches = await res.json() as PlaceMatch[];
      if (!matches.length) {
        setSearchError((prev) => ({ ...prev, [loc.id]: "No Houston locations found. Try adding 'Houston' or a ZIP code." }));
      } else if (matches.length === 1) {
        changeLocation(index, { name: matches[0].name, lat: matches[0].lat, lon: matches[0].lon });
        setSearchResults((prev) => ({ ...prev, [loc.id]: [] }));
      } else {
        setSearchResults((prev) => ({ ...prev, [loc.id]: matches }));
      }
    } catch (err: unknown) {
      setSearchError((prev) => ({ ...prev, [loc.id]: err instanceof Error ? err.message : "Search failed" }));
    } finally {
      setSearchingIndex(null);
    }
  }
  return <section className="panel preferences">
    <div className="section-heading"><div><span className="section-label">MAKE IT YOURS</span><h2>{section === "places" ? "Your places" : section === "routines" ? "Your routines" : "Your preferences"}</h2></div></div>
    <form onSubmit={(event) => { event.preventDefault(); setBusy(true); void onSave(draft).then(setMessage).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Save failed")).finally(() => setBusy(false)); }}>
      {section === "places" && <>
      <p className="muted">Save up to five Houston places for local forecasts and nearby alerts. Select a Houston landmark or search any address—coordinates are automatically found for you.</p>
      {!draft.locations.length && <p className="empty-events">No saved places yet. Add one to personalize conditions and routines.</p>}
      {draft.locations.map((location, index) => {
        const matchingPreset = HOUSTON_PRESETS.find((p) => p.name === location.name);
        return (
          <fieldset key={location.id} className="editor-row" style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 14, marginBottom: 16 }}>
            <legend style={{ fontWeight: 600 }}>Place {index + 1}: {location.name}</legend>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", width: "100%", alignItems: "flex-end" }}>
              <label style={{ flex: 2, minWidth: 200 }}>
                Houston Landmark / Preset
                <select
                  value={matchingPreset ? matchingPreset.name : "custom"}
                  onChange={(e) => {
                    const selected = HOUSTON_PRESETS.find((p) => p.name === e.target.value);
                    if (selected) {
                      changeLocation(index, { name: selected.name, kind: selected.kind, lat: selected.lat, lon: selected.lon });
                    }
                  }}
                >
                  <option value="custom">-- Search an address / custom place --</option>
                  {HOUSTON_PRESETS.map((p) => (
                    <option key={p.name} value={p.name}>{p.name}</option>
                  ))}
                </select>
              </label>

              <label style={{ flex: 2, minWidth: 180 }}>
                Display Name / Label
                <input
                  required
                  maxLength={80}
                  value={location.name}
                  onChange={(event) => changeLocation(index, { name: event.target.value })}
                  placeholder="e.g. Campus, Home, Gym"
                />
              </label>

              <label style={{ flex: 1, minWidth: 120 }}>
                Type
                <select value={location.kind} onChange={(event) => changeLocation(index, { kind: event.target.value as Location["kind"] })}>
                  {["home", "school", "work", "other"].map((kind) => (
                    <option key={kind} value={kind}>{kind.charAt(0).toUpperCase() + kind.slice(1)}</option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                className="quiet"
                style={{ paddingBottom: 11 }}
                onClick={() => setDraft((old) => ({ ...old, locations: old.locations.filter((loc) => loc.id !== location.id), routines: old.routines.filter((r) => r.location_id !== location.id) }))}
              >
                Remove
              </button>
            </div>

            {/* Address Search & Autocomplete */}
            <div style={{ marginTop: 10, width: "100%" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="text"
                  placeholder="Or type an address, street, or ZIP in Houston (e.g. 4800 Calhoun Rd or 77004)..."
                  style={{ flex: 1, fontSize: 12 }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void searchAddress(index, (e.target as HTMLInputElement).value);
                    }
                  }}
                  id={`search-input-${location.id}`}
                />
                <button
                  type="button"
                  className="secondary"
                  style={{ padding: "8px 14px", fontSize: 12 }}
                  disabled={searchingIndex === index}
                  onClick={() => {
                    const inputEl = document.getElementById(`search-input-${location.id}`) as HTMLInputElement | null;
                    if (inputEl) void searchAddress(index, inputEl.value);
                  }}
                >
                  {searchingIndex === index ? "Finding…" : "Find Address"}
                </button>
              </div>

              {searchError[location.id] && (
                <p className="tiny" style={{ color: "var(--orange)", marginTop: 6 }}>{searchError[location.id]}</p>
              )}

              {searchResults[location.id] && searchResults[location.id]!.length > 0 && (
                <ul className="place-matches" style={{ listStyle: "none", padding: 0, margin: "8px 0 0", border: "1px solid var(--line)", borderRadius: 6, maxHeight: 160, overflowY: "auto", background: "#fff" }}>
                  {searchResults[location.id]!.map((match, mIdx) => (
                    <li key={mIdx} style={{ borderBottom: "1px solid var(--line)" }}>
                      <button
                        type="button"
                        style={{ width: "100%", textAlign: "left", padding: "8px 12px", background: "none", border: "none", cursor: "pointer" }}
                        onClick={() => {
                          changeLocation(index, { name: match.name, lat: match.lat, lon: match.lon });
                          setSearchResults((prev) => ({ ...prev, [location.id]: [] }));
                        }}
                      >
                        <strong style={{ fontSize: 12 }}>{match.name}</strong>
                        <span className="tiny" style={{ display: "block", color: "var(--muted)" }}>{match.address}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <p className="tiny" style={{ color: "var(--muted)", marginTop: 6 }}>
                ✓ GPS coordinates automatically linked ({location.lat.toFixed(4)}, {location.lon.toFixed(4)}) for weather and flood feeds.
              </p>
            </div>
          </fieldset>
        );
      })}
      <button type="button" className="secondary" disabled={draft.locations.length >= 5} onClick={() => {
        const defaultPlace = HOUSTON_PRESETS[0];
        setDraft((old) => ({ ...old, locations: [...old.locations, { id: crypto.randomUUID(), name: defaultPlace.name, kind: defaultPlace.kind, lat: defaultPlace.lat, lon: defaultPlace.lon }] }));
      }}>+ Add a place</button>
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
