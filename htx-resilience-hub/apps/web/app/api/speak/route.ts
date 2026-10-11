import { speak } from "@/lib/elevenlabs";
import { rateLimited } from "@/lib/session";
import { accountSession } from "@/lib/account";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
  const session = await accountSession();
  if (session.status !== "valid") return Response.json({ error: "Sign in again" }, { status: session.status === "unavailable" ? 503 : 401 });
  const viewer = session.account;
  if (rateLimited(viewer.userId)) return Response.json({ error: "Please wait before requesting more audio." }, { status: 429 });
  let text: unknown;
  try { text = (await request.json() as { text?: unknown }).text; } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (typeof text !== "string" || !text.trim() || text.length > 1800) return Response.json({ error: "Text must be 1–1800 characters" }, { status: 400 });
  try {
    const bytes = await speak(text);
    return new Response(new Uint8Array(bytes).buffer, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Voice unavailable. Check ElevenLabs key and voice ID; your text briefing remains available." }, { status: 503 }); }
}
