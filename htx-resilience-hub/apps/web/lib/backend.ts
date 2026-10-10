import "server-only";
export function backendUrl(path: string): string {
  return `${(process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "")}${path}`;
}
export function proxyError(error: unknown): Response {
  void error;
  return Response.json({ error: "Backend unavailable. Start the API service and verify API_BASE_URL." }, { status: 502 });
}
