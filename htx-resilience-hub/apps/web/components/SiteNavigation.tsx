import type { ReactNode } from "react";
import styles from "./siteNavigation.module.css";

export default function SiteNavigation({ path, account, unreadCount = 0 }: {
  path: string; account: ReactNode; unreadCount?: number;
}) {
  const link = (href: string, label: string) => <a href={href} aria-current={path === href ? "page" : undefined}>
    {label}{href === "/" && unreadCount > 0 && <span className="nav-count" aria-label={`${unreadCount} unread alerts`}>{unreadCount}</span>}
  </a>;
  return <header className={styles.header}>
    <a className={styles.skip} href="#main-content">Skip to content</a>
    <a className="wordmark" href="/"><span className="brand-icon" aria-hidden>✳</span> Noach</a>
    <div className={styles.account} aria-label="Account"><span className={styles.label}>Account</span>{link("/settings", "Settings")}{account}</div>
    <nav className={styles.navigation} aria-label="Main navigation">
      <div className={styles.single}>{link("/", "Overview")}</div>
      <div className={`${styles.group} ${["/places", "/routines", "/recommendations"].includes(path) ? styles.active : ""}`} role="group" aria-label="Plan">
        <span className={styles.label}>Plan</span><div>{link("/places", "Places")}{link("/routines", "Activities")}{link("/recommendations", "Outlook")}</div>
      </div>
      <div className={`${styles.group} ${path === "/monitor" ? styles.active : ""}`} role="group" aria-label="Conditions">
        <span className={styles.label}>Conditions</span><div>{link("/monitor", "Live Monitor")}</div>
      </div>
      <div className={styles.single}>{link("/assistant", "Assistant")}</div>
    </nav>
  </header>;
}
