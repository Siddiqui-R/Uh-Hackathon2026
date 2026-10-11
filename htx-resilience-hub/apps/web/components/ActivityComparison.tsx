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
    </dl>
  </div>;
}

export default function ActivityComparison({ card, timezone }: { card: Recommendation; timezone: string }) {
  if (!card.original_conditions) {
    return <div className="comparison-unavailable">A time comparison needs a current forecast for this activity. Check conditions again before heading out.</div>;
  }

  const hasAlternative = Boolean(card.alternative_time && card.alternative_conditions);
  return <div className="activity-comparison">
    <div className="comparison-heading"><span>ACTIVITY TIME COMPARISON</span><span>{hasAlternative ? "Within the next 12 hours" : "Forecast review"}</span></div>
    <div className="comparison-grid">
      <ConditionCard label="YOUR PLANNED TIME" time={card.time} values={card.original_conditions} timezone={timezone} />
      {hasAlternative && card.alternative_time ? <ConditionCard label="BELOW YOUR THRESHOLDS" time={card.alternative_time} values={card.alternative_conditions} timezone={timezone} recommended /> :
        <div className="comparison-card comparison-empty"><span>{card.status === "consider alternatives" ? "NO SUPPORTED ALTERNATIVE FOUND" : "NO TIME CHANGE SUGGESTED"}</span><p>{card.status === "consider alternatives" ? "No forecast hour in the next 12 hours has the required readings below your selected thresholds." : "The forecast values shown for your planned time do not exceed your selected thresholds."}</p></div>}
    </div>
    <p className="comparison-source">{card.demo ? "Illustrative demo forecast" : "Modeled forecast"}{card.forecast_retrieved_at ? ` · updated ${dateTime(card.forecast_retrieved_at, timezone)}` : ""} · {card.forecast_attribution ?? "Check an official source before heading out."} Forecast values do not establish personal safety.</p>
  </div>;
}
