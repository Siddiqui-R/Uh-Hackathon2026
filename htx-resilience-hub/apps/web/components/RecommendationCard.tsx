import ActivityComparison from "@/components/ActivityComparison";
import type { Recommendation } from "@/lib/types";
import { forecastTime } from "@/lib/forecastPresentation";
import { outlookStatus, outlookQuality } from "@/lib/outlookPresentation";

export default function RecommendationCard({ card, timezone }: { card: Recommendation; timezone: string }) {
  const outdoor = card.category === "outdoor";
  const review = outlookQuality(card).length > 0;
  return <article className={`recommendation${review ? " recommendation-review" : ""}`} id={`activity-${card.id}`}>
    <div className="recommendation-heading"><div><p className="recommendation-kind">{card.demo ? "Illustrative demo" : outdoor ? "Modeled forecast" : card.category === "commute" ? "USGS observation" : "ERCOT report"}</p><h3>{card.title}</h3></div><span className={`tag${review || card.status === "consider alternatives" ? " tag-review" : ""}`}>{outlookStatus(card)}</span></div>
    <div className="activity-meta"><span>⌖ {card.location}</span><time dateTime={card.time}>{forecastTime(card.time, timezone)}</time>{card.duration_minutes ? <span>{card.duration_minutes} min</span> : null}</div>
    {outdoor ? <ActivityComparison card={card} timezone={timezone} /> : <details className="outlook-context"><summary>Why this? / source guidance</summary><p>{card.reason}</p><div className="action-links">{card.suggestions.map((suggestion) => <a href={suggestion.source_url} key={suggestion.title} target="_blank" rel="noreferrer">{suggestion.title} ↗</a>)}</div></details>}
    {outdoor && !card.demo && <div className="outlook-card-next"><a href={card.id === "daily" ? "/routines" : `/routines?activity=${encodeURIComponent(card.id)}`}>{card.id === "daily" ? "Plan an activity" : "Edit activity"} ↗</a></div>}
  </article>;
}
