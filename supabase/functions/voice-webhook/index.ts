import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { setLeadState } from "../_shared/state.ts";

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const formData = await req.formData().catch(() => null);
  const callStatus = (formData?.get("CallStatus") as string | null) ?? undefined;
  const fromNumber = (formData?.get("From") as string | null) ?? undefined;
  const callSid = (formData?.get("CallSid") as string | null) ?? undefined;

  // Normalize caller number (strip whatsapp: prefix if present)
  const normalizedNumber = fromNumber?.replace(/^whatsapp:/, "");

  if (!normalizedNumber) {
    console.error("voice-webhook: missing caller number");
    return new Response("<Response></Response>", {
      status: 200,
      headers: { "Content-Type": "application/xml" },
    });
  }

  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("phone", normalizedNumber)
    .maybeSingle();

  // TODO: Extend lookup to other lead identity sources (e.g., lead_enriched) if needed.

  if (lead && callStatus && ["completed", "in-progress", "answered"].includes(callStatus)) {
    await setLeadState({
      supabase,
      leadId: lead.id,
      newState: "engaged",
      reason: "inbound_response",
      actor: "dispatcher",
      source: "voice-webhook",
      meta: { channel: "voice", twilio_call_sid: callSid, call_status: callStatus },
    });
  }

  return new Response("<Response></Response>", {
    status: 200,
    headers: { "Content-Type": "application/xml" },
  });
});
