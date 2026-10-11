"use client";
import { useEffect, useState } from "react";

export default function AccountPanel({ viewer, onUpdate, onLogout }: {
  viewer: { mode: "account" | "demo"; email?: string; display_name?: string };
  onUpdate: (name: string) => void; onLogout: () => Promise<void>;
}) {
  const [name, setName] = useState(viewer.display_name ?? "");
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => setName(viewer.display_name ?? ""), [viewer.display_name]);
  if (viewer.mode === "demo") return <section className="panel account-panel">
    <p className="section-label">ACCOUNT</p><h2>Try the demo, or save across devices.</h2>
    <p className="muted">You are using a private browser demo. Your places and plans stay with this browser; sign in to keep them with an account.</p>
    <div className="hero-actions"><a className="primary" href="/signup">Create account</a><a className="secondary" href="/login">Sign in</a></div>
  </section>;
  async function saveProfile() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/auth/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ display_name: name }) });
      const body = await response.json() as { error?: string; user?: { display_name: string } };
      if (!response.ok || !body.user) throw new Error(body.error ?? "Profile update failed");
      onUpdate(body.user.display_name); setMessage("Profile updated.");
    } catch (error: unknown) { setMessage(error instanceof Error ? error.message : "Profile update failed"); }
    finally { setBusy(false); }
  }
  return <section className="panel account-panel">
    <p className="section-label">YOUR ACCOUNT</p><h2>Profile</h2>
    <p className="muted">Signed in as {viewer.email}</p>
    <form onSubmit={(event) => { event.preventDefault(); void saveProfile(); }}>
      <label>Display name<input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <button className="primary" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button>
    </form>
    <p role="status" className="tiny">{message}</p>
    <button className="secondary" onClick={() => void onLogout()}>Log out</button>
  </section>;
}
