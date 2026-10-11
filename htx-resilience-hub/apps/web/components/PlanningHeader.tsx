import type { UserPrefs } from "@/lib/types";
import styles from "./planning.module.css";

export type PlanningStep = "places" | "activities" | "outlook";
export const planningSteps = [
  { key: "places", href: "/places", label: "Places", cue: "Where", description: "Save the Houston places your plans start from." },
  { key: "activities", href: "/routines", label: "Activities", cue: "When", description: "Choose a place, a time, and something to do." },
  { key: "outlook", href: "/recommendations", label: "Outlook", cue: "Conditions", description: "Check the forecast for your scheduled activities." },
] as const;

export function planningStepFor(path: string): PlanningStep | undefined {
  return planningSteps.find((step) => step.href === path)?.key;
}

export default function PlanningHeader({ step, prefs }: { step: PlanningStep; prefs?: UserPrefs | null }) {
  const current = planningSteps.find((item) => item.key === step)!;
  return <section className={styles.desk} aria-label="Houston planning desk">
    <div className={styles.heading}><div><p className="section-label">HOUSTON / PLANNING DESK</p><h1>{current.label}</h1><p>{current.description}</p></div>
      <span className={styles.registration} aria-hidden>⌖<span>{prefs?.timezone ?? "America/Chicago"}</span></span>
    </div>
    <nav className={styles.route} aria-label="Planning steps"><ol>{planningSteps.map((item, index) => <li key={item.key}>
      <a href={item.href} aria-current={item.key === step ? "step" : undefined}>
        <span className={styles.number} aria-hidden>0{index + 1}</span><span><strong>{item.label}</strong><small>{item.cue}{prefs && item.key === "places" ? ` · ${prefs.locations.length} saved` : prefs && item.key === "activities" ? ` · ${prefs.routines.length} planned` : ""}</small></span>
        <span className={styles.arrow} aria-hidden>↗</span>
      </a>
    </li>)}</ol></nav>
  </section>;
}
