import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const VERSION = "domain-verify-v1_2025-11-24"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  const url = new URL(req.url)
  const debug = url.searchParams.get("debug") === "1"

  if (req.method === "GET" && debug) {
    return new Response(
      JSON.stringify({ ok: true, version: VERSION }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  try {
    const body = await req.json()
    const domain_id = body.domain_id

    if (!domain_id) {
      return new Response(JSON.stringify({ ok: false, error: "Missing domain_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const SB_URL = Deno.env.get("SUPABASE_URL")
    const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    const supabase = createClient(SB_URL, SB_KEY)

    // Load domain
    const { data: domain, error: err1 } = await supabase
      .from("domains")
      .select("*")
      .eq("id", domain_id)
      .single()

    if (err1 || !domain) {
      return new Response(JSON.stringify({ ok: false, error: "Domain not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const { domain: domainName, dkim_selector, spf_value, dmarc_value } = domain

    // DNS Resolver
    async function resolveTXT(host: string): Promise<string[]> {
      try {
        const records = await Deno.resolveDns(host, "TXT")
        return records.flat()
      } catch (_) {
        return []
      }
    }

    // Check SPF
    const spfRecords = await resolveTXT(domainName)
    const spf_ok = spfRecords.some((r) => r.includes("v=spf1"))

    // Check DMARC
    const dmarcName = `_dmarc.${domainName}`
    const dmarcRecords = await resolveTXT(dmarcName)
    const dmarc_ok = dmarcRecords.some((r) => r.includes("v=DMARC1"))

    // Check DKIM
    const dkimName = `${dkim_selector}._domainkey.${domainName}`
    const dkimRecords = await resolveTXT(dkimName)
    const dkim_ok = dkimRecords.some((r) => r.includes("v=DKIM1"))

    const all_good = spf_ok && dmarc_ok && dkim_ok

    if (!all_good) {
      return new Response(JSON.stringify({
        ok: false,
        domain_id,
        spf_ok,
        dmarc_ok,
        dkim_ok,
        message: "Domain not ready. Fix DNS.",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Update domain status
    const { error: err2 } = await supabase
      .from("domains")
      .update({
        status: "verified",
        warmup_enabled: true,
        outbound_enabled: true,
      })
      .eq("id", domain_id)

    return new Response(JSON.stringify({
      ok: true,
      version: VERSION,
      domain_id,
      domain: domainName,
      spf_ok,
      dmarc_ok,
      dkim_ok,
      status: "verified",
      next: "Create accounts with account-create",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })

  } catch (e) {
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
