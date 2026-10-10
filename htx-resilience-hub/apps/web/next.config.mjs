import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

// Local dev reads the root template; deployment env variables take precedence.
nextEnv.loadEnvConfig(fileURLToPath(new URL("../../", import.meta.url)), process.env.NODE_ENV !== "production", console, true);
/** @type {import('next').NextConfig} */
const nextConfig = { reactStrictMode: true };
export default nextConfig;
