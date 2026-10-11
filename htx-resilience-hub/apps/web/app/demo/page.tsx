import type { Metadata } from "next";
import RecommendationCard from "@/components/RecommendationCard";
import { demoBriefing } from "@/lib/demo";
import type { ActivityConditions, Recommendation } from "@/lib/types";
import { forecastTime } from "@/lib/forecastPresentation";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Try the demo | Noach" };

const zone = "America/Chicago";
const places = [
  { name: "University of Houston", detail: "Basketball court" },
  { name: "Hermann Park", detail: "Walking trail" },
  { name: "Buffalo Bayou Park", detail: "Running route" },
];

function nextHour(hours: { time: string }[], hour: number) {
  return hours.find((item) => new Date(item.time).getTime() > Date.now() &&
    Number(new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", hourCycle: "h23" }).format(new Date(item.time))) === hour)?.time ?? hours[12].time;
}

function conditions(time: string, temperature_f: number, feels_like_f: number, us_aqi: number, precipitation_probability: number): ActivityConditions {
  return { forecast_hour: time, temperature_f, feels_like_f, us_aqi, pm25_ug_m3: null, precipitation_probability };
}

function example(id: string, title: string, location: string, time: string, duration_minutes: number, original: ActivityConditions,
  alternativeTime: string | null, alternative: ActivityConditions | null, reason: string): Recommendation {
  return {
    id, title, location, time, duration_minutes, category: "outdoor", status: alternative ? "consider alternatives" : "good to go",
    reason, alternative_time: alternativeTime, original_conditions: original, alternative_conditions: alternative,
    forecast_retrieved_at: new Date().toISOString(), forecast_attribution: "Illustrative Houston scenario. Values are preloaded for this demo and are not live forecasts.",
    forecast_status: "current", demo: true,
    threshold_checks: [
      { metric: "feels_like_f", label: "Feels like", value: original.feels_like_f ?? 0, unit: "°F", threshold: 95, comparison: ">", exceeded: (original.feels_like_f ?? 0) > 95 },
      { metric: "us_aqi", label: "Modeled US AQI", value: original.us_aqi ?? 0, unit: "US AQI", threshold: 100, comparison: ">", exceeded: (original.us_aqi ?? 0) > 100 },
    ],
    suggestions: [{ title: "Review heat safety guidance", description: "Official outdoor heat guidance", source_url: "https://www.weather.gov/safety/heat" }],
  };
}

export default function DemoPage() {
  const briefing = demoBriefing();
  const hours = briefing.forecasts[0].hours;
  const basketball = nextHour(hours, 17);
  const walk = nextHour(hours, 9);
  const run = nextHour(hours, 18);
  const basketballLater = new Date(Date.parse(basketball) + 2 * 3_600_000).toISOString();
  const runLater = new Date(Date.parse(run) + 2 * 3_600_000).toISOString();
  const recommendations = [
    example("basketball", "Play basketball", places[0].name, basketball, 60,
      conditions(basketball, 89, 98, 112, 20), basketballLater,
      conditions(basketballLater, 79, 85, 56, 15),
      "The example 5 PM heat index and modeled AQI exceed the sample limits of 95°F feels-like and 100 US AQI. The later hour is cooler and has lower modeled AQI."),
    example("park-walk", "Walk in Hermann Park", places[1].name, walk, 45,
      conditions(walk, 76, 80, 48, 10), null, null,
      "The example morning window is below the sample heat and AQI limits. Check current conditions before heading out."),
    example("bayou-run", "Run along Buffalo Bayou", places[2].name, run, 30,
      conditions(run, 86, 96, 72, 35), runLater,
      conditions(runLater, 78, 83, 52, 20),
      "The example feels-like temperature is above the sample 95°F limit. A later start has lower heat and a lower rain chance in this scenario."),
  ];

  return <div className="app-shell public-dashboard">
    <header className="site-header"><a href="/" className="wordmark"><span className="brand-icon" aria-hidden>✳</span> Noach</a>
      <nav aria-label="Main navigation"><a href="/">Home</a><a href="/demo" aria-current="page">Demo</a></nav>
      <a className="secondary" href="/signup">Create an account</a>
    </header>
    <main id="main-content" className={styles.main}>
      <div className={styles.intro}><div><p className="section-label">EXPLORE NOACH / SAMPLE SCENARIO</p><h1>A Houston day, already planned.</h1>
        <p className="muted">See how saved places and activities turn into an outdoor outlook. These preloaded values are illustrative, not live conditions.</p></div>
        <a className="primary" href="/signup">Make your own plan ↗</a></div>
      <div className={styles.notice} role="note"><strong>Demo data</strong><span>Times move with the calendar. Weather, air quality, gauge readings, and recommendations shown here are simulated.</span></div>
      <section aria-labelledby="places-title" className={styles.section}><div className="section-heading"><div><p className="section-label">01 / SAVED PLACES</p><h2 id="places-title">Places in this plan</h2></div><span className="tiny">Houston, TX</span></div>
        <div className={styles.placeGrid}>{places.map((place, index) => <div className={styles.place} key={place.name}><span className={styles.number}>0{index + 1}</span><div><strong>{place.name}</strong><span>{place.detail}</span></div></div>)}</div>
      </section>
      <section aria-labelledby="conditions-title" className={styles.section}><div className="section-heading"><div><p className="section-label">02 / EXAMPLE CONDITIONS</p><h2 id="conditions-title">What the plan checks</h2></div><span className="tiny">Sample limits: 95°F feels-like · 100 US AQI</span></div>
        <div className={styles.metrics}><div><span>Feels-like at basketball</span><strong>98°F</strong><small>Above sample limit</small></div><div><span>Modeled AQI at basketball</span><strong>112</strong><small>Above sample limit</small></div><div><span>Whiteoak Bayou gauge</span><strong>7.71 ft</strong><small>Illustrative height · stage unrated</small></div></div>
      </section>
      <section aria-labelledby="activities-title" className={styles.section}><div className="section-heading"><div><p className="section-label">03 / ACTIVITIES & OUTLOOK</p><h2 id="activities-title">Three plans to explore</h2></div><span className="tiny">Open “Why this?” on any activity for details</span></div>
        <nav className={styles.activityNav} aria-label="Sample activities">{recommendations.map((item) => <a href={`#activity-${item.id}`} key={item.id}><strong>{item.title}</strong><span>{forecastTime(item.time, zone)} ↗</span></a>)}</nav>
        <div className={styles.recommendations}>{recommendations.map((item) => <RecommendationCard card={item} timezone={zone} key={item.id} />)}</div>
      </section>
      <section className={styles.finish}><div><p className="section-label">YOUR TURN</p><h2>Plan around your own places.</h2><p>Save activities and see an outlook using available forecast sources.</p></div><a className="primary" href="/signup">Create an account ↗</a></section>
    </main>
    <footer><a className="wordmark" href="/"><span className="brand-icon" aria-hidden>✳</span> Noach</a><p>Local awareness. Everyday resilience.</p><span className="tiny">Built for Houston · CodeRED: Orion 2026</span></footer>
  </div>;
}
