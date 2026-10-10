import "server-only";
import { requireEnv } from "./env";

export async function speak(text: string): Promise<Uint8Array> {
  // TODO: Request ElevenLabs speech audio on the server and return bytes for browser playback.
  requireEnv("ELEVENLABS_API_KEY");
  void text;
  throw new Error("ElevenLabs speak integration is not implemented.");
}
