import "server-only";
import { cookies } from "next/headers";
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";

const signingKey = process.env.INTERNAL_API_TOKEN || randomUUID();
function signature(value: string): string { return createHmac("sha256", signingKey).update(value).digest("hex"); }

export function sessionId(): string {
  const current = cookies().get("noach_session")?.value;
  const [user, proof] = (current ?? "").split(".");
  if (user && /^[a-f0-9-]{36}$/.test(user) && proof && /^[a-f0-9]{64}$/.test(proof) && timingSafeEqual(Buffer.from(proof), Buffer.from(signature(user)))) return user;
  const id = randomUUID();
  cookies().set("noach_session", id + "." + signature(id), { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 31536000 });
  return id;
}

const calls = new Map<string, { count: number; reset: number }>();
export function rateLimited(id: string, limit = 20): boolean {
  const now = Date.now();
  for (const [key, value] of calls) if (value.reset < now) calls.delete(key);
  const current = calls.get(id);
  if (!current || current.reset < now) { calls.set(id, { count: 1, reset: now + 60_000 }); return false; }
  current.count += 1;
  return current.count > limit;
}
