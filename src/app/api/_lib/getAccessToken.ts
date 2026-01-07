import { headers } from "next/headers"

/**
 * Next.js App Router note:
 * `headers()` is the reliable way to access request headers in route handlers.
 */
export async function getAccessTokenFromRequest(): Promise<string | null> {
  // Next 15/16: `headers()` may be async (returns a Promise).
  const maybe = headers() as any
  const h = typeof maybe?.then === "function" ? await maybe : maybe

  const auth = (h?.get?.("authorization") || "").trim()
  if (!auth) return null
  if (!auth.toLowerCase().startsWith("bearer ")) return null
  const token = auth.slice("bearer ".length).trim()
  return token || null
}


