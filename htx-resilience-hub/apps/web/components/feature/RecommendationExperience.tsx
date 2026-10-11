"use client";
import { useEffect, useState } from "react";
import RecommendationCard from "@/components/RecommendationCard";
import { forecastTime, forecastFreshness } from "@/lib/forecastPresentation";
import type { Briefing, UserPrefs } from "@/lib/types";
import FeatureFrame from "./FeatureFrame";
import ForecastTrends from "./ForecastTrends";
import styles from "./features.module.css";

export default function RecommendationExperience() {
  const [briefing, setBriefing] = useState<Briefing | null>(null), [prefs, setPrefs] = useState<UserPrefs | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  async function load(quiet = false) {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const [b, p] = await Promise.allSettled([fetch("/api/briefing", { cache: "no-store" }), fetch("/api/prefs", { cache: "no-store" })]);
      if (b.status === "fulfilled" && b.value.ok) setBriefing(await b.value.json() as Briefing);
      else setError(b.status === "fulfilled" && b.value.status === 401 ? "Your session expired. Sign in again to see your recommendations." : "Recommendations are unavailable. Try again when forecast data is ready.");
      if (p.status === "fulfilled" && p.value.ok) setPrefs((await p.value.json() as { preferences: UserPrefs }).preferences);
    } catch { setError("Recommendations could not be read. Try again shortly."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); const timer = setInterval(() => void load(true), 60_000); return () => clearInterval(timer); }, []);
  const outdoor = briefing?.recommendations.filter((card) => card.category === "outdoor") ?? [];
  const supporting = briefing?.recommendations.filter((card) => card.category !== "outdoor") ?? [];
  return <FeatureFrame path="/recommendations" eyebrow="PLAN WITH EVIDENCE" title="Activity recommendations" description="Check your scheduled activities." planningPrefs={prefs}>
    <div className={styles.stack}>
      {loading && <div className={styles.loading} role="status">Loading forecasts and recommendations…</div>}
      {error && <div className={styles.error} role="alert">{error} <button className={styles.quiet} onClick={() => void load()}>Retry</button> <a className={styles.inlineLink} href="/login">Sign in</a></div>}
      {!loading && briefing && <>
        <section className={styles.outlookSection}><div className={styles.between}><div><h2>Scheduled outlook</h2><p className={styles.small}>{outdoor.length} activity windows · {briefing.timezone}</p></div><a className={styles.inlineLink} href="/routines">+ Plan an activity</a></div>
          {prefs && !prefs.routines.length && <p className={styles.notice}>General outlook / <a className={styles.inlineLink} href="/routines">Save an activity</a> to check your own place and schedule.</p>}
          {!outdoor.length && <p className={styles.empty}>No upcoming activity windows. Check your saved dates or plan another activity.</p>}
          <div className={styles.outlookList}>{outdoor.map((card) => <RecommendationCard card={card} timezone={briefing.timezone} key={card.id} />)}</div>
        </section>
        <details className={styles.sourceIndex}><summary>Forecast library <span>{briefing.forecasts.length} places · sources and hourly trends</span></summary><p className={styles.small}>Modeled forecasts / separate from AirNow and USGS observations. Briefing assembled {forecastTime(briefing.generated_at, briefing.timezone)}.</p>
          {!briefing.forecasts.length && <p className={styles.empty}>Forecast snapshots are unavailable.</p>}
          <div className={styles.outlookList}>{briefing.forecasts.map((forecast) => {
            const freshness = forecastFreshness(forecast.retrieved_at);
            return <article className={styles.card} key={forecast.location.id}>
              <h3>{forecast.location.name}</h3>
              <div className={styles.meta}><span className={`${styles.badge} ${freshness !== "Retrieved within 1 hour" ? styles.warn : ""}`}>{freshness}</span>{Object.entries(forecast.source_status).map(([key, value]) => <span className={styles.badge} key={key}>{key}: {value}</span>)}</div>
              <p className={styles.source}>{forecast.attribution} · retrieved {forecastTime(forecast.retrieved_at, briefing.timezone)} · {forecast.hours.length} forecast hours.</p>
              {forecast.hours.some((hour) => hour.data_quality_notes?.length) && <p className={styles.notice}>Some forecast hours need a data-quality review. Expand the trends to see the source notes and valid times.</p>}
              <details className={styles.forecastDetails}><summary>View hourly forecast trends</summary>
                {forecast.hours.filter((hour) => hour.data_quality_notes?.length).map((hour) => <div className="forecast-quality" key={hour.time}><strong>Valid {forecastTime(hour.time, briefing.timezone)}</strong>{hour.data_quality_notes?.map((note) => <p key={note}>{note}</p>)}</div>)}
                <ForecastTrends forecast={forecast} timezone={briefing.timezone} />
              </details>
              <a className={styles.inlineLink} href="https://open-meteo.com/en/docs" target="_blank" rel="noreferrer">Open weather forecast source ↗</a>{" · "}{forecast.source_url && <a className={styles.inlineLink} href={forecast.source_url} target="_blank" rel="noreferrer">Open air-quality forecast source ↗</a>}
            </article>;
          })}</div>
        </details>
        {supporting.length > 0 && <details className={styles.sourceIndex}><summary>Observed and grid context <span>{supporting.length} reports</span></summary><div className={styles.outlookList}>{supporting.map((card) => <RecommendationCard card={card} timezone={briefing.timezone} key={card.id} />)}</div></details>}
      </>}
    </div>
  </FeatureFrame>;
}
