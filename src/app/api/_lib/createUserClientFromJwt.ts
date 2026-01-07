import { createClient } from "@supabase/supabase-js"

export function createUserClientFromJwt(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) throw new Error("Missing Supabase env vars")

  return createClient(url, anon, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const srv = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !srv) throw new Error("Missing Supabase env vars")
  return createClient(url, srv, { auth: { persistSession: false } })
}


