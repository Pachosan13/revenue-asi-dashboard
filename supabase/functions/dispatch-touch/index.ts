import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function sendTwilioWhatsApp(to: string, body: string) {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const token = Deno.env.get("TWILIO_AUTH_TOKEN")!;
  const from = Deno.env.get("TWILIO_WHATSAPP_FROM")!; // e.g. "whatsapp:+14155238886"

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const form = new URLSearchParams();
  form.set("From", from);
  form.set("To", `whatsapp:${to}`);
  form.set("Body", body);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + btoa(`${sid}:${token}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: touches } = await supabase
    .from("touch_runs")
    .select("id, lead_id, channel, payload")
    .eq("status", "queued")
    .lte("scheduled_at", new Date().toISOString())
    .limit(50);

  for (const t of touches ?? []) {
    try {
      await supabase.from("touch_runs").update({ status: "sending" }).eq("id", t.id);

      // traer lead para phone/email
      const { data: lead } = await supabase.from("leads").select("*").eq("id", t.lead_id).single();

      const msg = t.payload?.message ?? "";
      if (t.channel === "whatsapp") {
        await sendTwilioWhatsApp(lead.phone, msg);
      }
      // TODO: sms, email, call

      await supabase.from("touch_runs")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", t.id);

    } catch (e) {
      await supabase.from("touch_runs")
        .update({ status: "failed", error: String(e) })
        .eq("id", t.id);
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: touches?.length ?? 0 }), { status: 200 });
});
