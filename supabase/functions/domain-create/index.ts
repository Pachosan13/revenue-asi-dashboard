import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { crypto } from "https://deno.land/std@0.224.0/crypto/mod.ts"

const VERSION = "domain-create-v1_2025-11-24"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
}

function b64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

async function genDkimKeypair() {
  // RSA 2048 for DKIM
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )

  const priv = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey)
  const pub = await crypto.subtle.exportKey("spki", keyPair.publicKey)

  // PEM
  const privPem =
    "-----BEGIN PRIVATE KEY-----\n" +
    btoa(String.fromCharCode(...new Uint8Array(priv))).match(/.{1,64}/g)?.join("\n") +
    "\n-----END PRIVATE KEY-----"

  const pubPem =
    "-----BEGIN PUBLIC KEY-----\n" +
    btoa(String.fromCharCode(...new Uint8Array(pub))).match(/.{1,64}/g)?.join("\n") +
    "\n-----END PUBLIC KEY-----"

  return { privPem, pubPem }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  const url = new URL(req.url)
  const debug = url.searchParams.get("debug") === "1"
  if (req.method === "GET" && debug) {
    return new Response(JSON.stringify({ ok: true, version: VERSION }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const SB_URL = Deno.env.get("SUPABASE_URL")
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!SB_URL || !SB_KEY) {
    return new Response(JSON.stringify({ ok: false, stage: "env", error: "Missing Supabase env" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const supabase = createClient(SB_URL, SB_KEY)

  try {
    const body = await req.json()
    const domain = String(body.domain || "").trim().toLowerCase()
    if (!domain || !domain.includes(".")) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid domain" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const selector = body.selector?.trim() || `ra-${new Date().getUTCFullYear()}`
    const { privPem, pubPem } = await genDkimKeypair()

    // SPF/DMARC templates (SES-friendly but provider-agnostic)
    const spfValue = `v=spf1 include:amazonses.com ~all`
    const dmarcValue = `v=DMARC1; p=none; rua=mailto:dmarc@${domain}; ruf=mailto:dmarc@${domain}; fo=1`

    const { data, error } = await supabase
      .from("domains")
      .insert({
        domain,
        status: "pending",
        dkim_selector: selector,
        dkim_private_key: privPem,
        spf_value: spfValue,
        dmarc_value: dmarcValue,
        warmup_enabled: false,
        outbound_enabled: false,
      })
      .select()
      .single()

    if (error) throw error

    // DKIM TXT record value: we store public key in response (not DB)
    const pubKeyB64 = pubPem
      .replace(/-----.*-----/g, "")
      .replace(/\s+/g, "")

    const dkimTxtName = `${selector}._domainkey.${domain}`
    const dkimTxtValue = `v=DKIM1; k=rsa; p=${pubKeyB64}`

    return new Response(JSON.stringify({
      ok: true,
      version: VERSION,
      domain_id: data.id,
      domain,
      dns: {
        spf: { type: "TXT", name: domain, value: spfValue },
        dmarc: { type: "TXT", name: `_dmarc.${domain}`, value: dmarcValue },
        dkim: { type: "TXT", name: dkimTxtName, value: dkimTxtValue },
      },
      next: "Add these DNS records, then call domain-verify",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })

  } catch (e) {
    return new Response(JSON.stringify({ ok: false, stage: "fatal", error: String(e), version: VERSION }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
