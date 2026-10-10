import { backendUrl, proxyError } from "@/lib/backend";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  // TODO: Add geographic filters and cache policy when real readings are available.
  try {
    const upstream = await fetch(backendUrl("/api/hazards"), { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    return new Response(await upstream.text(), {
      status: upstream.status, headers: { "Content-Type": "application/json" },
    });
  } catch (error: unknown) { return proxyError(error); }
}
