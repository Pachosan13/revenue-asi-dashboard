// src/app/api/_lib/getAccountContextOrThrow.ts
import { NextRequest } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"

function isLocalSupabaseUrl() {
  const u = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  return /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(u)
}

export async function getAccountContextOrThrow(req: NextRequest) {
  // ✅ Ya no creamos NextResponse aquí. En API routes normalmente solo necesitas leer sesión.
  // Si algún endpoint necesita refrescar cookies, lo manejas en ese endpoint retornando NextResponse.
  const supabase = createSupabaseServerClient(req)

  const { data: auth, error: authErr } = await supabase.auth.getUser()
  if (authErr) throw new Error(authErr.message)

  const userId = auth?.user?.id
  if (!userId) throw new Error("Unauthorized (no supabase session)")

  // 1) account_id explícito (header o query)
  const hintedAccountId =
    req.headers.get("x-account-id") ||
    new URL(req.url).searchParams.get("account_id")

  if (hintedAccountId) {
    const { data: okMember, error: memErr } = await supabase
      .from("account_members")
      .select("account_id")
      .eq("account_id", hintedAccountId)
      .eq("user_id", userId)
      .maybeSingle()

    if (memErr) throw new Error(memErr.message)
    if (!okMember) throw new Error("Forbidden (not member of hinted account)")

    return { supabase, userId, accountId: hintedAccountId }
  }

  // 2) fallback: primera membresía
  const { data: m, error: mErr } = await supabase
    .from("account_members")
    .select("account_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (mErr) throw new Error(mErr.message)
  if (!m?.account_id) {
    if (!isLocalSupabaseUrl()) throw new Error("No account membership")

    const { data: acct, error: aErr } = await supabase
      .from("accounts")
      .insert({ name: "Local Account" })
      .select("id")
      .single()

    if (aErr) throw new Error(`Account auto-provision failed: ${aErr.message}`)

    const { error: amErr } = await supabase.from("account_members").insert({
      account_id: acct.id,
      user_id: userId,
      role: "owner",
    })

    if (amErr) throw new Error(`Membership auto-provision failed: ${amErr.message}`)

    return { supabase, userId, accountId: acct.id as string }
  }

  return { supabase, userId, accountId: m.account_id as string }
}
