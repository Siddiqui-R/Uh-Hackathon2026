// Run with node --test apps/web/tests/forecast-presentation.test.cjs from the project root.
// Use the project's TypeScript compiler and React renderer; no test dependencies.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const root = path.resolve(__dirname, "..");
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const compiled = new Module(file, module);
  compiled.filename = file;
  compiled.paths = module.paths;
  compiled.require = (name) => {
    if (name.endsWith(".css")) return new Proxy({}, { get: (_, key) => key === "__esModule" ? false : String(key) });
    if (name.startsWith("@/") || name.startsWith(".")) {
      const base = name.startsWith("@/") ? path.join(root, name.slice(2)) : path.resolve(path.dirname(file), name);
      return load([base, base + ".tsx", base + ".ts"].find((p) => fs.existsSync(p)));
    }
    return require(name);
  };
  compiled._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, file);
  cache.set(file, compiled.exports);
  return compiled.exports;
}
const { rainMessage, forecastNumber, forecastTime, forecastFreshness } = load(path.join(root, "lib/forecastPresentation.ts"));
const Card = load(path.join(root, "components/RecommendationCard.tsx")).default;
const Navigation = load(path.join(root, "components/SiteNavigation.tsx")).default;
const sample = {
  id: "walk", title: "Walk at the park", location: "University of Houston", time: "2026-10-11T22:00:00Z",
  category: "outdoor", status: "review conditions", reason: "Review available forecast values.", suggestions: [], demo: false,
  alternative_time: null, forecast_status: "current", forecast_retrieved_at: new Date().toISOString(),
  original_conditions: { forecast_hour: "2026-10-11T22:00:00Z", temperature_f: 89, feels_like_f: 93, us_aqi: 52, pm25_ug_m3: null, precipitation_probability: 0 },
};
const render = (card) => renderToStaticMarkup(React.createElement(Card, { card, timezone: "America/Chicago" }));

test("rain messaging distinguishes zero, unavailable, positive and invalid probability", () => {
  assert.match(rainMessage(0), /^0% forecast rain chance/);
  assert.match(rainMessage(null), /unavailable.*does not mean zero/);
  assert.match(rainMessage(undefined), /unavailable/);
  assert.match(rainMessage(80), /80%.*does not mean it is raining/);
  assert.match(rainMessage(130), /outside/);
});
test("temperatures stay unchanged, missing is not zero, timestamps use the saved zone", () => {
  assert.equal(forecastNumber(-27, "°F"), "-27°F");
  assert.equal(forecastNumber(null, "%"), "Unavailable");
  assert.equal(forecastNumber(NaN), "Unavailable");
  assert.match(forecastTime(sample.time, "America/Chicago"), /5:00 PM CDT/);
  assert.equal(forecastTime("invalid"), "Time unavailable");
});
test("freshness labels do not call invalid or future retrieval times recent", () => {
  const now = Date.parse("2026-10-11T16:00:00Z");
  assert.equal(forecastFreshness("invalid", now), "Freshness unverified");
  assert.equal(forecastFreshness("2026-10-11T17:00:00Z", now), "Freshness unverified");
  assert.equal(forecastFreshness("2026-10-11T14:00:00Z", now), "Stale · over 1 hour old");
});
test("activity card includes units, forecast-valid and retrieval times, source separation", () => {
  const html = render(sample);
  for (const text of ["89°F", "93°F", "52 US AQI", "Unavailable", "forecast valid from", "Retrieved", "AirNow and USGS observations", "University of Houston", "0% forecast rain chance"]) assert.ok(html.includes(text), text);
  assert.ok(!html.includes("☀"));
});
test("anomalous values are visible and never get an alternative panel", () => {
  const html = render({ ...sample, status: "data quality review", data_quality: [{ forecast_hour: sample.time, note: "Open-Meteo reports an unusual value; verify the source." }],
    original_conditions: { ...sample.original_conditions, temperature_f: -27, feels_like_f: -38 }, alternative_time: sample.time, alternative_conditions: sample.original_conditions });
  assert.match(html, /-27°F/); assert.match(html, /-38°F/); assert.match(html, /Data quality needs review/);
  assert.ok(!html.includes('aria-label="Alternative"'));
  assert.match(html, /Unvalidated source values/);
});
test("stale and missing forecasts remain explicitly labeled", () => {
  assert.match(render({ ...sample, forecast_status: "stale" }), /Forecast stale/);
  assert.match(render({ ...sample, forecast_status: "missing", original_conditions: null }), /No forecast values are available/);
});
test("shared navigation exposes every destination with one active page and a skip link", () => {
  const html = renderToStaticMarkup(React.createElement(Navigation, { path: "/recommendations", account: React.createElement("button", null, "Log out") }));
  for (const route of ["/", "/places", "/routines", "/recommendations", "/monitor", "/assistant", "/settings"]) assert.ok(html.includes(`href="${route}"`));
  assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
  for (const text of ["Plan", "Conditions", "Overview", "Account", "Log out", "#main-content"]) assert.ok(html.includes(text));
});

// Optional local visual fixture. Never mounted in the app or connected to account data.
if (process.env.NOACH_VISUAL_FIXTURE) {
  const navigation = renderToStaticMarkup(React.createElement(Navigation, { path: "/recommendations", account: React.createElement("button", { className: "quiet" }, "Log out") }));
  const alternative = { ...sample, title: "Play basketball", status: "consider alternatives", duration_minutes: 60,
    reason: "Across the 60-minute activity, highest modeled feels-like temperature 98°F; highest modeled US AQI 112. Your selected thresholds are exceeded.",
    original_conditions: { ...sample.original_conditions, feels_like_f: 98, us_aqi: 112 }, alternative_time: "2026-10-12T00:00:00Z",
    alternative_conditions: { ...sample.original_conditions, forecast_hour: "2026-10-12T00:00:00Z", temperature_f: 79, feels_like_f: 85, us_aqi: 56 } };
  const css = fs.readFileSync(path.join(root, "app/globals.css"), "utf8") + fs.readFileSync(path.join(root, "components/siteNavigation.module.css"), "utf8").replace(/:global\(([^)]+)\)/g, "$1");
  fs.writeFileSync(process.env.NOACH_VISUAL_FIXTURE, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Noach layout fixture</title><style>${css}</style><body><div class="app-shell">${navigation}<main id="main-content" tabindex="-1"><section class="page-intro"><p class="section-label">PLAN WITH EVIDENCE · LOCAL TEST FIXTURE</p><h1>Activity recommendations</h1><p class="muted">Compare your planned time with a possible alternative.</p></section><div style="display:grid;gap:20px">${render(alternative)}${render({ ...sample, title: "Anomalous source fixture", status: "data quality review", data_quality: [{ forecast_hour: sample.time, note: "Open-Meteo reports temperature -27°F and feels-like -38°F. Values are unchanged; verify the source." }], original_conditions: { ...sample.original_conditions, temperature_f: -27, feels_like_f: -38 } })}${render({ ...sample, title: "Missing forecast fixture", forecast_status: "missing", original_conditions: null })}</div></main></div></body></html>`);
}

module.exports = { load, root, React, renderToStaticMarkup, sample, render };
