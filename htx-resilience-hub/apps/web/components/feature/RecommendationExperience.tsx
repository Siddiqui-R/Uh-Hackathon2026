"use client";
import { useEffect, useState } from "react";
import RecommendationCard from "@/components/RecommendationCard";
import type { Briefing, UserPrefs } from "@/lib/types";
import FeatureFrame from "./FeatureFrame";
import ForecastTrends from "./ForecastTrends";
import styles from "./features.module.css";

function stamp(value: string): string { return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
export default function RecommendationExperience() {
  const [briefing, setBriefing] = useState<Briefing | null>(null), [prefs, setPrefs] = useState<UserPrefs | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  async function load() {
    setLoading(true); setError("");
    const [b, p] = await Promise.allSettled([fetch("/api/briefing", { cache: "no-store" }), fetch("/api/prefs", { cache: "no-store" })]);
    if (b.status === "fulfilled" && b.value.ok) setBriefing(await b.value.json() as Briefing);
    else setError(b.status === "fulfilled" && b.value.status === 401 ? "Your session expired. Sign in again to see your recommendations." : "Recommendations are unavailable. Try again when forecast data is ready.");
    if (p.status === "fulfilled" && p.value.ok) setPrefs((await p.value.json() as { preferences: UserPrefs }).preferences);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);
  const outdoor = briefing?.recommendations.filter((card) => card.category === "outdoor") ?? [];
  const supporting = briefing?.recommendations.filter((card) => card.category !== "outdoor") ?? [];
  return <FeatureFrame path="/recommendations" eyebrow="PLAN WITH EVIDENCE" title="Activity recommendations" description="Compare your planned time with a possible alternative using available weather and air-quality forecasts. Nothing here is a personal safety guarantee.">
    <div className={styles.stack}>
      {loading && <div className={styles.loading} role="status">Loading forecasts and recommendations…</div>}
      {error && <div className={styles.error} role="alert">{error} <button className={styles.quiet} onClick={() => void load()}>Retry</button> <a className={styles.inlineLink} href="/login">Sign in</a></div>}
      {!loading && briefing && <>
        <section className={styles.panel}><div className={styles.between}><div><h2>Your activity windows</h2><p className={styles.muted}>Forecast generated {stamp(briefing.generated_at)} · {briefing.timezone}</p></div><a className={styles.inlineLink} href="/routines">Edit activities</a></div>
          {!prefs?.routines.length && <p className={styles.notice}>These are general planning examples. <a className={styles.inlineLink} href="/routines">Save an activity</a> for a specific place and schedule.</p>}
          {!outdoor.length && <p className={styles.empty}>No upcoming activities have a usable forecast window. Plan an activity or check again when data is available.</p>}
          <div className={styles.cards}>{outdoor.map((card) => <RecommendationCard card={card} timezone={briefing.timezone} key={card.id} />)}</div>
        </section>
        <section className={styles.panel}><h2>Forecast sources and freshness</h2><p className={styles.muted}>Weather and air-quality forecasts are modeled. They are separate from observed AirNow monitors and USGS gauges.</p>
          {!briefing.forecasts.length && <p className={styles.empty}>Forecast snapshots are unavailable.</p>}
          <div className={styles.cards}>{briefing.forecasts.map((forecast) => {
            const old = Date.now() - Date.parse(forecast.retrieved_at) > 3_600_000;
            return <article className={styles.card} key={forecast.location.id}><h3>{forecast.location.name}</h3><div className={styles.meta}><span className={`${styles.badge} ${old ? styles.warn : ""}`}>{old ? "STALE" : "RECENT"}</span>{Object.entries(forecast.source_status).map(([key, value]) => <span className={styles.badge} key={key}>{key}: {value}</span>)}</div><p className={styles.source}>{forecast.attribution} · retrieved {stamp(forecast.retrieved_at)} · {forecast.hours.length} forecast hours.</p><ForecastTrends forecast={forecast} />{forecast.source_url && <a className={styles.inlineLink} href={forecast.source_url} target="_blank" rel="noreferrer">Open forecast source ↗</a>}</article>;
          })}</div>
        </section>
        {supporting.length > 0 && <section className={styles.panel}><h2>Other environmental guidance</h2><div className={styles.cards}>{supporting.map((card) => <RecommendationCard card={card} timezone={briefing.timezone} key={card.id} />)}</div></section>}
      </>}
    </div>
  </FeatureFrame>;
}
