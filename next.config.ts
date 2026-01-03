import type { NextConfig } from "next";
import { config as dotenvConfig } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Load env vars from supabase/.env.local for local dev.
// This avoids needing a repo-root `.env.local` file (often gitignored / blocked).
try {
  const supaEnv = resolve(process.cwd(), "supabase", ".env.local");
  if (existsSync(supaEnv)) {
    dotenvConfig({ path: supaEnv, override: true });
  }
} catch {
  // ignore
}

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
