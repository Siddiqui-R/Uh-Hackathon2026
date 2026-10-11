import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import type { UserPrefs } from "./types";

export const DEMO_COOKIE = "noach_demo";
const key = process.env.INTERNAL_API_TOKEN || process.env.DEMO_SESSION_SECRET || "local-noach-demo-only";
const maxAge = 7 * 24 * 60 * 60;

function sign(value: string) { return createHmac("sha256", key).update(value).digest("base64url"); }

export function readDemoPreferences(): UserPrefs | null {
  const raw = cookies().get(DEMO_COOKIE)?.value;
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = raw.slice(0, dot), signature = raw.slice(dot + 1);
  const expected = sign(payload);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const value = JSON.parse(inflateRawSync(Buffer.from(payload, "base64url"), { maxOutputLength: 20_000 }).toString()) as UserPrefs;
    return value.user_id === "demo_browser" && Array.isArray(value.locations) && Array.isArray(value.routines) ? value : null;
  } catch { return null; }
}

export function setDemoPreferences(response: NextResponse, prefs: UserPrefs): boolean {
  const payload = deflateRawSync(Buffer.from(JSON.stringify(prefs))).toString("base64url");
  const value = `${payload}.${sign(payload)}`;
  if (value.length > 3800) return false;
  response.cookies.set(DEMO_COOKIE, value, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge });
  return true;
}

export function clearDemoPreferences(response: NextResponse) {
  response.cookies.delete(DEMO_COOKIE);
  response.cookies.delete("noach_demo_event");
  response.cookies.delete("noach_demo_alert_read");
}
