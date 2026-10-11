import "server-only";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { Location, Routine, UserPrefs } from "./types";
import { demoArea, demoBriefingFor, demoPoint } from "./demoData";
import { readDemoPreferences, setDemoPreferences } from "./demoSession";

const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
const validId = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,40}$/.test(value);
const validCoordinate = (value: unknown, limit: number) => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit;

function validPreferences(value: unknown): value is UserPrefs {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prefs = value as UserPrefs;
  if (prefs.user_id !== "demo_browser" || prefs.timezone !== "America/Chicago" ||
      !Array.isArray(prefs.locations) || prefs.locations.length > 5 || !Array.isArray(prefs.routines) || prefs.routines.length > 10 ||
      !prefs.thresholds || typeof prefs.thresholds !== "object") return false;
  const ids = new Set<string>();
  for (const place of prefs.locations as Location[]) {
    if (!validId(place.id) || ids.has(place.id) || typeof place.name !== "string" || !place.name.trim() || place.name.length > 80 ||
        !["home", "school", "work", "other"].includes(place.kind) || !validCoordinate(place.lat, 90) || !validCoordinate(place.lon, 180)) return false;
    ids.add(place.id);
  }
  const activityIds = new Set<string>();
  for (const item of prefs.routines as Routine[]) {
    if (!validId(item.id) || activityIds.has(item.id) || !ids.has(item.location_id) || typeof item.activity !== "string" ||
        !item.activity.trim() || item.activity.length > 100 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.local_time) ||
        !Array.isArray(item.weekdays) || !item.weekdays.length || item.weekdays.length > 7 || item.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
        !["none", "weekly"].includes(item.recurrence ?? "weekly") || (item.recurrence === "none" && (!item.start_date || !/^\d{4}-\d{2}-\d{2}$/.test(item.start_date))) ||
        (item.duration_minutes != null && (!Number.isInteger(item.duration_minutes) || item.duration_minutes < 15 || item.duration_minutes > 480))) return false;
    activityIds.add(item.id);
  }
  return ["feels_like_f", "us_aqi"].every((key) => typeof prefs.thresholds[key] === "number" && prefs.thresholds[key] >= 0 && prefs.thresholds[key] <= 500);
}

function demoEvent(kind: "air" | "flood") {
  const time = new Date().toISOString();
  return kind === "flood" ? { id: 2, station_id: "demo:whiteoak-gage", station_name: "Whiteoak Bayou demo gauge", lat: 29.7752, lon: -95.3972,
    hazard: "flood", metric: "Gage height, feet", value: 8.7, unit: "ft", baseline: 7.0, sample_count: 4, score: 1.7,
    method: "illustrative", severity: "watch", status: "simulated", observed_at: time, detected_at: time,
    source: "Illustrative demo", is_simulated: true } : { id: 1, station_id: "demo:uh-pm25", station_name: "UH area demo monitor", lat: 29.7199, lon: -95.3422,
    hazard: "air", metric: "PM2.5", value: 52, unit: "µg/m³", baseline: 12, sample_count: 8, score: 4.3,
    method: "illustrative", severity: "watch", status: "simulated", observed_at: time, detected_at: time,
    source: "Illustrative demo", is_simulated: true };
}

export async function demoApi(request: Request, path: string): Promise<Response> {
  const prefs = readDemoPreferences();
  if (!prefs) return json({ error: "Start the demo again." }, 401);
  const incoming = new URL(request.url);
  if (request.method === "POST" && path === "prefs") {
    const origin = request.headers.get("origin");
    if (origin && origin !== incoming.origin) return json({ error: "Cross-origin request rejected" }, 403);
    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
    if (!validPreferences(body)) return json({ error: "Check your places, activities and thresholds before saving." }, 400);
    const response = json({ preferences: body, storage: "this browser demo", memory: "off" });
    if (!setDemoPreferences(response, body)) return json({ error: "Demo storage is full. Remove a place or activity and try again." }, 413);
    return response;
  }
  if (request.method === "POST" && path === "alerts/read") {
    const body = await request.json() as { alert_id?: number; read?: boolean };
    if (body.alert_id !== 1 || typeof body.read !== "boolean") return json({ error: "Alert not found" }, 404);
    const response = json({ id: "1", read_at: body.read ? new Date().toISOString() : null });
    response.cookies.set("noach_demo_alert_read", body.read ? "1" : "0", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 7 * 24 * 60 * 60 });
    return response;
  }
  if (request.method === "POST" && path === "alerts/demo") return json({ status: "queued", demo: true });
  if (request.method === "POST" && path === "ask") {
    const body = await request.json() as { question?: unknown };
    if (typeof body.question !== "string" || !body.question.trim() || body.question.length > 4000) return json({ error: "Enter a question." }, 400);
    const first = demoBriefingFor(prefs).recommendations[0];
    const subject = prefs.routines.find((item) => body.question!.toString().toLowerCase().includes(item.activity.toLowerCase())) ?? prefs.routines[0];
    const detail = demoBriefingFor(prefs).recommendations.find((item) => item.id === subject?.id) ?? first;
    return NextResponse.json({ answer: detail ? `In this illustrative demo, ${detail.title.toLowerCase()} at ${detail.location} is marked "${detail.status}." ${detail.reason} Open Outlook to compare the sample values. These are not live conditions.` : "Add an activity and a place to see a sample outlook. This demo does not use live conditions.", provider: "demo" },
      { headers: { "Cache-Control": "no-store", "X-AI-Provider": "demo" } });
  }
  if (request.method === "POST" && path === "demo/simulate-anomaly") {
    const body = await request.json() as { kind?: string };
    if (body.kind !== "air" && body.kind !== "flood") return json({ error: "Choose air or flood." }, 400);
    const response = json({ status: "detected", event: demoEvent(body.kind) });
    response.cookies.set("noach_demo_event", body.kind, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 7 * 24 * 60 * 60 });
    return response;
  }
  if (request.method !== "GET") return json({ error: "Not found" }, 404);
  if (path === "prefs") return json({ preferences: prefs, storage: "this browser demo", planner_schema_version: 2 });
  if (path === "briefing") return json(demoBriefingFor(prefs));
  if (path === "status") return json({ api: "Demo", database: "Browser demo", hosting: "Illustrative preview", latest_flood_observation: new Date().toISOString(), jobs: [], integrations: {} });
  if (path === "anomalies") {
    return json([demoEvent(cookies().get("noach_demo_event")?.value === "flood" ? "flood" : "air")]);
  }
  if (path === "air/stations" || path === "assistant/history") return json([]);
  if (path === "hazards/history") {
    const now = Date.now();
    return json(Array.from({ length: 12 }, (_, index) => ({ time: new Date(now - (11 - index) * 3_600_000).toISOString(), value: 7.2 + index * 0.045 })));
  }
  if (path === "conditions/area") return json(demoArea());
  if (path === "conditions/point") {
    const lat = Number(incoming.searchParams.get("lat")), lon = Number(incoming.searchParams.get("lon"));
    if (!validCoordinate(lat, 90) || !validCoordinate(lon, 180)) return json({ error: "Choose a valid location." }, 422);
    return json(demoPoint(prefs, lat, lon));
  }
  if (path === "geocode") {
    const query = (incoming.searchParams.get("q") ?? "").toLowerCase();
    return json(prefs.locations.filter((place) => place.name.toLowerCase().includes(query) || query.includes(place.name.toLowerCase())).map((place) =>
      ({ name: place.name, address: `${place.name}, Houston, TX`, lat: place.lat, lon: place.lon })));
  }
  return json({ error: "Not found" }, 404);
}
