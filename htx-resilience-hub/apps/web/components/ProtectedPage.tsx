import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { accountSession } from "@/lib/account";
import { safeReturnTo } from "@/lib/returnTo";

type Search = Record<string, string | string[] | undefined>;
export default async function ProtectedPage({ path, searchParams, children }: { path: string; searchParams?: Search; children: ReactNode }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (Array.isArray(value)) value.forEach((item) => query.append(key, item));
    else if (value !== undefined) query.append(key, value);
  }
  const requested = safeReturnTo(path + (query.size ? `?${query}` : ""));
  const session = await accountSession();
  if (session.status === "missing" || session.status === "invalid") redirect(`/login?next=${encodeURIComponent(requested)}`);
  if (session.status === "unavailable") return <div className="app-shell auth-shell"><header className="site-header"><a className="wordmark" href="/">✳ Noach</a></header>
    <main className="auth-layout"><section className="panel auth-card" role="alert"><p className="section-label">SESSION CHECK</p><h1>We couldn’t check your sign-in</h1><p className="muted">The account service is temporarily unavailable. Your session has not been changed.</p><div className="auth-links"><a href={requested}>Try again</a><a href="/login">Go to login</a></div></section></main></div>;
  return <>{children}</>;
}
