import type { ReactNode } from "react";
import SignOutButton from "@/components/SignOutButton";
import SiteNavigation from "@/components/SiteNavigation";
import PlanningHeader, { planningStepFor } from "@/components/PlanningHeader";
import type { UserPrefs } from "@/lib/types";
import styles from "./features.module.css";

export default function FeatureFrame({ path, eyebrow, title, description, children, planningPrefs }: {
  path: string; eyebrow: string; title: string; description: string; children: ReactNode; planningPrefs?: UserPrefs | null;
}) {
  const step = planningStepFor(path);
  return <div className={`app-shell ${styles.shell}`}>
    <SiteNavigation path={path} account={<SignOutButton />} />
    <main id="main-content" tabIndex={-1}>{step ? <PlanningHeader step={step} prefs={planningPrefs} /> : <div className={styles.intro}><p className="section-label">{eyebrow}</p><h1>{title}</h1><p className="muted">{description}</p></div>}{children}</main>
    <footer><a className="wordmark" href="/">Noach</a><p>Local awareness. Everyday resilience.</p></footer>
  </div>;
}
