const featurePaths = new Set(["/", "/places", "/routines", "/recommendations", "/monitor", "/assistant", "/settings"]);

/** Accept only in-app feature destinations; never redirect to an external origin or auth page. */
export function safeReturnTo(candidate: string | undefined): string {
  if (!candidate || candidate.length > 1000 || !candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) return "/";
  try {
    const url = new URL(candidate, "https://noach.local");
    if (url.origin !== "https://noach.local" || !featurePaths.has(url.pathname)) return "/";
    return url.pathname + url.search;
  } catch { return "/"; }
}
