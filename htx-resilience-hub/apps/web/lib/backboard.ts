import "server-only";
import { requireEnv } from "./env";
import type { UserPrefs } from "./types";

export async function getUserMemory(userId: string): Promise<UserPrefs | null> {
  // TODO: Fetch home/work coordinates and alert thresholds from Backboard for this user.
  requireEnv("BACKBOARD_API_KEY");
  void userId;
  throw new Error("Backboard getUserMemory integration is not implemented.");
}

export async function setUserMemory(userId: string, prefs: UserPrefs): Promise<void> {
  // TODO: Persist home/work coordinates and alert thresholds to Backboard for this user.
  requireEnv("BACKBOARD_API_KEY");
  void userId;
  void prefs;
  throw new Error("Backboard setUserMemory integration is not implemented.");
}
