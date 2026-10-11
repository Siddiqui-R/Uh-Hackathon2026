import { accountSession } from "@/lib/account";
export const dynamic = "force-dynamic";
export async function GET(): Promise<Response> {
  const session = await accountSession();
  if (session.status !== "valid") return Response.json({ error: session.status === "unavailable" ? "Account service unavailable" : "Sign in again" }, { status: session.status === "unavailable" ? 503 : 401, headers: { "Cache-Control": "no-store" } });
  const viewer = session.account;
  return Response.json({ ready: true, mode: viewer.mode, email: viewer.email, display_name: viewer.displayName },
    { headers: { "Cache-Control": "no-store" } });
}
