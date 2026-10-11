import { NextRequest, NextResponse } from "next/server";
import { safeReturnTo } from "./lib/returnTo";

const featurePaths = new Set(["/places", "/routines", "/recommendations", "/monitor", "/assistant", "/settings"]);

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const feature = featurePaths.has(path);
  if (request.cookies.has("noach_demo")) return NextResponse.next();
  if (!feature && path !== "/login") return NextResponse.next();

  const token = request.cookies.get("noach_account")?.value;
  if (!token) return feature ? toLogin(request) : NextResponse.next();

  try {
    const base = (process.env.API_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
    const response = await fetch(`${base}/api/auth/session`, {
      headers: { "x-internal-token": process.env.INTERNAL_API_TOKEN ?? "", "x-account-session": token },
      cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401) return feature ? toLogin(request) : NextResponse.next();
    if (!response.ok) return NextResponse.next(); // The page renders the service-unavailable state.
    const body = await response.json() as { user?: { user_id?: string } };
    if (!body.user?.user_id?.startsWith("acct:")) return feature ? toLogin(request) : NextResponse.next();
    if (path === "/login") return NextResponse.redirect(new URL(safeReturnTo(request.nextUrl.searchParams.get("next") ?? undefined), request.url));
    return NextResponse.next();
  } catch {
    return NextResponse.next(); // The page renders the service-unavailable state.
  }
}

function toLogin(request: NextRequest) {
  const destination = safeReturnTo(request.nextUrl.pathname + request.nextUrl.search);
  const login = new URL("/login", request.url);
  login.searchParams.set("next", destination);
  return NextResponse.redirect(login);
}

export const config = { matcher: ["/places", "/routines", "/recommendations", "/monitor", "/assistant", "/settings", "/login"] };
