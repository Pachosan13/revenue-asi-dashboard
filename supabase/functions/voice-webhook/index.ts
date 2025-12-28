// supabase/functions/voice-webhook/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { setLeadState } from "../_shared/state.ts";
import { logEvaluation } from "../_shared/eval.ts";

const VERSION = "voice-webhook-v2_2025-12-15";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function xmlResponse(xml: string, extraHeaders: Record<string, string> = {}) {
  return new Response(xml, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/xml", ...extraHeaders },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Supabase client best-effort (si falta env, NO rompemos el webhook)
  const SB_URL = Deno.env.get("SUPABASE_URL");
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = SB_URL && SB_KEY ? createClient(SB_URL, SB_KEY) : null;

  // 1) Aceptamos 2 modos:
  //    A) Twilio inbound: form-data (CallStatus, From, CallSid)
  //    B) Playback: ?audio_url=... (para reproducir audio)
  const url = new URL(req.url);
  const audioUrl = url.searchParams.get("audio_url");

  // ---- MODE B: Playback (GET con audio_url) ----
  if (audioUrl) {
    if (supabase) {
      try {
        await logEvaluation({
          supabase,
          event_type: "evaluation",
          actor: "webhook",
          label: "voice_webhook_play",
          kpis: { channel: "voice", audio_present: 1 },
          notes: `VERSION=${VERSION} audio_url=${audioUrl.substring(0, 160)}`,
        });
      } catch (e) {
        console.error("voice-webhook logEvaluation(play) failed", e);
      }
    }

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${audioUrl}</Play>
  <Hangup/>
</Response>`;
    return xmlResponse(twiml);
  }

  // ---- MODE A: Twilio inbound (POST form-data) ----
  const formData = await req.formData().catch(() => null);

  const callStatus = (formData?.get("CallStatus") as string | null) ?? null;
  const fromNumber = (formData?.get("From") as string | null) ?? null;
  const callSid = (formData?.get("CallSid") as string | null) ?? null;

  const normalizedNumber = fromNumber?.replace(/^whatsapp:/, "") ?? null;

  if (supabase) {
    try {
      await logEvaluation({
        supabase,
        event_type: "evaluation",
        actor: "webhook",
        label: "voice_webhook_inbound",
        kpis: {
          channel: "voice",
          audio_present: 0,
          has_from: normalizedNumber ? 1 : 0,
          has_status: callStatus ? 1 : 0,
        },
        notes: `VERSION=${VERSION} CallStatus=${callStatus ?? "null"} From=${
          normalizedNumber ?? "null"
        } CallSid=${callSid ?? "null"}`,
      });
    } catch (e) {
      console.error("voice-webhook logEvaluation(inbound) failed", e);
    }
  }

  if (!supabase) {
    // No podemos escribir estado, pero devolvemos TwiML vacío para no romper Twilio
    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
  }

  if (!normalizedNumber) {
    console.error("voice-webhook: missing caller number");
    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
  }

  const { data: lead, error } = await supabase
    .from("leads")
    .select("id")
    .eq("phone", normalizedNumber)
    .maybeSingle();

  if (error) console.error("voice-webhook: lead lookup error", error);

  // Si hay lead y el status indica que respondieron/contestaron -> engaged
  if (lead && callStatus && ["completed", "in-progress", "answered"].includes(callStatus)) {
    try {
      await setLeadState({
        supabase,
        leadId: lead.id,
        newState: "engaged",
        reason: "inbound_response",
        actor: "dispatcher",
        source: "voice-webhook",
        meta: {
          version: VERSION,
          channel: "voice",
          twilio_call_sid: callSid,
          call_status: callStatus,
          from: normalizedNumber,
        },
      });
    } catch (e) {
      console.error("voice-webhook: setLeadState failed", e);
    }
  }

  return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
});
