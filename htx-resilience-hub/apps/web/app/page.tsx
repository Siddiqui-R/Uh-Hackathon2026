"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import ModuleCard from "@/components/ModuleCard";
import type { HazardSummary } from "@/lib/types";

const HazardMap = dynamic(() => import("@/components/HazardMap"), {
  ssr: false, loading: () => <div className="h-[500px] animate-pulse rounded-2xl bg-slate-200" aria-label="Loading map" />,
});
const initialHazards: HazardSummary[] = [
  { hazard: "flood", severity: "unknown", latest: null, history: [] },
  { hazard: "grid", severity: "unknown", latest: null, history: [] },
  { hazard: "air", severity: "unknown", latest: null, history: [] },
];

export default function Dashboard() {
  const [hazards, setHazards] = useState(initialHazards);
  const [status, setStatus] = useState("Connecting to alert stream?");
  const [error, setError] = useState<string | null>(null);
  // TODO: Refresh hazard readings on incoming alerts and add the Gemini question/voice alert UI.
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/hazards", { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Hazard API unavailable. Start the backend and configure API_BASE_URL.");
      setHazards(await response.json() as HazardSummary[]);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to load hazards.");
    });
    const events = new EventSource("/api/alerts");
    events.addEventListener("ready", () => setStatus("Alert stream connected ? scaffold mode"));
    events.onerror = () => setStatus("Alert stream disconnected ? retrying");
    return () => { controller.abort(); events.close(); };
  }, []);

  return <main className="mx-auto max-w-7xl space-y-6 p-6 md:p-10">
    <header className="space-y-2">
      <p className="text-sm font-medium uppercase tracking-widest text-teal-700">Houston environmental resilience</p>
      <h1 className="text-3xl font-bold md:text-4xl">HTX Resilience Hub</h1>
      <p className="text-slate-600">Floods, power grid stress, and air quality in one place.</p>
      <p className="text-xs text-slate-500" role="status">{status}</p>
    </header>
    <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Scaffold preview ? live feeds and hazard overlays are not connected.</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <HazardMap />
    <section aria-label="Hazard modules" className="grid gap-4 md:grid-cols-3">
      {hazards.map((summary) => <ModuleCard key={summary.hazard} summary={summary} />)}
    </section>
  </main>;
}
