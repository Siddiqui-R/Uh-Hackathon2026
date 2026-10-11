"use client";
import { useState } from "react";
import { safeReturnTo } from "@/lib/returnTo";

type Flow = "signup" | "login" | "request-reset" | "reset";
const titles: Record<Flow, string> = {
  signup: "Create your account", login: "Welcome back", "request-reset": "Reset your password", reset: "Choose a new password",
};
export default function AuthForm({ flow, token = "", nextPath = "/", sessionWarning }: { flow: Flow; token?: string; nextPath?: string; sessionWarning?: string }) {
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [name, setName] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [resetLink, setResetLink] = useState("");
  const destination = safeReturnTo(nextPath);
  const nextQuery = destination === "/" ? "" : `?next=${encodeURIComponent(destination)}`;
  async function submit() {
    setBusy(true); setMessage(""); setResetLink("");
    const body = flow === "reset" ? { token, password } : flow === "request-reset" ? { email } : flow === "signup" ? { email, password, display_name: name } : { email, password };
    try {
      const response = await fetch("/api/auth/" + flow, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string; message?: string; dev_reset_url?: string };
      if (!response.ok) throw new Error(result.error ?? "Please try again.");
      if (flow === "login" || flow === "signup") { window.location.assign(destination); return; }
      setMessage(result.message ?? "Done.");
      if (result.dev_reset_url) setResetLink(result.dev_reset_url);
    } catch (error: unknown) { setMessage(error instanceof Error ? error.message : "Please try again."); }
    finally { setBusy(false); }
  }
  return <div className="app-shell auth-shell"><header className="site-header"><a className="wordmark" href="/"><span className="brand-icon">✳</span> Noach</a><a className="secondary" href={flow === "signup" ? `/login${nextQuery}` : `/signup${nextQuery}`}>{flow === "signup" ? "Sign in" : "Create account"}</a></header>
    <main className="auth-layout"><section className="panel auth-card"><p className="section-label">YOUR HOUSTON PLAN</p><h1>{titles[flow]}</h1>
      {sessionWarning && <p className="notice" role="status">{sessionWarning}</p>}
      {flow === "reset" && !token ? <p className="notice">This reset link is missing a token. Request a new link.</p> : <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        {flow === "signup" && <label>Display name<input required maxLength={80} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label>}
        {flow !== "reset" && <label>Email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>}
        {flow !== "request-reset" && <label>{flow === "reset" ? "New password" : "Password"}<input required type="password" minLength={12} maxLength={128} autoComplete={flow === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></label>}
        {flow !== "request-reset" && <p className="tiny">Use at least 12 characters.</p>}
        <button className="primary" disabled={busy}>{busy ? "Please wait…" : flow === "signup" ? "Create account" : flow === "login" ? "Sign in" : flow === "reset" ? "Update password" : "Send reset link"}</button>
      </form>}
      {message && <p role="status" className="notice">{message}</p>}
      {resetLink && <p className="tiny">Local development only: <a href={resetLink}>Open your reset link</a></p>}
      <div className="auth-links">{flow !== "login" && <a href={`/login${nextQuery}`}>Sign in</a>}{flow !== "signup" && <a href={`/signup${nextQuery}`}>Create account</a>}{flow !== "request-reset" && <a href="/forgot-password">Forgot password?</a>}</div>
    </section></main></div>;
}
