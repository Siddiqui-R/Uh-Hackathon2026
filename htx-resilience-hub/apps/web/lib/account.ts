import "server-only";
import { cookies } from "next/headers";
import { backendUrl } from "./backend";
import { sessionId } from "./session";

export const ACCOUNT_COOKIE = "noach_account";
export interface Identity {
  userId: string;
  mode: "account" | "demo";
  token?: string;
  email?: string;
  displayName?: string;
}

export async function identity(): Promise<Identity | null> {
  const token = cookies().get(ACCOUNT_COOKIE)?.value;
  if (!token) return { userId: sessionId(), mode: "demo" };
  try {
    const response = await fetch(backendUrl("/api/auth/session"), {
      headers: { "x-internal-token": process.env.INTERNAL_API_TOKEN ?? "", "x-account-session": token },
      cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = await response.json() as { user: { user_id: string; email: string; display_name: string } };
    if (!body.user?.user_id?.startsWith("acct:")) return null;
    return { userId: body.user.user_id, mode: "account", token, email: body.user.email, displayName: body.user.display_name };
  } catch { return null; }
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
