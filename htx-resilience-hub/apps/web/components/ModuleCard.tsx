import type { HazardSummary, Severity } from "@/lib/types";

const severityClasses: Record<Severity, string> = {
  unknown: "bg-slate-100 text-slate-600", low: "bg-green-100 text-green-800",
  moderate: "bg-yellow-100 text-yellow-800", high: "bg-orange-100 text-orange-800",
  critical: "bg-red-100 text-red-800",
};
const titles = { flood: "Flood conditions", grid: "Power grid stress", air: "Air quality" };

export default function ModuleCard({ summary }: { summary: HazardSummary }) {
  // TODO: Plot actual reading history as a sparkline and show metric-specific severity thresholds.
  return <article className="rounded-2xl border border-slate-200 bg-white p-5">
    <div className="flex items-center justify-between gap-3">
      <h2 className="font-semibold">{titles[summary.hazard]}</h2>
      <span className={`rounded-full px-2 py-1 text-xs ${severityClasses[summary.severity]}`}>{summary.severity}</span>
    </div>
    <p className="mt-5 text-2xl font-semibold">{summary.latest ? `${summary.latest.value} ${summary.latest.unit}` : "Awaiting readings"}</p>
    <p className="mt-1 text-xs text-slate-500">{summary.latest ? `${summary.latest.metric} ? ${summary.latest.station_id}` : "Data source integration pending"}</p>
    <div className="mt-5 flex h-12 items-center justify-center rounded bg-slate-50 text-xs text-slate-400" role="img" aria-label="Sparkline placeholder">Reading history placeholder</div>
  </article>;
}
