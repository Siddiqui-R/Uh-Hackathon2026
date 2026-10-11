export function forecastTime(value: string | null | undefined, zone = "America/Chicago"): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Time unavailable";
  return new Intl.DateTimeFormat("en-US", { timeZone: zone, month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));
}

export function forecastNumber(value: number | null | undefined, unit = ""): string {
  return typeof value !== "number" || !Number.isFinite(value) ? "Unavailable" : `${Math.round(value)}${unit}`;
}

export function forecastFreshness(value: string | null | undefined, now = Date.now()): string {
  const age = value ? now - Date.parse(value) : NaN;
  if (!Number.isFinite(age) || age < 0) return "Freshness unverified";
  return age > 3_600_000 ? "Stale · over 1 hour old" : "Retrieved within 1 hour";
}

export function rainMessage(chance: number | null | undefined): string {
  if (chance == null || !Number.isFinite(chance)) return "Rain chance unavailable. This does not mean zero chance.";
  if (chance < 0 || chance > 100) return `Source reports ${chance}% rain chance, outside the expected 0–100% range. Verify the source.`;
  if (chance === 0) return "0% forecast rain chance for this hour. This is not an observation of rainfall or cloud cover.";
  return `${Math.round(chance)}% forecast rain chance for this hour. This does not mean it is raining now.`;
}
