import "server-only";
import { cookies } from "next/headers";
import { backendUrl } from "./backend";

export const ACCOUNT_COOKIE = "noach_account";
export interface Identity {
  userId: string;
  mode: "account" | "demo";
  token?: string;
  email?: string;
  displayName?: string;
}

export type AccountSession =
  | { status: "valid"; account: Identity & { mode: "account" | "demo"; token: string } }
  | { status: "missing" | "invalid" | "unavailable" };

export async function accountSession(): Promise<AccountSession> {
  const token = cookies().get(ACCOUNT_COOKIE)?.value;
  if (!token) {
    if (process.env.NOACH_DEMO_MODE === "true" || process.env.NOACH_DEMO_STORAGE === "memory") {
      return { status: "valid", account: {
        userId: "demo_guest", mode: "demo", token: "",
        email: "demo@houston.select", displayName: "Houston Explorer (Demo)",
      } };
    }
    return { status: "missing" };
  }
  try {
    const response = await fetch(backendUrl("/api/auth/session"), {
      headers: { "x-internal-token": process.env.INTERNAL_API_TOKEN ?? "", "x-account-session": token },
      cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401) return { status: "invalid" };
    if (!response.ok) return { status: "unavailable" };
    const body = await response.json() as { user: { user_id: string; email: string; display_name: string } };
    if (!body.user?.user_id?.startsWith("acct:")) return { status: "invalid" };
    return { status: "valid", account: { userId: body.user.user_id, mode: "account", token, email: body.user.email, displayName: body.user.display_name } };
  } catch { return { status: "unavailable" }; }
}

export function setAccountCookie(token: string): void {
  cookies().set(ACCOUNT_COOKIE, token, {
    httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production",
    path: "/", maxAge: 30 * 24 * 60 * 60,
  });
}

export function clearAccountCookie(): void {
  cookies().delete(ACCOUNT_COOKIE);
}
