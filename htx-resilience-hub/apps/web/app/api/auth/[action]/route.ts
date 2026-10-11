import { cookies } from "next/headers";
import { ACCOUNT_COOKIE, clearAccountCookie, setAccountCookie } from "@/lib/account";
import { backendUrl, proxyError } from "@/lib/backend";
import { rateLimited } from "@/lib/session";
import { readDemoPreferences, clearDemoPreferences } from "@/lib/demoSession";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const actions = new Set(["signup", "login", "logout", "request-reset", "reset", "profile", "demo"]);

export async function POST(request: Request, { params }: { params: { action: string } }): Promise<Response> {
  const action = params.action;
  if (!actions.has(action)) return Response.json({ error: "Not found" }, { status: 404 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
  if (action === "demo") { const response = NextResponse.json({ ok: true }); clearDemoPreferences(response); clearAccountCookie(); return response; }
  if (action === "logout" && readDemoPreferences()) { const response = NextResponse.json({ ok: true, mode: "demo" }); clearDemoPreferences(response); return response; }
  const currentToken = cookies().get(ACCOUNT_COOKIE)?.value;
  if ((action === "logout" || action === "profile") && !currentToken) return Response.json({ error: "Sign in required" }, { status: 401 });
  const rateKey = currentToken ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anonymous";
  if (["signup", "login", "request-reset", "reset"].includes(action) && rateLimited("auth:" + rateKey, 5))
    return Response.json({ error: "Please wait before trying again." }, { status: 429 });
  let body: unknown = {};
  if (action !== "logout") {
    try { body = await request.json(); }
    catch { return Response.json({ error: "A JSON object is required." }, { status: 400 }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "A JSON object is required." }, { status: 400 });
  }
  try {
    const upstream = await fetch(backendUrl("/api/auth/" + action), {
      method: "POST", headers: {
        "Content-Type": "application/json", "x-internal-token": process.env.INTERNAL_API_TOKEN ?? "",
        ...((action === "logout" || action === "profile") && currentToken ? { "x-account-session": currentToken } : {}),
      },
      body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(30_000),
    });
    if (upstream.status === 404) return Response.json({ error: process.env.NOACH_ENV === "production"
      ? "The account service connected to this site does not support this action yet. Please contact the site owner."
      : "The local API does not have this account route. Stop old API processes, then restart both services with python tools/dev.py." }, { status: 502 });
    const result = await upstream.json() as { session_token?: string; user?: unknown; detail?: string; message?: string; dev_reset_url?: string };
    if (!upstream.ok) {
      if (action === "logout" && upstream.status === 401) { clearAccountCookie(); return Response.json({ ok: true }); }
      return Response.json({ error: result.detail ?? "Account request failed" }, { status: upstream.status });
    }
    if (action === "signup" || action === "login") {
      if (!result.session_token) return Response.json({ error: "Account session unavailable" }, { status: 502 });
      setAccountCookie(result.session_token);
      const response = NextResponse.json({ user: result.user }, { headers: { "Cache-Control": "no-store" } });
      clearDemoPreferences(response);
      return response;
    }
    if (action === "logout" || action === "reset") clearAccountCookie();
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error: unknown) { return proxyError(error); }
}
