import type { Recommendation } from "./types";
import { forecastFreshness, forecastNumber } from "./forecastPresentation";

export function outlookStale(card: Recommendation): boolean {
  const retrieved = card.forecast_retrieved_at ? Date.parse(card.forecast_retrieved_at) : NaN;
  return card.forecast_status === "stale" || (Number.isFinite(retrieved) && Date.now() - retrieved > 3_600_000);
}

export function outlookFreshnessUnknown(card: Recommendation): boolean {
  return forecastFreshness(card.forecast_retrieved_at) === "Freshness unverified";
}

export function outlookQuality(card: Recommendation): { forecast_hour: string; note: string }[] {
  const notes = [...(card.data_quality ?? [])];
  for (const values of [card.original_conditions, card.alternative_conditions]) {
    if (!values) continue;
    for (const note of values.data_quality_notes ?? []) notes.push({ forecast_hour: values.forecast_hour, note });
    // Protect older API responses which do not carry provider quality flags yet.
    for (const [label, value, low, high] of [["Temperature", values.temperature_f, -10, 125], ["Feels like", values.feels_like_f, -20, 160]] as const) {
      if (value != null && (!Number.isFinite(value) || value < low || value > high)) notes.push({ forecast_hour: values.forecast_hour, note: `${label} source value ${value}°F is outside Noach's broad Houston review range. Verify the source.` });
    }
    const rain = values.precipitation_probability;
    if (rain != null && (!Number.isFinite(rain) || rain < 0 || rain > 100)) notes.push({ forecast_hour: values.forecast_hour, note: `Source rain chance ${rain}% needs verification.` });
    for (const [label, value] of [["US AQI", values.us_aqi], ["PM2.5", values.pm25_ug_m3]] as const) {
      if (value != null && (!Number.isFinite(value) || value < 0)) notes.push({ forecast_hour: values.forecast_hour, note: `Source ${label} value ${value} needs verification.` });
    }
  }
  return notes.filter((item, index) => notes.findIndex((other) => other.forecast_hour === item.forecast_hour && other.note === item.note) === index);
}

export function outlookStatus(card: Recommendation): string {
  if (outlookQuality(card).length) return "Review data";
  if (outlookStale(card)) return "Stale forecast";
  if (card.forecast_status && card.forecast_status !== "current") return card.forecast_status === "stale" ? "Stale forecast" : "Forecast unavailable";
  if (outlookFreshnessUnknown(card)) return "Freshness unverified";
  if (card.status === "consider alternatives") return "Compare times";
  if (card.status === "review conditions") return "Review plan";
  return card.status;
}

export function outlookSummary(card: Recommendation): string {
  if (outlookQuality(card).length) return "Provider values need verification.";
  if (outlookStale(card)) return "A recent forecast is needed for this plan.";
  if (card.forecast_status === "missing" || card.forecast_status === "incomplete") return "Not enough forecast coverage for this activity.";
  if (outlookFreshnessUnknown(card)) return "Forecast retrieval time needs verification.";
  const exceeded = card.threshold_checks?.filter((check) => check.exceeded) ?? [];
  if (exceeded.length) return exceeded.map((check) => `${check.metric === "us_aqi" ? "AQI" : "Feels-like"} peak ${forecastNumber(check.value, check.metric === "us_aqi" ? "" : "°F")} ${check.comparison === ">=" ? "≥" : ">"} your ${forecastNumber(check.threshold, check.metric === "us_aqi" ? "" : "°F")} limit`).join(" · ");
  if (card.threshold_checks?.length) return "Available heat / AQI values are within your limits.";
  return card.status === "consider alternatives" ? "A saved heat or AQI threshold is exceeded." : "Review available conditions before going.";
}
