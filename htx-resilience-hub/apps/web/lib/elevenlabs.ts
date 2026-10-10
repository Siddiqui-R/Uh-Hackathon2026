import "server-only";
import { requireEnv } from "./env";
export async function speak(text: string): Promise<Uint8Array> {
  const key = requireEnv("ELEVENLABS_API_KEY"), voice = requireEnv("ELEVENLABS_VOICE_ID");
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`, {
    method: "POST", headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: requireEnv("ELEVENLABS_MODEL_ID") }), signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("Voice provider request failed");
  return new Uint8Array(await response.arrayBuffer());
}
