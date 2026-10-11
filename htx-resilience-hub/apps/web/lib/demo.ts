import type { Briefing, UserPrefs } from "./types";
export const initialPreferences: UserPrefs = {
  user_id: "", timezone: "America/Chicago", memory_enabled: false, notifications_enabled: false, voice_enabled: false,
  locations: [{ id: "uh", name: "University of Houston", kind: "school", lat: 29.7199, lon: -95.3422 }],
  routines: [{ id: "basketball", activity: "Play basketball", location_id: "uh", local_time: "17:00", weekdays: [0,1,2,3,4,5,6] }],
  thresholds: { feels_like_f: 95, us_aqi: 100 },
};
export function demoBriefing(): Briefing {
  const now = new Date(), stamp = now.toISOString();
  const firstHour = Math.floor(now.getTime() / 3600000) * 3600000;
  const hours = Array.from({ length: 48 }, (_, index) => ({
    time: new Date(firstHour + index * 3600000).toISOString(),
    temperature_2m: 84 + Math.round(5 * Math.sin(index / 3)), apparent_temperature: 92 + Math.round(6 * Math.sin(index / 3)),
    us_aqi: 54, relative_humidity_2m: 65, precipitation_probability: 20,
  }));
  const localHour = (value: string) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" }).format(new Date(value)));
  const plannedIndex = hours.findIndex((hour) => new Date(hour.time) > now && localHour(hour.time) === 17);
  const suggestedIndex = plannedIndex + 2;
  const planned = hours[plannedIndex], suggested = hours[suggestedIndex];
  planned.temperature_2m = 89; planned.apparent_temperature = 98; planned.us_aqi = 112;
  suggested.temperature_2m = 79; suggested.apparent_temperature = 85; suggested.us_aqi = 56;
  return {
    generated_at: stamp, timezone: "America/Chicago", locations: initialPreferences.locations,
    forecasts: [{ location: initialPreferences.locations[0], retrieved_at: stamp, hours, source_status: { weather: "demo", air: "demo" },
      attribution: "Illustrative demo values; no live forecast connection.", source_url: "https://open-meteo.com/", storage: "demo" }],
    hazards: [{ hazard: "flood", station_id: "08074500", station_name: "Whiteoak Bayou (demo)", lat: 29.7752, lon: -95.3972,
      metric: "Gage height, feet", value: 7.71, unit: "ft", severity: "unrated", time: stamp }],
    grid: { status: "demo", severity: "normal", title: "Normal Conditions (demo)", note: "Illustrative grid status; no live ERCOT connection.",
      eea_level: 0, reserves_mw: null, updated: stamp, scope: "ERCOT statewide grid", source_url: "https://www.ercot.com/gridmktinfo/dashboards" },
    recommendations: [{ id: "demo-outdoor", title: "Your next outdoor plan", category: "outdoor", location: "University of Houston",
      time: planned.time, status: "consider alternatives", reason: "Illustrative feels-like temperature and modeled AQI exceed the example thresholds. The later hour shows lower forecast values; connect the backend for recommendations based on your saved routine.",
      alternative_time: suggested.time, original_conditions: { forecast_hour: planned.time, temperature_f: planned.temperature_2m, feels_like_f: planned.apparent_temperature, us_aqi: planned.us_aqi, pm25_ug_m3: null, precipitation_probability: planned.precipitation_probability },
      alternative_conditions: { forecast_hour: suggested.time, temperature_f: suggested.temperature_2m, feels_like_f: suggested.apparent_temperature, us_aqi: suggested.us_aqi, pm25_ug_m3: null, precipitation_probability: suggested.precipitation_probability },
      forecast_retrieved_at: stamp, forecast_attribution: "Illustrative values; no live forecast connection.",
      demo: true, suggestions: [{ title: "Review local conditions", description: "Check official weather and air-quality guidance before outdoor exercise.", source_url: "https://www.weather.gov/safety/heat" }] }],
    source_status: { flood: "demo", weather: "demo", air: "demo", grid: "demo", preferences: "local preview" },
    coverage: "Demo preview. Road closures and route safety are not assessed.",
  };
}
