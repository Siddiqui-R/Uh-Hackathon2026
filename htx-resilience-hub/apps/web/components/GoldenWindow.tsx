"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Forecast, ForecastHour, Recommendation } from "@/lib/types";
import styles from "./goldenWindow.module.css";

const HOUR = 3_600_000, SPAN = 18;
type Metric = "feels" | "aqi" | "rain";
type RGB = [number, number, number];
type Limits = Record<Metric, { near: number; over: number; inclusive: boolean }>;
type Peaks = { values: Record<Metric, number | undefined>; levels: Record<Metric, number | undefined>; worst: number; complete: boolean };
type DayWindow = { start: number; count: number; hours: (ForecastHour | undefined)[] };
type Scene = { frac: number; elevation: number; feels?: number; aqi?: number; rain?: number; heatLimit: number };

const METRICS: Metric[] = ["feels", "aqi", "rain"];
const FIELD = { feels: "apparent_temperature", aqi: "us_aqi", rain: "precipitation_probability" } as const;
const NAME: Record<Metric, string> = { feels: "feels-like", aqi: "modeled AQI", rain: "rain chance" };
const UNIT: Record<Metric, string> = { feels: "°F", aqi: "", rain: "%" };
const ROWS: [Metric | "all", string][] = [["all", "Overall"], ["feels", "Heat"], ["aqi", "Air"], ["rain", "Rain"]];
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

// Hours flagged for a data-quality review are treated as missing, never as usable values.
function value(hour: ForecastHour | undefined, metric: Metric): number | undefined {
  if (!hour || hour.data_quality_notes?.length) return undefined;
  const raw = hour[FIELD[metric]];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}
function level(raw: number | undefined, limit: Limits[Metric]): number | undefined {
  if (raw === undefined) return undefined;
  return (limit.inclusive ? raw >= limit.over : raw > limit.over) ? 2 : raw >= limit.near ? 1 : 0;
}
function buildWindow(forecast: Forecast, planned: number, minutes: number): DayWindow | null {
  const byTime = new Map<number, ForecastHour>();
  for (const hour of forecast.hours) { const at = Date.parse(hour.time); if (Number.isFinite(at)) byTime.set(at, hour); }
  if (!byTime.size || !Number.isFinite(planned)) return null;
  const times = Array.from(byTime.keys());
  const first = Math.min(...times), last = Math.max(...times) + HOUR;
  if (planned < first || planned + minutes * 60_000 > last) return null;
  const end = Math.min(last, Math.max(first, Math.floor(planned / HOUR) * HOUR - 5 * HOUR) + SPAN * HOUR);
  const start = Math.max(first, end - SPAN * HOUR), count = Math.round((end - start) / HOUR);
  return { start, count, hours: Array.from({ length: count }, (_, index) => byTime.get(start + index * HOUR)) };
}
function peaks(win: DayWindow, at: number, minutes: number, limits: Limits): Peaks {
  const index = (time: number) => clamp(Math.floor((time - win.start) / HOUR), 0, win.count - 1);
  const from = index(at), to = index(at + Math.max(0, minutes * 60_000 - 1));
  const result: Peaks = { values: { feels: undefined, aqi: undefined, rain: undefined }, levels: { feels: undefined, aqi: undefined, rain: undefined }, worst: 0, complete: true };
  for (const metric of METRICS) {
    for (let i = from; i <= to; i++) {
      const raw = value(win.hours[i], metric);
      if (raw === undefined) { if (metric !== "rain") result.complete = false; continue; }
      result.values[metric] = Math.max(result.values[metric] ?? -Infinity, raw);
    }
    result.levels[metric] = level(result.values[metric], limits[metric]);
    result.worst = Math.max(result.worst, result.levels[metric] ?? 0);
  }
  return result;
}
function blend(win: DayWindow, metric: Metric, at: number): number | undefined {
  const x = clamp((at - win.start) / HOUR, 0, win.count - 1), i = Math.floor(x);
  const a = value(win.hours[i], metric), b = value(win.hours[Math.min(win.count - 1, i + 1)], metric) ?? a;
  return a === undefined || b === undefined ? a : a + (b - a) * (x - i);
}
// Low-precision solar position (about 0.01°): real geometry for the saved place, not forecast data.
function sunElevation(at: number, lat: number, lon: number): number {
  const rad = Math.PI / 180, days = (at - 946_728_000_000) / 86_400_000;
  const anomaly = (357.528 + 0.9856003 * days) * rad;
  const longitude = (280.46 + 0.9856474 * days + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * rad;
  const tilt = (23.439 - 0.0000004 * days) * rad;
  const ascension = Math.atan2(Math.cos(tilt) * Math.sin(longitude), Math.cos(longitude));
  const declination = Math.asin(Math.sin(tilt) * Math.sin(longitude));
  const hourAngle = ((18.697374558 + 24.06570982441908 * days) * 15 + lon) * rad - ascension;
  return Math.asin(Math.sin(lat * rad) * Math.sin(declination) + Math.cos(lat * rad) * Math.cos(declination) * Math.cos(hourAngle)) / rad;
}
function difference(now: number | undefined, then: number | undefined, unit: string): string {
  if (now === undefined || then === undefined) return "unavailable";
  const delta = Math.round(now) - Math.round(then);
  return delta === 0 ? "unchanged" : `${Math.abs(delta)}${unit} ${delta < 0 ? "lower" : "higher"}`;
}

const SKY: Record<string, RGB> = { nightTop: [13, 22, 40], nightLow: [32, 46, 72], duskTop: [58, 72, 108], duskLow: [232, 158, 108],
  dayTop: [72, 144, 200], dayLow: [196, 226, 240], hotTop: [150, 182, 198], hotLow: [246, 232, 196] };
const SKYLINE = [[.03, .05, .22], [.09, .04, .31], [.14, .06, .18], [.22, .05, .42], [.28, .035, .56], [.32, .05, .38], [.385, .04, .64], [.435, .06, .48],
  [.505, .035, .72], [.55, .05, .52], [.61, .04, .36], [.66, .06, .45], [.73, .04, .28], [.78, .05, .34], [.84, .04, .2], [.89, .07, .26]];
const mix = (a: RGB, b: RGB, f: number): RGB => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
const rgb = (c: RGB, alpha = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${alpha})`;
const noise = (seed: number) => { const v = Math.sin(seed) * 43758.5453; return v - Math.floor(v); };

// Every visual maps to a value: sun = solar elevation, washout = feels-like against the heat limit, haze = AQI, streaks = rain chance.
function drawScene(canvas: HTMLCanvasElement, scene: Scene, phase: number) {
  const ratio = Math.min(2, window.devicePixelRatio || 1), w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) { canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio); }
  const c = canvas.getContext("2d");
  if (!c) return;
  c.setTransform(ratio, 0, 0, ratio, 0, 0);
  const day = clamp(scene.elevation / 12, 0, 1), night = clamp(-scene.elevation / 8, 0, 1), aqi = scene.aqi ?? 0, rain = scene.rain ?? 0;
  const hot = scene.feels === undefined ? 0 : clamp((scene.feels - (scene.heatLimit - 4)) / 14, 0, 1) * day;
  const top = mix(scene.elevation >= 0 ? mix(SKY.duskTop, SKY.dayTop, day) : mix(SKY.duskTop, SKY.nightTop, night), SKY.hotTop, hot * .8);
  const low = mix(scene.elevation >= 0 ? mix(SKY.duskLow, SKY.dayLow, day) : mix(SKY.duskLow, SKY.nightLow, night), SKY.hotLow, hot * .9);
  const horizon = h * .86;
  let fill = c.createLinearGradient(0, 0, 0, horizon);
  fill.addColorStop(0, rgb(top)); fill.addColorStop(1, rgb(low));
  c.fillStyle = fill; c.fillRect(0, 0, w, h);
  if (night > 0) {
    c.fillStyle = rgb([236, 240, 250], night * .8);
    for (let i = 1; i <= 36; i++) c.fillRect(noise(i * 7.13) * w, noise(i * 3.71) * horizon * .7, 1.5, 1.5);
  }
  if (scene.elevation > -12) {
    const x = w * .06 + scene.frac * w * .88, y = horizon - clamp(scene.elevation, -12, 90) / 80 * horizon * .8;
    const radius = clamp(w * .022, 9, 20), sun = mix([255, 170, 96], [255, 246, 208], day);
    fill = c.createRadialGradient(x, y, radius * .5, x, y, radius * 5);
    fill.addColorStop(0, rgb(sun, .55)); fill.addColorStop(1, rgb(sun, 0));
    c.fillStyle = fill; c.fillRect(x - radius * 5, y - radius * 5, radius * 10, radius * 10);
    c.fillStyle = rgb(sun); c.beginPath(); c.arc(x, y, radius, 0, Math.PI * 2); c.fill();
  }
  if (rain > 8) {
    fill = c.createLinearGradient(0, 0, 0, horizon * .75);
    fill.addColorStop(0, rgb([66, 76, 92], rain / 100 * .75)); fill.addColorStop(1, rgb([66, 76, 92], 0));
    c.fillStyle = fill; c.fillRect(0, 0, w, horizon);
  }
  c.fillStyle = rgb(mix([12, 20, 30], [62, 84, 92], day));
  for (const [x, width, height] of SKYLINE) c.fillRect(x * w, horizon - height * horizon * .8, width * w + 1, height * horizon * .8 + 1);
  c.fillStyle = rgb(mix([9, 16, 20], [56, 80, 66], day)); c.fillRect(0, horizon, w, h - horizon);
  const haze = clamp((aqi - 45) / 110, 0, 1) * .62;
  if (haze > 0) {
    fill = c.createLinearGradient(0, horizon * .2, 0, horizon);
    fill.addColorStop(0, rgb([204, 178, 128], 0)); fill.addColorStop(1, rgb([204, 178, 128], haze));
    c.fillStyle = fill; c.fillRect(0, 0, w, h);
  }
  const streaks = Math.round(rain * 1.4 * w / 700);
  c.strokeStyle = "rgba(226,236,246,.55)"; c.lineWidth = 1; c.beginPath();
  for (let i = 1; i <= streaks; i++) {
    const x = noise(i * 12.9898) * w, y = (noise(i * 78.233) * h + phase * h * (.6 + noise(i * .37) * .6)) % h;
    c.moveTo(x, y); c.lineTo(x - 3, y + 12);
  }
  c.stroke();
}

export default function GoldenWindow({ card, forecast, timezone, thresholds }: {
  card: Recommendation; forecast: Forecast; timezone: string; thresholds?: Record<string, number>;
}) {
  const minutes = card.duration_minutes ?? 60, plannedAt = Date.parse(card.time);
  const win = useMemo(() => buildWindow(forecast, plannedAt, minutes), [forecast, plannedAt, minutes]);
  const heatLimit = thresholds?.feels_like_f ?? 95, aqiLimit = thresholds?.us_aqi ?? 100;
  const limits = useMemo<Limits>(() => ({ feels: { near: heatLimit - 5, over: heatLimit, inclusive: true },
    aqi: { near: aqiLimit - 20, over: aqiLimit, inclusive: false }, rain: { near: 30, over: 50, inclusive: false } }), [heatLimit, aqiLimit]);
  const format = useMemo(() => ({
    when: new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", hour: "numeric", minute: "2-digit" }),
    clock: new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }),
    tick: new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric" }),
    day: new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }),
    hour: new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }),
  }), [timezone]);
  const [at, setAt] = useState(plannedAt), [note, setNote] = useState(""), [landed, setLanded] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null), plot = useRef<HTMLDivElement>(null);
  const frame = useRef(0), dragging = useRef(false), position = useRef(plannedAt), scene = useRef<Scene | null>(null);

  const low = win ? win.start : plannedAt, high = win ? win.start + win.count * HOUR - minutes * 60_000 : plannedAt;
  const now = clamp(at, low, high), planned = clamp(plannedAt, low, high);
  position.current = now;
  scene.current = win ? { frac: (now - win.start) / (win.count * HOUR), elevation: sunElevation(now, forecast.location.lat, forecast.location.lon),
    feels: blend(win, "feels", now), aqi: blend(win, "aqi", now), rain: blend(win, "rain", now), heatLimit } : null;

  const calm = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const paint = (time: number) => { if (canvas.current && scene.current) drawScene(canvas.current, scene.current, calm() ? 0 : time / 1400); };
  function glide(to: number, duration: number, done?: () => void) {
    cancelAnimationFrame(frame.current);
    if (calm()) { setAt(to); done?.(); return; }
    const from = position.current, began = performance.now();
    const step = (time: number) => {
      const x = clamp((time - began) / duration, 0, 1), eased = x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
      setAt(from + (to - from) * eased);
      if (x < 1) frame.current = requestAnimationFrame(step); else done?.();
    };
    frame.current = requestAnimationFrame(step);
  }
  // Opening sweep: play the day from its far edge to the planned time, so the change over the day is seen once.
  useEffect(() => {
    if (!win || calm()) return;
    const edge = planned - low >= high - planned ? low : high;
    position.current = edge; setAt(edge); glide(planned, 1600);
    return () => cancelAnimationFrame(frame.current);
  }, []);
  useEffect(() => { paint(performance.now()); });
  useEffect(() => {
    let id = 0;
    const loop = (time: number) => { if (!calm() && (scene.current?.rain ?? 0) > 8) paint(time); id = requestAnimationFrame(loop); };
    id = requestAnimationFrame(loop);
    const watcher = canvas.current && "ResizeObserver" in window ? new ResizeObserver(() => paint(performance.now())) : null;
    if (watcher && canvas.current) watcher.observe(canvas.current);
    return () => { cancelAnimationFrame(id); watcher?.disconnect(); };
  }, []);

  if (!win) return <p className={styles.unavailable}>The hourly forecast does not cover this activity’s time yet, so the day view is unavailable.</p>;

  const current = peaks(win, now, minutes, limits), reference = peaks(win, planned, minutes, limits);
  const moved = Math.abs(now - planned) >= 60_000;
  const dark = Math.min(sunElevation(now, forecast.location.lat, forecast.location.lon), sunElevation(now + minutes * 60_000, forecast.location.lat, forecast.location.lon)) < -.8;
  const over = METRICS.filter((metric) => current.levels[metric] === 2), near = METRICS.filter((metric) => current.levels[metric] === 1);
  const show = (metric: Metric) => current.values[metric] === undefined ? "Unavailable" : `${Math.round(current.values[metric] as number)}${UNIT[metric]}`;
  const span = `${format.when.format(now)} to ${format.clock.format(now + minutes * 60_000)}`;
  const findings = [...over.map((metric) => `${NAME[metric]} peaks at ${show(metric)}, over your ${limits[metric].over}${UNIT[metric]} limit`),
    ...near.map((metric) => `${NAME[metric]} reaches ${show(metric)}, close to your ${limits[metric].over}${UNIT[metric]} limit`)];
  const verdict = !current.complete ? "Forecast gaps" : current.worst === 2 ? "Over a limit" : current.worst === 1 ? "Close to a limit" : "Under your limits";
  const sentence = !current.complete ? `${span}: some heat or AQI values are missing, so this time cannot be compared with your limits.`
    : `${span}: ${findings.length ? `${findings.join("; ")}.` : "heat, air and rain chance all stay under your limits."}`;

  function move(event: React.PointerEvent<HTMLDivElement>) {
    if (!plot.current || !win) return;
    const box = plot.current.getBoundingClientRect();
    cancelAnimationFrame(frame.current);
    const raw = win.start + (event.clientX - box.left) / box.width * win.count * HOUR - minutes * 30_000;
    setAt(clamp(Math.round(raw / (HOUR / 2)) * (HOUR / 2), low, high)); setNote("");
  }
  function key(event: React.KeyboardEvent<HTMLDivElement>) {
    const jump = ({ ArrowLeft: -HOUR / 2, ArrowDown: -HOUR / 2, ArrowRight: HOUR / 2, ArrowUp: HOUR / 2, PageDown: -HOUR, PageUp: HOUR } as Record<string, number>)[event.key];
    if (jump === undefined && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault(); cancelAnimationFrame(frame.current); setNote("");
    setAt(event.key === "Home" ? low : event.key === "End" ? high : clamp(now + jump, low, high));
  }
  // An over-limit plan gets the soonest later hour with nothing over a limit, matching the outlook's alternative rule.
  // Otherwise the daytime hours are ranked: nearest 72°F feels-like, then lowest AQI and rain chance.
  function find() {
    if (!win) return;
    const options: { start: number; result: Peaks; score: number }[] = [];
    for (let i = 0; i < win.count; i++) {
      const start = win.start + i * HOUR, localHour = Number(format.hour.format(start));
      if (start > high || localHour < 6 || localHour >= 21) continue;
      const result = peaks(win, start, minutes, limits);
      if (!result.complete || result.values.feels === undefined || result.values.aqi === undefined) continue;
      options.push({ start, result, score: Math.abs(result.values.feels - 72) / 20 + result.values.aqi / limits.aqi.over + (result.values.rain ?? 0) / 50 });
    }
    if (!options.length) { setNote("No daytime start in this window has complete heat and AQI forecasts."); return; }
    const best = (list: typeof options) => list.reduce((a, b) => b.score < a.score - 1e-9 ? b : a);
    const clear = options.filter((option) => option.result.worst < 2);
    let pick = current.worst === 2 || !current.complete ? clear.find((option) => option.start > now) : undefined;
    let message = pick ? `Soonest later start with nothing over your limits: ${format.when.format(pick.start)}.` : "";
    if (!pick && clear.length) { pick = best(clear); message = `Most comfortable daytime start in this window: ${format.when.format(pick.start)}.`; }
    if (!pick) { pick = best(options); message = `Nothing in this window stays under your limits. Closest: ${format.when.format(pick.start)}.`; }
    if (Math.abs(pick.start - now) < 60_000) { setNote(`${format.when.format(now)} is already the best match in this window.`); setLanded((count) => count + 1); return; }
    setNote(message); glide(pick.start, 1100, () => setLanded((count) => count + 1));
  }

  const ticks = Array.from({ length: win.count - 1 }, (_, index) => index + 1).map((index) => ({ index, hour: Number(format.hour.format(win.start + index * HOUR)) })).filter((tick) => tick.hour % 3 === 0);
  return <section className={styles.root} aria-label={`Golden window for ${card.title}`}>
    <div className={styles.head}>
      <div><p className="section-label">GOLDEN WINDOW</p><h4>When is the best time for {card.title}?</h4></div>
      <button type="button" className={`primary ${styles.find}`} onClick={find}>Find my window</button>
    </div>
    <div className={styles.scene}>
      <canvas ref={canvas} aria-hidden />
      <div className={styles.caption}><b>{format.when.format(now)}</b>
        <span>{METRICS.map((metric) => { const raw = value(win.hours[clamp(Math.floor((now - win.start) / HOUR), 0, win.count - 1)], metric);
          return `${metric === "feels" ? "feels" : metric === "aqi" ? "AQI" : "rain"} ${raw === undefined ? "unavailable" : `${Math.round(raw)}${UNIT[metric]}`}`; }).join(" · ")}</span></div>
    </div>
    <div className={styles.timeline}>
      <p className={styles.key}><span><i className={styles.l0} />Under limit</span><span><i className={styles.l1} />Close to limit</span><span><i className={styles.l2} />Over limit</span><span><i />No forecast</span></p>
      <div className={styles.rows}>
        {ROWS.map(([row, label]) => <div className={`${styles.row}${row === "all" ? ` ${styles.overall}` : ""}`} key={row}>
          <span className={styles.label}>{label}</span>
          <div className={styles.cells}>{win.hours.map((hour, index) => {
            const levels = (row === "all" ? METRICS : [row]).map((metric) => level(value(hour, metric), limits[metric]));
            const known = levels.filter((item): item is number => item !== undefined);
            const missing = row === "all" ? levels[0] === undefined || levels[1] === undefined : !known.length;
            const raw = row === "all" ? undefined : value(hour, row);
            return <i key={index} className={missing ? undefined : styles[`l${Math.max(...known)}`]}
              title={`${format.when.format(win.start + index * HOUR)}${row === "all" ? "" : `: ${NAME[row]} ${raw === undefined ? "unavailable" : `${Math.round(raw)}${UNIT[row]}`}`}`} />;
          })}</div>
        </div>)}
        <div className={styles.plot} ref={plot}
          onPointerDown={(event) => { dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); move(event); }}
          onPointerMove={(event) => { if (dragging.current) move(event); }}
          onPointerUp={() => { dragging.current = false; }} onPointerCancel={() => { dragging.current = false; }}>
          {moved && <span className={styles.planned} style={{ left: `${(planned - win.start) / (win.count * HOUR) * 100}%` }} aria-hidden>Planned</span>}
          <div key={landed} className={`${styles.marker}${landed ? ` ${styles.landed}` : ""}`} role="slider" tabIndex={0} onKeyDown={key}
            aria-label={`Start time for ${card.title}`} aria-valuemin={low} aria-valuemax={high} aria-valuenow={Math.round(now)} aria-valuetext={span}
            style={{ left: `${(now - win.start) / (win.count * HOUR) * 100}%`, width: `${minutes / 60 / win.count * 100}%` }} />
        </div>
      </div>
      <div className={styles.axis}>{ticks.map((tick) => <span key={tick.index} style={{ left: `${tick.index / win.count * 100}%` }}>
        {tick.hour === 0 ? format.day.format(win.start + tick.index * HOUR) : format.tick.format(win.start + tick.index * HOUR)}</span>)}</div>
    </div>
    <p className={styles.note} role="status">{note}</p>
    <div className={styles.verdict}><span className={`${styles.pill} ${styles[`p${current.complete ? current.worst : 3}`] ?? ""}`}>{verdict}</span><p>{sentence}</p></div>
    <dl className={styles.read}>
      {METRICS.map((metric) => <div key={metric}><dt>Peak {NAME[metric]}</dt><dd>{show(metric)}
        <small><i className={current.levels[metric] === undefined ? undefined : styles[`l${current.levels[metric]}`]} />your limit {limits[metric].over}{UNIT[metric]}</small></dd></div>)}
    </dl>
    <p className={styles.compare}>{moved
      ? `${format.when.format(now)} compared with your planned ${format.when.format(planned)}: feels-like ${difference(current.values.feels, reference.values.feels, "°")}, AQI ${difference(current.values.aqi, reference.values.aqi, "")}, rain chance ${difference(current.values.rain, reference.values.rain, " points")}.${dark ? " It will be dark for part of this time." : ""}`
      : "This is your planned time. Drag the block or press Find my window to compare another time."}</p>
    <p className={styles.fine}>{card.demo ? "Illustrative demo values, not a live forecast," : "Modeled hourly forecast"} for {forecast.location.name}. Values change once an hour; the sky blends between hours for display only, and the sun follows the real solar position for this place.
      “Close” means within 5°F of your heat limit, within 20 points of your AQI limit, or a rain chance above 30%. The rain limit of 50% is the app’s default. These are your saved preferences, not a safety assessment, and cold-weather risk is not evaluated.</p>
  </section>;
}
