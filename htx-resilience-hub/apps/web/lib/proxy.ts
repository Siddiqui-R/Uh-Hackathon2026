import "server-only";
import { backendUrl, proxyError } from "./backend";
import { sessionId, rateLimited } from "./session";

export async function proxy(request: Request, path: string, personal = true): Promise<Response> {
  const id = sessionId();
  const url = new URL(backendUrl(path));
  const incoming = new URL(request.url);
  incoming.searchParams.forEach((value, key) => { if (key !== "user_id") url.searchParams.set(key, value); });
  if (personal) url.searchParams.set("user_id", id);
  const headers: Record<string, string> = { "Content-Type": "application/json", "x-internal-token": process.env.INTERNAL_API_TOKEN ?? "" };
  let body: string | undefined;
  if (request.method === "POST") {
    const origin = request.headers.get("origin");
    if (origin && origin !== incoming.origin) return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
    if (rateLimited(id)) return Response.json({ error: "Please wait before trying again." }, { status: 429 });
    try {
      const value: unknown = await request.json();
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      body = JSON.stringify({ ...value, user_id: id });
    } catch { return Response.json({ error: "A JSON object is required." }, { status: 400 }); }
  }
  try {
    const upstream = await fetch(url, { method: request.method, headers, body, cache: "no-store", signal: AbortSignal.timeout(90_000) });
    return new Response(await upstream.text(), { status: upstream.status, headers: {
      "Content-Type": "application/json", "X-AI-Provider": upstream.headers.get("X-AI-Provider") ?? "",
      "X-Data-Mode": upstream.headers.get("X-Data-Mode") ?? "", "Cache-Control": "no-store",
    } });
  } catch (error: unknown) { return proxyError(error); }
}
