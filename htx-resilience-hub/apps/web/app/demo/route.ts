import { NextResponse } from "next/server";
import { demoPreferences } from "@/lib/demoData";
import { readDemoPreferences, setDemoPreferences } from "@/lib/demoSession";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const response = NextResponse.redirect(new URL("/", request.url));
  if (!readDemoPreferences()) setDemoPreferences(response, demoPreferences());
  return response;
}
