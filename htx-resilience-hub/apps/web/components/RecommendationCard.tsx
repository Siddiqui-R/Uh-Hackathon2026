import { localTime } from "@/lib/format";
import type { Recommendation } from "@/lib/types";

export default function RecommendationCard({ card, timezone }: { card: Recommendation; timezone: string }) {
  return <article className="recommendation">
    <div className="recommendation-heading"><strong>{card.title}</strong><span className="tag">{card.demo ? "DEMO" : card.status}</span></div>
    <p className="tiny">{card.location} · {localTime(card.time, timezone)}</p><p>{card.reason}</p>
    {card.alternative_time && <p className="alternative">Consider {localTime(card.alternative_time, timezone)} instead. Check conditions again before heading out.</p>}
    <div className="action-links">{card.suggestions.map((suggestion) => <a key={suggestion.title} href={suggestion.source_url} target="_blank" rel="noreferrer">{suggestion.title} ↗</a>)}</div>
  </article>;
}
