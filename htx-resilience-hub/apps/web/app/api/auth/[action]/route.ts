import { cookies } from "next/headers";
import { ACCOUNT_COOKIE, clearAccountCookie, setAccountCookie } from "@/lib/account";
import { backendUrl, proxyError } from "@/lib/backend";
import { rateLimited } from "@/lib/session";

export const dynamic = "force-dynamic";
const actions = new Set(["signup", "login", "logout", "request-reset", "reset", "profile", "demo"]);

export async function POST(request: Request, { params }: { params: { action: string } }): Promise<Response> {
  const action = params.action;
  if (!actions.has(action)) return Response.json({ error: "Not found" }, { status: 404 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
  if (action === "demo") { clearAccountCookie(); return Response.json({ ok: true }); }
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
    const result = await upstream.json() as { session_token?: string; user?: unknown; detail?: string; message?: string; dev_reset_url?: string };
    if (!upstream.ok) {
      if (action === "logout" && upstream.status === 401) { clearAccountCookie(); return Response.json({ ok: true }); }
      return Response.json({ error: result.detail ?? "Account request failed" }, { status: upstream.status });
    }
    if (action === "signup" || action === "login") {
      if (!result.session_token) return Response.json({ error: "Account session unavailable" }, { status: 502 });
      setAccountCookie(result.session_token);
      return Response.json({ user: result.user }, { headers: { "Cache-Control": "no-store" } });
    }
    if (action === "logout" || action === "reset") clearAccountCookie();
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error: unknown) { return proxyError(error); }
}
