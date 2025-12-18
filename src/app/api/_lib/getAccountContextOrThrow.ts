import { NextRequest } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export async function getAccountContextOrThrow(req?: NextRequest) {
  const supabase = createSupabaseServerClient()

  const { data: auth, error: authErr } = await supabase.auth.getUser()
  const userId = auth?.user?.id

  if (authErr || !userId) {
    throw new Error("Unauthorized (no supabase session)")
  }

  // Si mandan account_id explícito (query/body), lo respetamos,
  // pero igual validamos membership para evitar spoofing.
  const url = req ? new URL(req.url) : null
  const hintedAccountId = url?.searchParams.get("account_id") ?? null

  if (hintedAccountId) {
    const { data: okMember } = await supabase
      .from("account_members")
      .select("account_id")
      .eq("account_id", hintedAccountId)
      .eq("user_id", userId)
      .maybeSingle()

    if (!okMember?.account_id) throw new Error("Forbidden (not a member of account_id)")
    return { supabase, userId, accountId: hintedAccountId }
  }

  // Default: primera cuenta donde es miembro
  const { data: m, error: mErr } = await supabase
    .from("account_members")
    .select("account_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (mErr) throw new Error(`Failed to load membership: ${mErr.message}`)
  if (!m?.account_id) throw new Error("Missing account_id (no membership found)")

  return { supabase, userId, accountId: m.account_id as string }
}
