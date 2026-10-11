"use client";
import { useState } from "react";

export default function SignOutButton() {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function signOut() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error("We couldn't sign you out. Please try again.");
      window.location.replace("/");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Sign-out unavailable."); setBusy(false); }
  }
  return <span><button className="quiet" disabled={busy} onClick={() => void signOut()}>{busy ? "Signing out…" : "Log out"}</button>{error && <span className="tiny" role="alert">{error}</span>}</span>;
}
