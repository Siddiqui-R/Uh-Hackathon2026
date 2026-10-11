import type { UserPrefs } from "@/lib/types";
import { planningSteps } from "@/components/PlanningHeader";

// Overview entry point for the Places → Activities → Outlook flow. Counts come only from saved preferences.
export default function PlanningJourney({ prefs }: { prefs?: UserPrefs | null }) {
  const count = (key: string) => !prefs ? null : key === "places" ? `${prefs.locations.length} saved` : key === "activities" ? `${prefs.routines.length} planned` : null;
  const done = (key: string) => Boolean(prefs && (key === "places" ? prefs.locations.length : key === "activities" ? prefs.routines.length : 0));
  return <nav className="journey" aria-label="Plan your day">
    <ol className="journey-steps">{planningSteps.map((step, index) => <li key={step.key}>
      <a className={`journey-step${done(step.key) ? " is-done" : ""}`} href={step.href}>
        <span className="journey-number" aria-hidden>{done(step.key) ? "✓" : `0${index + 1}`}</span>
        <span className="journey-copy"><span className="journey-cue">{step.cue}</span><strong>{step.label} <span className="journey-arrow" aria-hidden>↗</span></strong>
          <span className="journey-description">{step.description}</span>{count(step.key) && <span className="journey-count">{count(step.key)}</span>}</span>
      </a></li>)}</ol>
    <a className="journey-assistant" href="/assistant"><span className="journey-number" aria-hidden>?</span>
      <span className="journey-copy"><span className="journey-cue">Questions</span><strong>Ask the assistant <span className="journey-arrow" aria-hidden>↗</span></strong>
        <span className="journey-description">Get grounded guidance for your plans.</span></span></a>
  </nav>;
}
