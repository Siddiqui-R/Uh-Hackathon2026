import { backendUrl, proxyError } from "@/lib/backend";
import { accountSession } from "@/lib/account";
import { cookies } from "next/headers";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  const session = await accountSession();
  if (session.status !== "valid") return Response.json({ error: "Sign in again" }, { status: session.status === "unavailable" ? 503 : 401 });
  const viewer = session.account;
  if (viewer.mode === "demo") {
    const encoder = new TextEncoder();
    const time = new Date().toISOString();
    const alert = { id: "1", time, user_id: viewer.userId, hazard: "heat", severity: "watch", location_id: "uh", station_id: null,
      message: "Demo: the sample basketball plan is above your example heat and AQI limits. Compare a later time in Outlook.", demo: true, read_at: cookies().get("noach_demo_alert_read")?.value === "1" ? time : null,
      suggestions: [{ title: "Review heat safety guidance", description: "Official outdoor heat guidance", source_url: "https://www.weather.gov/safety/heat" }] };
    let timer: ReturnType<typeof setInterval>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`event: ready\ndata: {}\n\nid: 1\nevent: alert\ndata: ${JSON.stringify(alert)}\n\n`));
        timer = setInterval(() => controller.enqueue(encoder.encode(": demo heartbeat\n\n")), 15_000);
        request.signal.addEventListener("abort", () => { clearInterval(timer); try { controller.close(); } catch {} }, { once: true });
      },
      cancel() { clearInterval(timer); },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" } });
  }
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
