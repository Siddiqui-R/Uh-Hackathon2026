import type { ActivityConditions, Recommendation } from "@/lib/types";

function dateTime(value: string, zone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(value));
}

function number(value: number | null | undefined, suffix = ""): string {
  return value == null ? "Unavailable" : `${Math.round(value)}${suffix}`;
}

function ConditionCard({ label, time, values, timezone, recommended }: {
  label: string; time: string; values: ActivityConditions | null | undefined; timezone: string; recommended?: boolean;
}) {
  return <div className={`comparison-card${recommended ? " comparison-card-recommended" : ""}`}>
    <div className="comparison-card-heading"><span>{label}</span>{recommended && <span className="comparison-marker">SUGGESTED</span>}</div>
    <strong className="comparison-time">{dateTime(time, timezone)}</strong>
    <dl className="comparison-metrics">
      <div><dt>Temperature</dt><dd>{number(values?.temperature_f, "°F")}</dd></div>
      <div><dt>Feels like</dt><dd>{number(values?.feels_like_f, "°F")}</dd></div>
      <div><dt>Modeled US AQI</dt><dd>{number(values?.us_aqi)}</dd></div>
      <div><dt>Rain chance</dt><dd>{number(values?.precipitation_probability, "%")}</dd></div>
      <div><dt>Modeled PM2.5</dt><dd>{number(values?.pm25_ug_m3, " µg/m³")}</dd></div>
    </dl>
    <p className="comparison-source">Forecast valid {values?.forecast_hour ? dateTime(values.forecast_hour, timezone) : "time unavailable"}. Missing metrics are unavailable.</p>
  </div>;
}

export default function ActivityComparison({ card, timezone }: { card: Recommendation; timezone: string }) {
  const detail = card as Recommendation & { duration_minutes?: number | null; forecast_status?: string };
  const duration = detail.duration_minutes;
  if (!card.original_conditions) {
    return <div className="comparison-unavailable">Forecast {detail.forecast_status ?? "data"} — a time comparison needs a current, complete forecast for this activity. {card.forecast_retrieved_at ? `Last forecast retrieved ${dateTime(card.forecast_retrieved_at, timezone)}. ` : "No forecast snapshot is available. "}{card.forecast_attribution ?? "Check an official source before heading out."}</div>;
  }

  const hasAlternative = Boolean(card.alternative_time && card.alternative_conditions);
  return <div className="activity-comparison">
    <div className="comparison-heading"><span>ACTIVITY TIME COMPARISON</span><span>{hasAlternative ? "Within the next 12 hours" : "Forecast review"}</span></div>
    <div className="comparison-grid">
      <ConditionCard label="YOUR PLANNED TIME" time={card.time} values={card.original_conditions} timezone={timezone} />
      {hasAlternative && card.alternative_time ? <ConditionCard label="POSSIBLE ALTERNATIVE" time={card.alternative_time} values={card.alternative_conditions} timezone={timezone} recommended /> :
        <div className="comparison-card comparison-empty"><span>{card.status === "consider alternatives" ? "NO SUPPORTED ALTERNATIVE FOUND" : "NO TIME CHANGE SUGGESTED"}</span><p>{card.status === "consider alternatives" ? "No forecast hour in the next 12 hours has the required readings below your selected thresholds." : "The forecast values shown for your planned time do not exceed your selected thresholds."}</p></div>}
    </div>
    <p className="comparison-source">{duration ? `Card values show the start hour; the threshold check covers all ${duration} planned minutes. ` : ""}{card.demo ? "Illustrative demo forecast" : "Modeled weather and air-quality forecast"}{card.forecast_retrieved_at ? ` · retrieved ${dateTime(card.forecast_retrieved_at, timezone)}` : " · retrieval time unavailable"} · {card.forecast_attribution ?? "Source unavailable; check an official source."} The alternative is screened against your selected thresholds and available rain chance. Forecasts do not establish personal safety or quantify health benefit.</p>
  </div>;
}
