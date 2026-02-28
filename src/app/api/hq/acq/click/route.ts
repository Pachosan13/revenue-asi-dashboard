import { NextResponse } from "next/server"
import { createServiceRoleClient } from "@/app/api/_lib/createUserClientFromJwt"

export const dynamic = "force-dynamic"

function clean(v: string | null) {
  const x = (v || "").trim()
  return x.length ? x : null
}

export async function GET(req: Request) {
  const token = clean(new URL(req.url).searchParams.get("token"))
  const calendlyLink = process.env.CALENDLY_LINK || "https://calendly.com"
  const redirectUrl = new URL(calendlyLink)

  if (!token) return NextResponse.redirect(redirectUrl)

  const supabase = createServiceRoleClient()
  const nowIso = new Date().toISOString()

  await supabase
    .from("hq_dealer_outreach")
    .update({ clicked_at: nowIso, updated_at: nowIso })
    .eq("token", token)
    .is("clicked_at", null)

  return NextResponse.redirect(redirectUrl)
}
