// supabase/functions/voice-handoff/index.ts
// Minimal handler invoked by Fly voice gateway when a call is HOT and should be handed off.
// Auth: require `Authorization: Bearer <token>` where token is `VOICE_HANDOFF_TOKEN` (fallback `SUPABASE_VOICE_HANDOFF_TOKEN`).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function isAuthorized(req: Request): boolean {
  const expected =
    String(Deno.env.get("VOICE_HANDOFF_TOKEN") ?? "").trim() ||
    String(Deno.env.get("SUPABASE_VOICE_HANDOFF_TOKEN") ?? "").trim()
  if (!expected) return false

  const auth = String(req.headers.get("authorization") ?? "")
  const prefix = "Bearer "
  if (!auth.startsWith(prefix)) return false
  const token = auth.slice(prefix.length).trim()
  return token.length > 0 && token === expected
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ ok: false, error: "Use POST" }, 405)

  // Auth must be validated BEFORE touching Supabase/DB
  if (!isAuthorized(req)) return json({ ok: false, error: "unauthorized" }, 401)

  const SB_URL = Deno.env.get("SUPABASE_URL")
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!SB_URL || !SB_KEY) return json({ ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500)

  const supabase = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } })

  const body = (await req.json().catch(() => ({}))) as any
  const touch_run_id = String(body.touch_run_id ?? "").trim()
  const lead_id = String(body.lead_id ?? "").trim()
  const call_control_id = String(body.call_control_id ?? "").trim()
  const summary = String(body.summary ?? "").trim()
  const hot = Boolean(body.hot ?? false)

  if (!touch_run_id) return json({ ok: false, error: "touch_run_id required" }, 400)

  // Update touch_runs.meta.voice_handoff_last deterministically
  const { data: row } = await supabase
    .from("touch_runs")
    .select("meta")
    .eq("id", touch_run_id)
    .maybeSingle()

  const meta = (row?.meta ?? {}) as any
  const next = {
    ...meta,
    voice_handoff_last: {
      hot,
      lead_id: lead_id || null,
      call_control_id: call_control_id || null,
      summary: summary ? summary.slice(0, 2000) : null,
      received_at: new Date().toISOString(),
      source: "fly_voice_gateway",
    },
  }

  const { error: uErr } = await supabase
    .from("touch_runs")
    .update({ meta: next, updated_at: new Date().toISOString() })
    .eq("id", touch_run_id)

  if (uErr) return json({ ok: false, error: uErr.message }, 500)

  return json({ ok: true })
})

export const config = { verify_jwt: false }


