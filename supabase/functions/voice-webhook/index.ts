import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { logEvaluation } from "../_shared/eval.ts"

const VERSION = "voice-webhook-v1_2025-11-24"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
}

// Cliente supabase best-effort (si falta env, no rompe Twilio)
const SB_URL = Deno.env.get("SUPABASE_URL")
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
const supabase =
  SB_URL && SB_KEY ? createClient(SB_URL, SB_KEY) : null

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  const url = new URL(req.url)
  const audioUrl = url.searchParams.get("audio_url")

  if (!audioUrl) {
    // Log: webhook sin audio
    if (supabase) {
      try {
        await logEvaluation({
          supabase,
          event_type: "evaluation",
          actor: "webhook",
          label: "voice_webhook_v1",
          kpis: {
            channel: "voice",
            audio_present: 0,
          },
          notes: "voice-webhook called without audio_url",
        })
      } catch (e) {
        console.error("logEvaluation failed in voice-webhook (no audio)", e)
      }
    }

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Sorry, no audio was provided.</Say>
  <Hangup/>
</Response>`

    return new Response(twiml, {
      headers: { ...corsHeaders, "Content-Type": "text/xml" },
    })
  }

  // Log: webhook con audio
  if (supabase) {
    try {
      await logEvaluation({
        supabase,
        event_type: "evaluation",
        actor: "webhook",
        label: "voice_webhook_v1",
        kpis: {
          channel: "voice",
          audio_present: 1,
        },
        notes: `voice-webhook with audio_url=${audioUrl.substring(0, 120)}`,
      })
    } catch (e) {
      console.error("logEvaluation failed in voice-webhook (with audio)", e)
    }
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${audioUrl}</Play>
  <Hangup/>
</Response>`

  return new Response(twiml, {
    headers: { ...corsHeaders, "Content-Type": "text/xml" },
  })
})
