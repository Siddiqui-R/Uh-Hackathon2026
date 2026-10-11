"use client";
import { useEffect, useRef, useState } from "react";
import { safeReturnTo } from "@/lib/returnTo";
import ActivityOnboardingModal from "@/components/ActivityOnboardingModal";

type Flow = "signup" | "login" | "request-reset" | "reset";
const titles: Record<Flow, string> = {
  signup: "Create your account", login: "Welcome back", "request-reset": "Reset your password", reset: "Choose a new password",
};
export default function AuthForm({ flow, token = "", nextPath = "/", sessionWarning }: { flow: Flow; token?: string; nextPath?: string; sessionWarning?: string }) {
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [name, setName] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [resetLink, setResetLink] = useState("");
  const [signupState, setSignupState] = useState<"form" | "onboarding" | "ready" | "signin-needed">("form");
  const [activitySaved, setActivitySaved] = useState(false);
  const background = useRef<HTMLDivElement>(null);
  const readyAction = useRef<HTMLAnchorElement>(null);
  const destination = safeReturnTo(nextPath);
  const nextQuery = destination === "/" ? "" : `?next=${encodeURIComponent(destination)}`;
  useEffect(() => { if (background.current) background.current.inert = signupState === "onboarding"; }, [signupState]);
  useEffect(() => { if (signupState === "ready") readyAction.current?.focus(); }, [signupState]);
  async function submit() {
    setBusy(true); setMessage(""); setResetLink("");
    const body = flow === "reset" ? { token, password } : flow === "request-reset" ? { email } : flow === "signup" ? { email, password, display_name: name } : { email, password };
    try {
      const response = await fetch("/api/auth/" + flow, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string; message?: string; dev_reset_url?: string };
      if (!response.ok) throw new Error(result.error ?? "Please try again.");
      if (flow === "signup") {
        let accountReady = false;
        try {
          const sessionResponse = await fetch("/api/session", { cache: "no-store" });
          const session = sessionResponse.ok ? await sessionResponse.json() as { mode?: string } : null;
          accountReady = session?.mode === "account";
        } catch { /* Signup succeeded, but session verification did not. */ }
        if (!accountReady) { setSignupState("signin-needed"); return; }
        setSignupState("onboarding");
        return;
      }
      if (flow === "login") { window.location.assign(destination); return; }
      setMessage(result.message ?? "Done.");
      if (result.dev_reset_url) setResetLink(result.dev_reset_url);
    } catch (error: unknown) { setMessage(error instanceof Error ? error.message : "Please try again."); }
    finally { setBusy(false); }
  }
  return <div className="app-shell auth-shell"><div ref={background}><header className="site-header"><a className="wordmark" href="/"><span className="brand-icon">✳</span> Noach</a><a className="secondary" href={signupState === "signin-needed" ? `/login${nextQuery}` : signupState !== "form" ? destination : flow === "signup" ? `/login${nextQuery}` : `/signup${nextQuery}`}>{signupState === "signin-needed" ? "Sign in" : signupState !== "form" ? "Go to Noach" : flow === "signup" ? "Sign in" : "Create account"}</a></header>
    <main className="auth-layout"><section className="panel auth-card"><p className="section-label">YOUR HOUSTON PLAN</p><h1>{signupState === "form" ? titles[flow] : signupState === "signin-needed" ? "Your account was created" : "Your account is ready"}</h1>
      {signupState === "signin-needed" ? <div role="alert"><p>We couldn’t verify your new sign-in. Your account was created; sign in to continue.</p><a className="primary" href={`/login${nextQuery}`}>Sign in ↗</a></div>
        : signupState !== "form" ? <div role="status"><p>{activitySaved ? "Your activity is saved to your new account." : "Your account is ready. Set up an activity whenever you like."}</p>
        <div className="auth-links"><a ref={readyAction} className="primary" href={activitySaved ? "/recommendations" : destination}>{activitySaved ? "View your recommendation ↗" : "Continue to Noach ↗"}</a>
          <a href="/routines">{activitySaved ? "Manage activities" : "Plan an activity later"}</a></div></div> : <>
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
      </>}
    </section></main></div>
    {signupState === "onboarding" && <ActivityOnboardingModal onClose={() => setSignupState("ready")} onSaved={() => { setActivitySaved(true); setSignupState("ready"); }} onSkip={() => window.location.assign(destination)} />}
  </div>;
}
