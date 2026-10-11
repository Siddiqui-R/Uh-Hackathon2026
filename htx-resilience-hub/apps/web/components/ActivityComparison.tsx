import type { ActivityConditions, Recommendation } from "@/lib/types";
import { forecastTime, forecastNumber, rainMessage, forecastFreshness } from "@/lib/forecastPresentation";
import { outlookQuality, outlookSummary, outlookStale, outlookFreshnessUnknown } from "@/lib/outlookPresentation";

function ConditionCard({ label, time, values, timezone, unvalidated }: {
  label: string; time: string; values: ActivityConditions; timezone: string; unvalidated?: boolean;
}) {
  return <section className={`comparison-card${unvalidated ? " comparison-unvalidated" : ""}${label === "Alternative" ? " comparison-alternative" : ""}`} aria-label={label}>
    <div className="condition-heading"><h4>{label}</h4><span>{forecastTime(time, timezone)}</span></div>
    {unvalidated && <span className="metric-review">Unvalidated source values</span>}
    <dl className="outlook-metrics">
      <div><dt>Temperature</dt><dd>{forecastNumber(values.temperature_f, "°F")}</dd></div>
      <div><dt>Feels like</dt><dd>{forecastNumber(values.feels_like_f, "°F")}</dd></div>
      <div><dt>Modeled US AQI</dt><dd>{forecastNumber(values.us_aqi, " US AQI")}</dd></div>
      <div><dt>Rain chance</dt><dd>{forecastNumber(values.precipitation_probability, "%")}</dd></div>
    </dl>
  </section>;
}

export default function ActivityComparison({ card, timezone }: { card: Recommendation; timezone: string }) {
  const quality = outlookQuality(card);
  const usable = !outlookStale(card) && !outlookFreshnessUnknown(card) && (card.forecast_status === "current" || (!card.forecast_status && Boolean(card.original_conditions)));
  const hasAlternative = Boolean(usable && !quality.length && card.alternative_time && card.alternative_conditions);
  return <div className="activity-comparison">
    <p className={`outlook-summary${quality.length ? " needs-review" : ""}`}>{outlookSummary(card)}</p>
    <div className={`comparison-grid${hasAlternative ? "" : " comparison-single"}`}>
      {card.original_conditions ? <ConditionCard label="Planned" time={card.time} values={card.original_conditions} timezone={timezone} unvalidated={Boolean(quality.length)} /> : <p className="outlook-empty">No forecast values are available for this activity’s start hour.</p>}
      {hasAlternative && card.alternative_time && card.alternative_conditions && <ConditionCard label="Alternative" time={card.alternative_time} values={card.alternative_conditions} timezone={timezone} />}
    </div>
    <div className="outlook-disclosures">
      <details><summary>Why this?</summary>
        <p>{card.reason}</p>
        {quality.length > 0 && <div className="forecast-quality" role="note"><strong>Data quality needs review</strong><ul>{quality.map((issue, index) => <li key={index}>{issue.note} Valid {forecastTime(issue.forecast_hour, timezone)}.</li>)}</ul></div>}
        {card.threshold_checks?.length ? <ul>{card.threshold_checks.map((check) => <li key={check.metric}>{check.label}: activity peak {forecastNumber(check.value, ` ${check.unit}`)}; your threshold {check.comparison} {forecastNumber(check.threshold, ` ${check.unit}`)} · {check.exceeded ? "exceeded" : "not exceeded"}.</li>)}</ul> : null}
        <p>{card.duration_minutes ? `Summary values show the start hour. Checks require forecasts across all ${card.duration_minutes} planned minutes.` : "Summary values show the start hour."}</p>
        <p>{quality.length ? "No alternative suggested while the data needs review." : !usable ? outlookFreshnessUnknown(card) && card.forecast_status === "current" ? "Forecast freshness is unverified; no comparison available yet." : `Forecast ${outlookStale(card) ? "stale" : card.forecast_status ?? "unavailable"}; no comparison available yet.` : hasAlternative ? "The alternative is within 12 hours, below triggered heat / AQI thresholds, and at most 50% forecast rain chance where available." : card.status === "consider alternatives" ? "No supported alternative was found in the next 12 hours." : "No time change suggested by available heat / AQI evidence. Review rain separately; cold-weather risk is not evaluated."}</p>
        {card.suggestions.length > 0 && <div className="action-links">{card.suggestions.map((suggestion) => <a href={suggestion.source_url} key={suggestion.title} target="_blank" rel="noreferrer">{suggestion.title} ↗</a>)}</div>}
      </details>
      <details><summary>Sources and details</summary>
        <p>{card.demo ? "Illustrative demo forecast" : "Modeled weather and air-quality forecasts; separate from AirNow and USGS observations."}</p>
        <p>Retrieved {forecastTime(card.forecast_retrieved_at, timezone)} · {forecastFreshness(card.forecast_retrieved_at)} · coverage {card.forecast_status ?? "not supplied"}</p>
        <p>{card.forecast_attribution ?? "Source attribution unavailable."}</p>
        {[{ name: "Planned", values: card.original_conditions }, ...(hasAlternative ? [{ name: "Alternative", values: card.alternative_conditions }] : [])].map(({ name, values }) => values && <div key={name} className="source-hour">
          <strong>{name} / forecast valid from {forecastTime(values.forecast_hour, timezone)} for one hour</strong>
          <p>Modeled PM2.5: {forecastNumber(values.pm25_ug_m3, " µg/m³")}. Missing metrics are unavailable.</p>
          <p>{rainMessage(values.precipitation_probability)} Missing rain data is not treated as zero.</p>
          {values.source_values && Object.entries(values.source_values).map(([metric, raw]) => <p key={metric}>Provider {metric === "temperature_2m" ? "temperature" : "feels like"}: {raw.value} {raw.unit ?? "unit unavailable"}.</p>)}
        </div>)}
        {Object.entries(card.forecast_sources ?? {}).map(([key, source]) => <p key={key}><a href={source.url} target="_blank" rel="noreferrer">{source.name} ↗</a> · retrieved {forecastTime(source.retrieved_at, timezone)}{source.latitude != null && source.longitude != null ? ` · model grid ${source.latitude.toFixed(4)}, ${source.longitude.toFixed(4)}` : ""}{key === "weather" && <> · provider units {source.provider_units.temperature_2m ?? "unavailable"} / feels like {source.provider_units.apparent_temperature ?? "unavailable"}</>}</p>)}
        {card.location_coordinates && <p>Saved place: {card.location_coordinates.lat.toFixed(4)}, {card.location_coordinates.lon.toFixed(4)}.</p>}
        <p>Forecasts do not establish personal safety or quantify health benefit.</p>
      </details>
    </div>
  </div>;
}
