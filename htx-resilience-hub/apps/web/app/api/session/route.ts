import { identity } from "@/lib/account";
export const dynamic = "force-dynamic";
export async function GET(): Promise<Response> {
  const viewer = await identity();
  if (!viewer) return Response.json({ error: "Sign in again" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return Response.json({ ready: true, mode: viewer.mode, email: viewer.email, display_name: viewer.displayName },
    { headers: { "Cache-Control": "no-store" } });
}
