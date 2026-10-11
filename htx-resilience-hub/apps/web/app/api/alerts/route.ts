import { backendUrl, proxyError } from "@/lib/backend";
import { accountSession } from "@/lib/account";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  const session = await accountSession();
  if (session.status !== "valid") return Response.json({ error: "Sign in again" }, { status: session.status === "unavailable" ? 503 : 401 });
  const viewer = session.account;
  const url = new URL(backendUrl("/api/alerts"));
  url.searchParams.set("user_id", viewer.userId);
  const after = new URL(request.url).searchParams.get("after");
  if (after) url.searchParams.set("after", after);
  try {
    const upstream = await fetch(url, { headers: {
      Accept: "text/event-stream", "x-internal-token": process.env.INTERNAL_API_TOKEN ?? "",
      "Last-Event-ID": request.headers.get("last-event-id") ?? "0",
      ...(viewer.token ? { "x-account-session": viewer.token } : {}),
    }, cache: "no-store", signal: request.signal });
    if (!upstream.ok || !upstream.body) throw new Error();
    return new Response(upstream.body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
  } catch (error: unknown) { return proxyError(error); }
}
