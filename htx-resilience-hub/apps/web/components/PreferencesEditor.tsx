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

const HOUSTON_ZIPS: Record<string, { name: string; kind: Location["kind"]; lat: number; lon: number }> = {
  "77002": { name: "Downtown Houston", kind: "work", lat: 29.7533, lon: -95.3585 },
  "77003": { name: "East End / EaDo", kind: "home", lat: 29.7480, lon: -95.3450 },
  "77004": { name: "University of Houston / Third Ward", kind: "school", lat: 29.7199, lon: -95.3422 },
  "77005": { name: "Rice University / West U", kind: "school", lat: 29.7174, lon: -95.4018 },
  "77006": { name: "Montrose / Midtown", kind: "home", lat: 29.7420, lon: -95.3900 },
  "77007": { name: "Washington Corridor / Memorial Park", kind: "other", lat: 29.7681, lon: -95.4338 },
  "77008": { name: "The Heights", kind: "home", lat: 29.8028, lon: -95.4000 },
  "77019": { name: "River Oaks / Buffalo Bayou", kind: "other", lat: 29.7615, lon: -95.3853 },
  "77024": { name: "Memorial / Memorial City", kind: "home", lat: 29.7800, lon: -95.5400 },
  "77025": { name: "Braeswood Place", kind: "home", lat: 29.6900, lon: -95.4300 },
  "77030": { name: "Texas Medical Center (TMC)", kind: "work", lat: 29.7080, lon: -95.3995 },
  "77056": { name: "The Galleria / Uptown", kind: "work", lat: 29.7397, lon: -95.4654 },
  "77077": { name: "Energy Corridor", kind: "work", lat: 29.7850, lon: -95.6350 },
  "77096": { name: "Meyerland", kind: "home", lat: 29.6700, lon: -95.4800 },
  "77098": { name: "Upper Kirby / Montrose", kind: "home", lat: 29.7350, lon: -95.4100 },
  "77478": { name: "Sugar Land", kind: "home", lat: 29.5984, lon: -95.6219 },
  "77479": { name: "Sugar Land (Town Square)", kind: "home", lat: 29.5984, lon: -95.6219 },
  "77380": { name: "The Woodlands", kind: "home", lat: 30.1600, lon: -95.4600 },
};

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

  function findNearestPreset(lat: number, lon: number) {
    let closest = HOUSTON_PRESETS[0];
    let minDistance = Infinity;
    for (const preset of HOUSTON_PRESETS) {
      const d = Math.hypot((preset.lat - lat) * 69, (preset.lon - lon) * 59);
      if (d < minDistance) {
        minDistance = d;
        closest = preset;
      }
    }
    return { preset: closest, miles: minDistance };
  }

  async function searchAddress(index: number, query: string) {
    const loc = draft.locations[index];
    if (!loc) return;
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setSearchError((prev) => ({ ...prev, [loc.id]: "Type at least 3 characters." }));
      return;
    }

    // 1. Direct Houston ZIP code check
    const zipDigits = trimmed.replace(/\D/g, "");
    if (zipDigits.length === 5 && HOUSTON_ZIPS[zipDigits]) {
      const zipMatch = HOUSTON_ZIPS[zipDigits];
      changeLocation(index, { name: `${zipMatch.name} (${zipDigits})`, lat: zipMatch.lat, lon: zipMatch.lon, kind: zipMatch.kind });
      setSearchError((prev) => ({ ...prev, [loc.id]: "" }));
      setSearchResults((prev) => ({ ...prev, [loc.id]: [] }));
      return;
    }

    setSearchingIndex(index);
    setSearchError((prev) => ({ ...prev, [loc.id]: "" }));
    try {
      const searchTarget = trimmed.toLowerCase().includes("houston") ? trimmed : `${trimmed}, Houston, TX`;
      const res = await fetch("/api/geocode?" + new URLSearchParams({ q: searchTarget }));
      if (!res.ok) throw new Error("Search service unavailable. Falling back to nearest landmark.");
      const matches = await res.json() as PlaceMatch[];
      if (!matches.length) {
        // Smart fallback: match keywords in Houston presets
        const lower = trimmed.toLowerCase();
        const matched = HOUSTON_PRESETS.find((p) =>
          lower.includes(p.name.toLowerCase().split(" ")[0]) ||
          p.name.toLowerCase().includes(lower) ||
          (lower.includes("uh") && p.name.includes("University of Houston")) ||
          (lower.includes("tmc") && p.name.includes("Medical Center")) ||
          (lower.includes("downtown") && p.name.includes("Downtown")) ||
          (lower.includes("galleria") && p.name.includes("Galleria")) ||
          (lower.includes("heights") && p.name.includes("Heights")) ||
          (lower.includes("montrose") && p.name.includes("Montrose"))
        );
        const target = matched ?? HOUSTON_PRESETS.find((p) => p.name.includes("Downtown")) ?? HOUSTON_PRESETS[0];
        changeLocation(index, { name: `${trimmed} (near ${target.name})`, lat: target.lat, lon: target.lon, kind: target.kind });
        setSearchError((prev) => ({
          ...prev,
          [loc.id]: `Mapped to nearest landmark: ${target.name} for high-quality forecasts.`,
        }));
      } else if (matches.length === 1) {
        changeLocation(index, { name: matches[0].name, lat: matches[0].lat, lon: matches[0].lon });
        setSearchResults((prev) => ({ ...prev, [loc.id]: [] }));
      } else {
        setSearchResults((prev) => ({ ...prev, [loc.id]: matches }));
      }
    } catch {
      const target = HOUSTON_PRESETS[0];
      changeLocation(index, { name: trimmed, lat: target.lat, lon: target.lon });
      setSearchError((prev) => ({
        ...prev,
        [loc.id]: `Offline search fallback: linked to ${target.name} for environmental feeds.`,
      }));
    } finally {
      setSearchingIndex(null);
    }
  }
  return <section className={`panel preferences${section === "places" ? " place-book" : ""}`}>
    <div className="section-heading"><div><span className="section-label">{section === "places" ? "PLACE BOOK" : "MAKE IT YOURS"}</span><h2>{section === "places" ? "Your places" : section === "routines" ? "Your routines" : "Your preferences"}</h2></div></div>
    <form onSubmit={(event) => { event.preventDefault(); setBusy(true); void onSave(draft).then(setMessage).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Save failed")).finally(() => setBusy(false)); }}>
      {section === "places" && <>
      <p className="muted">Save up to 5 places. Each activity uses a saved place.</p>
      {!draft.locations.length && <p className="empty-events">Add your first place, then plan an activity there.</p>}
      {draft.locations.map((location, index) => {
        const matchingPreset = HOUSTON_PRESETS.find((p) => p.name === location.name);
        const planned = value.routines.filter((activity) => activity.location_id === location.id).length;
        const nearest = findNearestPreset(location.lat, location.lon);
        return (
          <fieldset key={location.id} className="editor-row">
            <legend><span className="place-index">0{index + 1}</span> {location.name} <span className="place-kind">{location.kind}</span></legend>
            <div className="place-fields">
              <label>
                Houston landmark
                <select
                  value={matchingPreset ? matchingPreset.name : "custom"}
                  onChange={(e) => {
                    const selected = HOUSTON_PRESETS.find((p) => p.name === e.target.value);
                    if (selected) {
                      changeLocation(index, { name: selected.name, kind: selected.kind, lat: selected.lat, lon: selected.lon });
                    }
                  }}
                >
                  <option value="custom">Custom place / address search</option>
                  {HOUSTON_PRESETS.map((p) => (
                    <option key={p.name} value={p.name}>{p.name}</option>
                  ))}
                </select>
              </label>

              <label>
                Place name
                <input
                  required
                  maxLength={80}
                  value={location.name}
                  onChange={(event) => changeLocation(index, { name: event.target.value })}
                  placeholder="e.g. Campus, Home, Gym"
                />
              </label>

              <label>
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
                onClick={() => setDraft((old) => ({ ...old, locations: old.locations.filter((loc) => loc.id !== location.id), routines: old.routines.filter((r) => r.location_id !== location.id) }))}
              >
                Remove
              </button>
            </div>

            {/* Address Search & Autocomplete */}
            <details className="place-search"><summary>Find an address or ZIP code</summary>
              <div className="place-search-row">
                <input
                  type="text"
                  aria-label={`Address or ZIP for ${location.name}`}
                  placeholder="Houston address or ZIP"
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
                  disabled={searchingIndex === index}
                  aria-busy={searchingIndex === index || undefined}
                  onClick={() => {
                    const inputEl = document.getElementById(`search-input-${location.id}`) as HTMLInputElement | null;
                    if (inputEl) void searchAddress(index, inputEl.value);
                  }}
                >
                  {searchingIndex === index ? "Finding…" : "Find Address"}
                </button>
              </div>

              {searchError[location.id] && (
                <p className="tiny place-search-note" role="status">{searchError[location.id]}</p>
              )}

              {searchResults[location.id] && searchResults[location.id]!.length > 0 && (
                <ul className="place-matches" aria-label={`Matches for ${location.name}`}>
                  {searchResults[location.id]!.map((match, mIdx) => (
                    <li key={mIdx}>
                      <button
                        type="button"
                        onClick={() => {
                          changeLocation(index, { name: match.name, lat: match.lat, lon: match.lon });
                          setSearchResults((prev) => ({ ...prev, [location.id]: [] }));
                        }}
                      >
                        <strong>{match.name}</strong>
                        <span className="tiny">{match.address}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <p className="tiny place-search-meta">
                Location: {nearest.miles < 0.2 ? `At ${nearest.preset.name}` : `Near ${nearest.preset.name} (${nearest.miles.toFixed(1)} miles away)`} · Coordinates ({location.lat.toFixed(4)}, {location.lon.toFixed(4)})
              </p>
            </details>
            {value.locations.some((saved) => saved.id === location.id) && <div className="place-plan-links"><span className="plan-count"><b>{planned}</b>{planned === 1 ? "planned activity" : "planned activities"}</span><a href={`/routines?place=${encodeURIComponent(location.id)}`}>Plan here ↗</a></div>}
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
      <button className="primary" disabled={busy} aria-busy={busy || undefined}>{busy ? "Saving…" : section === "places" ? "Save places" : "Save my preferences"}</button><p role="status" className="tiny save-status">{message}</p>{section === "places" && value.locations.length > 0 && <div className="planning-next"><span>Next / choose when to go</span><a href="/routines">Plan an activity →</a></div>}
    </form>
  </section>;
}
