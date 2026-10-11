"use client";

import { useEffect, useState } from "react";
import ModuleCard from "@/components/ModuleCard";

interface Overview {
  retrievedAt: string | null;
  feelsLikeF: number | null;
  usAqi: number | null;
  gauge: { valueFt: number; station: string; observedAt: string; mode: string } | null;
}

function timestamp(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(value));
}

export default function PublicConditions() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function load() {
      try {
        const response = await fetch("/api/public/overview", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Current conditions could not be reached.");
        const data = await response.json() as Overview;
        if (active) { setOverview(data); setError(""); }
      } catch {
        if (active) { setOverview(null); setError("Current conditions could not be reached. Please try again shortly."); }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [attempt]);

  const gauge = overview?.gauge;
  const simulated = gauge?.mode === "demo";
  const stale = gauge && !simulated && Date.now() - Date.parse(gauge.observedAt) > 60 * 60 * 1000;
  const retrieved = timestamp(overview?.retrievedAt ?? null);

  return <>
    {error && <div className="notice" role="alert">{error} <button className="quiet" onClick={() => { setLoading(true); setAttempt((value) => value + 1); }}>Retry</button></div>}
    <div className="module-grid" aria-live="polite">
      <ModuleCard title="Feels like" value={loading ? "Loading…" : overview?.feelsLikeF != null ? `${Math.round(overview.feelsLikeF)}°F` : "Unavailable"}
        status={loading ? "Loading" : overview?.feelsLikeF != null ? "Modeled" : "Unavailable"}
        caption={loading ? "Checking the Houston forecast" : overview?.feelsLikeF != null ? `Open-Meteo modeled current conditions · UH area · retrieved ${retrieved}` : "Open-Meteo weather data unavailable"} />
      <ModuleCard title="Air quality" value={loading ? "Loading…" : overview?.usAqi != null ? `${Math.round(overview.usAqi)} US AQI` : "Unavailable"}
        status={loading ? "Loading" : overview?.usAqi != null ? "Modeled" : "Unavailable"} accent="orange"
        caption={loading ? "Checking modeled air quality" : overview?.usAqi != null ? `CAMS / Open-Meteo modeled air quality · UH area · retrieved ${retrieved}` : "Modeled air-quality data unavailable"} />
      <ModuleCard title="Bayou gauge" value={loading ? "Loading…" : gauge ? `${gauge.valueFt.toFixed(2)} ft` : "Unavailable"}
        status={loading ? "Loading" : !gauge ? "Unavailable" : simulated ? "Simulated" : stale ? "Stale" : "Observed"}
        caption={loading ? "Checking nearby USGS observations" : gauge ? `${simulated ? "Simulated reading" : "USGS observation"} · ${gauge.station} · ${timestamp(gauge.observedAt)}${stale ? " · older than 1 hour" : ""}` : "No bayou gauge reading available"} />
    </div>
  </>;
}
