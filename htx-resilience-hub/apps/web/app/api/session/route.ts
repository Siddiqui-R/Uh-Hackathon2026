import { sessionId } from "@/lib/session";
export const dynamic = "force-dynamic";
export async function GET(): Promise<Response> {
  sessionId();
  return Response.json({ ready: true }, { headers: { "Cache-Control": "no-store" } });
}
