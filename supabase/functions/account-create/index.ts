import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const VERSION = "account-create-v1_2025-11-24"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const SB_URL = Deno.env.get("SUPABASE_URL")
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const supabase = createClient(SB_URL, SB_KEY)

  try {
    const payload = await req.json()

    const domain_id = payload.domain_id
    const email = payload.email?.trim().toLowerCase()
    const smtp_host = payload.smtp_host
    const smtp_port = payload.smtp_port || 587
    const smtp_username = payload.smtp_username
    const smtp_password = payload.smtp_password

    const daily_limit = payload.daily_limit || 70
    const warmup_limit = payload.warmup_limit || 20

    if (!domain_id || !email || !smtp_host || !smtp_username || !smtp_password) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Missing required fields",
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Check domain exists
    const { data: domain, error: domainErr } = await supabase
      .from("domains")
      .select("*")
      .eq("id", domain_id)
      .single()

    if (domainErr || !domain) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Domain not found",
      }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Insert account
    const { data: account, error: insertErr } = await supabase
      .from("domain_accounts")
      .insert({
        domain_id,
        email,
        smtp_host,
        smtp_port,
        smtp_username,
        smtp_password,
        daily_limit,
        warmup_daily_limit: warmup_limit,
        status: "pending",
        reputation_score: 100,
      })
      .select()
      .single()

    if (insertErr) throw insertErr

    return new Response(JSON.stringify({
      ok: true,
      version: VERSION,
      account_id: account.id,
      next: "Use warmup-engine to start warming the account",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (e) {
    console.error("account-create fatal:", e)
    return new Response(JSON.stringify({
      ok: false,
      stage: "fatal",
      error: String(e),
      version: VERSION,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
