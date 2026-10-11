import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Noach Select | Houston environmental intelligence",
  description: "Plan outdoor activities with Houston weather, air and bayou context, and receive alerts when nearby conditions change.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
