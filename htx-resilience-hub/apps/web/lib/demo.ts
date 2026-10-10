import type { Briefing, UserPrefs } from "./types";
export const initialPreferences: UserPrefs = {
  user_id: "", timezone: "America/Chicago", memory_enabled: false,
  locations: [{ id: "uh", name: "University of Houston", kind: "school", lat: 29.7199, lon: -95.3422 }],
  routines: [{ id: "basketball", activity: "Play basketball", location_id: "uh", local_time: "17:00", weekdays: [0,1,2,3,4,5,6] }],
  thresholds: { feels_like_f: 95, us_aqi: 100 },
};
export function demoBriefing(): Briefing {
  const now = new Date(), stamp = now.toISOString();
  const hours = Array.from({ length: 24 }, (_, index) => ({
    time: new Date(now.getTime() + index * 3600000).toISOString(),
    temperature_2m: 84 + Math.round(5 * Math.sin(index / 3)), apparent_temperature: 92 + Math.round(6 * Math.sin(index / 3)),
    us_aqi: 54, relative_humidity_2m: 65, precipitation_probability: 20,
  }));
  return {
    generated_at: stamp, timezone: "America/Chicago", locations: initialPreferences.locations,
    forecasts: [{ location: initialPreferences.locations[0], retrieved_at: stamp, hours, source_status: { weather: "demo", air: "demo" },
      attribution: "Illustrative demo values; no live forecast connection.", source_url: "https://open-meteo.com/", storage: "demo" }],
    hazards: [{ hazard: "flood", station_id: "08074500", station_name: "Whiteoak Bayou (demo)", lat: 29.7752, lon: -95.3972,
      metric: "Gage height, feet", value: 7.71, unit: "ft", severity: "normal", time: stamp }],
    recommendations: [{ id: "demo-outdoor", title: "Your next outdoor plan", category: "outdoor", location: "University of Houston",
      time: stamp, status: "demo preview", reason: "These illustrative conditions show how a personalized briefing works. Connect the backend to receive recommendations for your saved routines.",
      alternative_time: null, demo: true, suggestions: [{ title: "Review local conditions", description: "Check official weather and air-quality guidance before outdoor exercise.", source_url: "https://www.weather.gov/safety/heat" }] }],
    source_status: { flood: "demo", weather: "demo", air: "demo", grid: "demo; integration deferred", preferences: "local preview" },
    coverage: "Demo preview. Road closures and route safety are not assessed.",
  };
}
