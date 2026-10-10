import "server-only";
import { backendUrl } from "./backend";
import type { UserPrefs } from "./types";

// Backboard synchronization and per-user assistant ownership live in the FastAPI provider layer.
export async function getUserMemory(userId: string): Promise<UserPrefs | null> {
  const response = await fetch(backendUrl("/api/prefs?user_id=" + encodeURIComponent(userId)), {
    headers: { "x-internal-token": process.env.INTERNAL_API_TOKEN || "" }, cache: "no-store",
  });
  if (!response.ok) throw new Error("Preference service unavailable");
  const result = await response.json() as { preferences: UserPrefs };
  return result.preferences;
}
export async function setUserMemory(userId: string, prefs: UserPrefs): Promise<void> {
  const response = await fetch(backendUrl("/api/prefs"), {
    method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": process.env.INTERNAL_API_TOKEN || "" },
    body: JSON.stringify({ ...prefs, user_id: userId }),
  });
  if (!response.ok) throw new Error("Preference service unavailable");
}
