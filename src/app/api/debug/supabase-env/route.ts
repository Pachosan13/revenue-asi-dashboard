import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

function safePrefix(v: string | undefined | null, n = 8) {
  const s = String(v ?? "")
  if (!s) return ""
  return s.slice(0, n)
}

export async function GET() {
  const pubUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  const pubKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
  const srvUrl = process.env.SUPABASE_URL ?? ""
  const srvKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""

  const pubHost = (() => {
    try {
      return new URL(pubUrl).host
    } catch {
      return pubUrl
    }
  })()

  const srvHost = (() => {
    try {
      return new URL(srvUrl).host
    } catch {
      return srvUrl
    }
  })()

  return NextResponse.json({
    ok: true,
    next_public_supabase_url_host: pubHost,
    next_public_supabase_anon_key_prefix: safePrefix(pubKey, 14),
    supabase_url_host: srvHost,
    supabase_service_role_key_prefix: safePrefix(srvKey, 14),
  })
}


