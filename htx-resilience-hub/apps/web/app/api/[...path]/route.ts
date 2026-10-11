import { proxy } from "@/lib/proxy";
export const dynamic = "force-dynamic";
const allowed = new Set(["briefing", "prefs", "status", "hazards/history", "alerts/demo", "conditions/area", "conditions/point", "geocode"]);
const shared = new Set(["status", "hazards/history", "conditions/area", "geocode"]);
export async function GET(request: Request, { params }: { params: { path: string[] } }): Promise<Response> {
  const path = params.path.join("/");
  if (!allowed.has(path) || path === "alerts/demo") return Response.json({ error: "Not found" }, { status: 404 });
  return proxy(request, "/api/" + path, !shared.has(path));
}
export async function POST(request: Request, { params }: { params: { path: string[] } }): Promise<Response> {
  const path = params.path.join("/");
  if (!["prefs", "alerts/demo"].includes(path)) return Response.json({ error: "Not found" }, { status: 404 });
  return proxy(request, "/api/" + path);
}
