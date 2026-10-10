import { backendUrl, proxyError } from "@/lib/backend";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  // TODO: Forward authenticated user context and replay alerts using Last-Event-ID.
  try {
    const upstream = await fetch(backendUrl("/api/alerts"), {
      headers: { Accept: "text/event-stream" }, cache: "no-store", signal: request.signal,
    });
    if (!upstream.ok || !upstream.body) {
      return Response.json({ error: "Backend alert stream unavailable." }, { status: 502 });
    }
    return new Response(upstream.body, { headers: {
      "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    } });
  } catch (error: unknown) { return proxyError(error); }
}
