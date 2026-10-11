import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import "./experience.css";

// Self-hosted at build time by next/font; the CSS stack falls back to system fonts.
const sans = Figtree({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "Noach | Houston environmental intelligence",
  description: "Plan outdoor activities with Houston weather, air and bayou context, and receive alerts when nearby conditions change.",
};
export const viewport: Viewport = { themeColor: "#f5f6f2" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={sans.variable}><body>{children}</body></html>;
}
