import type { ActivityConditions, AreaConditions, Briefing, ForecastHour, Location, PointConditions, Recommendation, Routine, UserPrefs } from "./types";
import { demoBriefing } from "./demo";

const zone = "America/Chicago";
const places: Location[] = [
  { id: "uh", name: "University of Houston", kind: "school", lat: 29.7199, lon: -95.3422 },
  { id: "hermann", name: "Hermann Park", kind: "other", lat: 29.7130, lon: -95.3910 },
  { id: "bayou", name: "Buffalo Bayou Park", kind: "other", lat: 29.7615, lon: -95.3853 },
];
const routines: Routine[] = [
  { id: "demo-basketball", activity: "Play basketball", location_id: "uh", local_time: "17:00", weekdays: [0,1,2,3,4,5,6], duration_minutes: 60, recurrence: "weekly", alerts_enabled: true },
  { id: "demo-walk", activity: "Walk in Hermann Park", location_id: "hermann", local_time: "09:00", weekdays: [0,1,2,3,4,5,6], duration_minutes: 45, recurrence: "weekly", alerts_enabled: true },
  { id: "demo-run", activity: "Run along Buffalo Bayou", location_id: "bayou", local_time: "18:00", weekdays: [0,1,2,3,4,5,6], duration_minutes: 30, recurrence: "weekly", alerts_enabled: true },
];

export function demoPreferences(): UserPrefs {
  return { user_id: "demo_browser", timezone: zone, locations: places, routines,
    thresholds: { feels_like_f: 95, us_aqi: 100 }, memory_enabled: false, notifications_enabled: false, voice_enabled: false };
}

function localDateTime(date: string, time: string): Date {
  const desired = Date.parse(`${date}T${time}:00Z`);
  let guess = desired;
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    const displayed = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    guess += desired - displayed;
  }
  return new Date(guess);
}

function nextTime(routine: Routine, now: Date): string {
  if (routine.recurrence === "none" && routine.start_date) {
    return localDateTime(routine.start_date, routine.local_time).toISOString();
  }
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const today = new Date(Date.UTC(get("year"), get("month") - 1, get("day"), 12));
  const [hour, minute] = routine.local_time.split(":").map(Number);
  for (let offset = 0; offset < 370; offset++) {
    const day = new Date(today.getTime() + offset * 86_400_000);
    const weekday = (day.getUTCDay() + 6) % 7;
    if (!routine.weekdays.includes(weekday)) continue;
    if (routine.start_date && day.toISOString().slice(0, 10) < routine.start_date) continue;
    if (offset === 0 && (hour * 60 + minute) <= get("hour") * 60 + get("minute")) continue;
    const date = day.toISOString().slice(0, 10);
    return localDateTime(date, routine.local_time).toISOString();
  }
  return new Date(now.getTime() + 86_400_000).toISOString();
}

function conditions(time: string, hour: number, profile: string): ActivityConditions {
  const hot = profile === "demo-basketball" || (profile !== "demo-walk" && profile !== "demo-run" && hour >= 14 && hour <= 18);
  const warm = profile === "demo-run";
  const temperature = hot ? 89 : warm ? 86 : hour < 11 ? 76 : 80;
  return { forecast_hour: time, temperature_f: temperature, feels_like_f: hot ? 98 : warm ? 96 : temperature + 4,
    us_aqi: profile === "demo-basketball" ? 112 : hot ? 76 : 48, pm25_ug_m3: null, precipitation_probability: hot ? 20 : 10 };
}

function recommendation(routine: Routine, place: Location, prefs: UserPrefs, now: Date): Recommendation {
  const time = nextTime(routine, now);
  const hour = Number(routine.local_time.slice(0, 2));
  const original = conditions(time, hour, routine.id);
  const heatLimit = prefs.thresholds.feels_like_f ?? 95, airLimit = prefs.thresholds.us_aqi ?? 100;
  const heat = (original.feels_like_f ?? 0) > heatLimit, air = (original.us_aqi ?? 0) > airLimit;
  const alternativeTime = (heat || air) && 85 <= heatLimit && 56 <= airLimit ? new Date(Date.parse(time) + 2 * 3_600_000).toISOString() : null;
  const alternative = alternativeTime ? { ...conditions(alternativeTime, hour + 2, "demo-walk"), temperature_f: 79, feels_like_f: 85, us_aqi: 56, precipitation_probability: 15 } : null;
  return { id: routine.id, title: routine.activity, category: "outdoor", location: place.name, time, duration_minutes: routine.duration_minutes ?? 60,
    status: heat || air ? "consider alternatives" : "good to go", alternative_time: alternativeTime,
    reason: heat || air ? `This illustrative forecast exceeds your ${heat ? "feels-like" : "AQI"} limit. The later example has lower heat and air-quality values.` : "This illustrative start hour is within your saved heat and AQI limits. Check live conditions before going.",
    original_conditions: original, alternative_conditions: alternative, forecast_retrieved_at: now.toISOString(), forecast_status: "current",
    forecast_attribution: "Illustrative demo values, not live forecasts or observations.", demo: true,
    threshold_checks: [
      { metric: "feels_like_f", label: "Feels like", value: original.feels_like_f ?? 0, unit: "°F", threshold: heatLimit, comparison: ">", exceeded: heat },
      { metric: "us_aqi", label: "Modeled US AQI", value: original.us_aqi ?? 0, unit: "US AQI", threshold: airLimit, comparison: ">", exceeded: air },
    ], suggestions: [{ title: "Review heat safety guidance", description: "Official outdoor heat guidance", source_url: "https://www.weather.gov/safety/heat" }] };
}

// The hourly values follow each card, so the day view and the card describe the same illustrative hours.
function alignedHours(hours: ForecastHour[], cards: Recommendation[]): ForecastHour[] {
  const aligned = hours.map((hour) => ({ ...hour }));
  const apply = (from: number, to: number, values: ActivityConditions) => {
    for (const hour of aligned) {
      const at = Date.parse(hour.time);
      if (at + 3_600_000 > from && at < to) Object.assign(hour, { temperature_2m: values.temperature_f ?? undefined, apparent_temperature: values.feels_like_f ?? undefined,
        us_aqi: values.us_aqi ?? undefined, precipitation_probability: values.precipitation_probability ?? undefined });
    }
  };
  for (const card of cards) {
    const start = Date.parse(card.time), length = (card.duration_minutes ?? 60) * 60_000;
    const later = card.alternative_time ? Date.parse(card.alternative_time) : null;
    if (card.original_conditions) apply(start, later ?? start + length, card.original_conditions);
    if (card.alternative_conditions && later !== null) apply(later, later + length, card.alternative_conditions);
  }
  return aligned;
}

export function demoBriefingFor(prefs: UserPrefs): Briefing {
  const base = demoBriefing();
  const now = new Date();
  const recommendations = prefs.routines.flatMap((routine) => {
    const place = prefs.locations.find((location) => location.id === routine.location_id);
    return place && (routine.recurrence !== "none" || Date.parse(nextTime(routine, now)) > now.getTime()) ? [recommendation(routine, place, prefs, now)] : [];
  });
  return { ...base, generated_at: now.toISOString(), locations: prefs.locations,
    forecasts: prefs.locations.map((location) => ({ ...base.forecasts[0], location,
      hours: alignedHours(base.forecasts[0].hours, recommendations.filter((card) => card.location === location.name)) })),
    recommendations, coverage: "Illustrative demo only. Weather, air quality, gauge readings and plan outlooks are simulated." };
}

export function demoArea(): AreaConditions {
  const now = new Date().toISOString();
  const cells = Array.from({ length: 25 }, (_, index) => ({ lat: 29.55 + Math.floor(index / 5) * 0.12, lon: -95.68 + index % 5 * 0.15,
    us_aqi: 48 + index % 5 * 8, apparent_temperature: 83 + Math.floor(index / 5) * 3, precipitation_probability: 10 + index % 3 * 10,
    valid_at: { air: now, weather: now } }));
  return { generated_at: now, bounds: { south: 29.5, north: 30.1, west: -95.75, east: -94.9 }, cell: { dlat: 0.12, dlon: 0.15 }, cells,
    source_status: { weather: "demo", air: "demo" }, attribution: "Illustrative demo map values; not live conditions." };
}

export function demoPoint(prefs: UserPrefs, lat: number, lon: number): PointConditions {
  const briefing = demoBriefingFor(prefs);
  const location = prefs.locations.find((place) => place.lat === lat && place.lon === lon) ?? { id: "demo-pin", name: "Selected Houston spot", kind: "other" as const, lat, lon };
  return { generated_at: briefing.generated_at, timezone: zone, location,
    current: { time: briefing.generated_at, temperature_2m: 80, apparent_temperature: 86, us_aqi: 54, precipitation_probability: 20 },
    forecast_retrieved_at: briefing.generated_at, forecast_attribution: "Illustrative demo values; not live conditions.",
    nearby_gauges: briefing.hazards.map((item) => ({ ...item, distance_km: 5 })), grid: briefing.grid!,
    recommendations: briefing.recommendations.filter((item) => item.location === location.name), source_status: briefing.source_status, coverage: briefing.coverage };
}
