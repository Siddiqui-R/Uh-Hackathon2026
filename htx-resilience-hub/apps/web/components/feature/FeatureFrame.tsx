import type { ReactNode } from "react";
import SignOutButton from "@/components/SignOutButton";
import styles from "./features.module.css";

const pages = [
  ["/", "Dashboard"], ["/places", "Places"], ["/routines", "Routines"],
  ["/recommendations", "Recommendations"], ["/monitor", "Live Monitor"],
  ["/assistant", "Ask the Assistant"], ["/settings", "Settings"],
] as const;

export default function FeatureFrame({ path, eyebrow, title, description, children }: {
  path: string; eyebrow: string; title: string; description: string; children: ReactNode;
}) {
  return <div className={`app-shell ${styles.shell}`}>
    <header className="site-header"><a className="wordmark" href="/"><span className="brand-icon">✳</span> Noach</a>
      <nav aria-label="Main navigation">{pages.map(([href, label]) => <a key={href} href={href} aria-current={path === href ? "page" : undefined}>{label}</a>)}</nav><span className="account-status"><SignOutButton /></span>
    </header>
    <main><div className={styles.intro}><p className="section-label">{eyebrow}</p><h1>{title}</h1><p className="muted">{description}</p></div>{children}</main>
    <footer><a className="wordmark" href="/">Noach</a><p>Local awareness. Everyday resilience.</p></footer>
  </div>;
}
