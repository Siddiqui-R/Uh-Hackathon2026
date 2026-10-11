export function localTime(value: string, zone = "America/Chicago"): string {
  return new Date(value).toLocaleTimeString("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" });
}
