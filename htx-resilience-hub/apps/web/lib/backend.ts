import "server-only";
import { requireEnv } from "./env";

export function backendUrl(path: string): string {
  return `${requireEnv("API_BASE_URL").replace(/\/$/, "")}${path}`;
}

export function proxyError(error: unknown): Response {
  const configurationError = error instanceof Error && error.message.startsWith("Missing required environment variable:");
  return Response.json(
    { error: configurationError && error instanceof Error ? error.message : "Backend unavailable. Check API_BASE_URL and start the FastAPI service." },
    { status: configurationError ? 503 : 502 },
  );
}
