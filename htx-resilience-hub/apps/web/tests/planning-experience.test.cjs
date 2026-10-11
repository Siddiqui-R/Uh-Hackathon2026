const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { load, root, React, renderToStaticMarkup, sample, render } = require("./forecast-presentation.test.cjs");
const Header = load(path.join(root, "components/PlanningHeader.tsx")).default;
const Controls = load(path.join(root, "components/MapLayerControls.tsx")).default;
const { layerAvailable, validatedLayerValue, gridAvailable } = load(path.join(root, "lib/mapLayers.ts"));
const { outlookSummary } = load(path.join(root, "lib/outlookPresentation.ts"));
const area = { generated_at: sample.forecast_retrieved_at, source_status: { air: "live model", weather: "live model" }, cells: [{ lat: 29.72, lon: -95.34, us_aqi: 52, apparent_temperature: 93, precipitation_probability: 0, valid_at: { air: sample.time, weather: sample.time } }] };
const noop = () => {};
const controlProps = { area, readings: [], timezone: "America/Chicago", layers: { air: true, heat: true, rain: true }, shade: "air", gauges: true, places: true, showGrid: true,
  onLayer: noop, onShade: noop, onGauges: noop, onPlaces: noop, onGrid: noop };

test("planning steps preserve routes and show only real counts", () => {
  const html = renderToStaticMarkup(React.createElement(Header, { step: "activities", prefs: { locations: [{id:"park"}], routines: [{id:"walk"}] } }));
  assert.match(html, /Places/); assert.match(html, /Activities/); assert.match(html, /Outlook/);
  for (const href of ["/places","/routines","/recommendations"]) assert.ok(html.includes(`href="${href}"`));
  assert.equal((html.match(/aria-current="step"/g) || []).length, 1);
  assert.match(html, /1 saved/); assert.match(html, /1 planned/);
  assert.ok(!renderToStaticMarkup(React.createElement(Header, {step:"places"})).includes("saved"));
});
test("layers toggle independently and zero rain is available", () => {
  const html = renderToStaticMarkup(React.createElement(Controls, controlProps));
  assert.equal((html.match(/type="checkbox"/g) || []).length, 6);
  assert.ok(!html.includes('role="radio"'));
  for (const layer of ["air","heat","rain"]) assert.equal(layerAvailable(area, layer), true);
  assert.equal(validatedLayerValue(area.cells[0], "rain"), 0);
  assert.match(html, /Color fill/); assert.match(html, /Other enabled layers appear as labeled values/);
});
test("unavailable or simulated grid is disabled without a live claim", () => {
  for (const status of ["unavailable","demo"]) {
    const grid = {status,title:"Not connected",updated:null,severity:null};
    assert.equal(gridAvailable(grid), false);
    const html = renderToStaticMarkup(React.createElement(Controls, {...controlProps, grid}));
    assert.match(html, /Power grid/); assert.match(html, /Unavailable/);
    assert.ok(!html.includes("Live grid"));
    assert.match(html, /No local outages/);
  }
  assert.equal(gridAvailable({status:"live",severity:"normal",updated:sample.time}),true);
  assert.equal(gridAvailable({status:"live",severity:"normal",updated:null}),false);
});
test("suspect values stay out of trustworthy map shading", () => {
  const bad = {...area,cells:[{...area.cells[0],apparent_temperature:-38,precipitation_probability:130}]};
  assert.equal(layerAvailable(bad,"heat"),false);
  assert.equal(layerAvailable(bad,"rain"),false);
  assert.equal(layerAvailable(bad,"air"),true);
  assert.equal(layerAvailable({...area,source_status:{weather:"unavailable",air:"live model"}},"heat"),false);
});
test("outlook uses duration peaks and preserves edit / activity anchors", () => {
  const card = {...sample,threshold_checks:[{metric:"apparent_temperature",label:"Feels like",value:99,unit:"°F",threshold:95,comparison:">=",exceeded:true}]};
  assert.match(outlookSummary(card), /peak 99°F ≥ your 95°F limit/);
  const html = render(card);
  assert.match(html, /id="activity-walk"/);
  assert.match(html, /href="\/routines\?activity=walk"/);
  assert.match(html, /Why this\?/); assert.match(html, /Sources and details/);
  assert.ok(!html.includes("<details open"));
});
test("older unflagged impossible response gets explicit review labeling", () => {
  const html = render({...sample,original_conditions:{...sample.original_conditions,temperature_f:-27,feels_like_f:-38}});
  assert.match(html, /Review data/); assert.match(html, /Unvalidated source values/);
  assert.match(html, /-27°F/); assert.match(html, /-38°F/);
});
test("old retrieval time cannot support an alternative even if the API status says current", () => {
  const html = render({...sample,forecast_retrieved_at:new Date(Date.now()-7_200_000).toISOString(),alternative_time:sample.time,alternative_conditions:sample.original_conditions});
  assert.match(html, /Stale forecast/);
  assert.ok(!html.includes('aria-label="Alternative"'));
});

test("missing or future retrieval times cannot support a time comparison", () => {
  for (const timestamp of [null,"invalid",new Date(Date.now()+7_200_000).toISOString()]) {
    const html = render({...sample,forecast_retrieved_at:timestamp,alternative_time:sample.time,alternative_conditions:sample.original_conditions});
    assert.match(html, /Freshness unverified/);
    assert.ok(!html.includes('aria-label="Alternative"'));
  }
});
