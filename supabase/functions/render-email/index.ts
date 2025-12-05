// supabase/functions/render-email/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"

const VERSION = "render-email-v2_2025-11-24_real_schema"

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  const SB_URL = Deno.env.get("SUPABASE_URL")
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!SB_URL || !SB_KEY) {
    return new Response(JSON.stringify({ ok:false, stage:"env" }), {
      status:500, headers:{ ...corsHeaders, "Content-Type":"application/json" },
    })
  }
  const supabase = createClient(SB_URL, SB_KEY)

  try {
    const { lead_id, campaign_id, step = 1 } = await req.json()

    const { data: lead, error: lErr } = await supabase
      .from("lead_enriched")
      .select("id, name, email, company, meta")
      .eq("id", lead_id)
      .single()
    if (lErr) throw lErr

    const { data: camp, error: cErr } = await supabase
      .from("campaigns")
      .select("id, name, status, meta")
      .eq("id", campaign_id)
      .single()
    if (cErr) throw cErr

    const meta = (camp as any)?.meta || {}
    const icp = meta.icp || {}
    const offer = meta.offer || "te ayudo a generar citas sin perseguir leads"
    const tone = meta.tone || "directo, humano, cero spam"

    const firstName = lead?.name?.split(" ")?.[0] || "hola"
    const industry = icp.industry || meta.industry || "tu negocio"

    const subject =
      step === 1 ? `${firstName}, idea rápida para ${industry}` :
      step === 2 ? `${firstName}, ¿lo viste?` :
      `${firstName}, cierro el loop`

    const bodyHtml = `
      <p>${firstName},</p>
      <p>Te escribo corto. Vi que muchos ${industry} pierden leads diarios porque nadie responde rápido.</p>
      <p>Mi equipo montó un agente que hace follow-up por email/whatsapp/voz y agenda citas automáticas. ${offer}.</p>
      <p>¿Te interesa que te muestre cómo aplicaría para ${lead?.company || "tu caso"}?</p>
      <p>— Pacho / Level 5</p>
    `.trim()

    return new Response(JSON.stringify({
      ok:true, version:VERSION,
      lead_id, campaign_id, step,
      subject,
      body_html: bodyHtml,
      body_text: bodyHtml.replace(/<[^>]+>/g, ""),
      tone,
    }), { headers:{ ...corsHeaders, "Content-Type":"application/json" } })
  } catch (e:any) {
    return new Response(JSON.stringify({ ok:false, stage:"fatal", error:String(e), version:VERSION }), {
      status:500, headers:{ ...corsHeaders, "Content-Type":"application/json" },
    })
  }
})
