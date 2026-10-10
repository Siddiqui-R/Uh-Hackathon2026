import { backendUrl, proxyError } from "@/lib/backend";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  // TODO: Attach authenticated user identity and apply question rate limits before proxying.
  let payload: unknown;
  try { payload = await request.json(); }
  catch { return Response.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  try {
    const upstream = await fetch(backendUrl("/api/ask"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload), cache: "no-store", signal: AbortSignal.timeout(30_000),
    });
    return new Response(await upstream.text(), {
      status: upstream.status, headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error: unknown) { return proxyError(error); }
}
