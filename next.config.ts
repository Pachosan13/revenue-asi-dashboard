import type { NextConfig } from "next";
import { config as dotenvConfig } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Load env vars from supabase/.env(.local) for local dev.
// We do NOT override existing process.env (Next's .env.local should win).
try {
  const supaEnv = resolve(process.cwd(), "supabase", ".env.local");
  const supaEnv2 = resolve(process.cwd(), "supabase", ".env");
  if (existsSync(supaEnv2)) dotenvConfig({ path: supaEnv2, override: false });
  if (existsSync(supaEnv)) dotenvConfig({ path: supaEnv, override: false });
} catch {
  // ignore
}

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
