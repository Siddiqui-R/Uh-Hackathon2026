"use client";
import { useEffect, useState } from "react";

export default function DemoBanner() {
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    void fetch("/api/session", { cache: "no-store" }).then((response) => response.ok ? response.json() : null)
      .then((session: { mode?: string } | null) => setDemo(session?.mode === "demo")).catch(() => {});
  }, []);
  return demo ? <div className="demo-banner">Browser demo · Sample places and activities. Activity outlooks use live modeled forecasts when available; other conditions are illustrative. Changes stay in this browser for up to seven days or until you exit. <a href="/signup">Create an account</a> for your own plan.</div> : null;
}
