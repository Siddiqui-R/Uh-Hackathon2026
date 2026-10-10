import { proxy } from "@/lib/proxy";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> { return proxy(request, "/api/hazards", false); }
