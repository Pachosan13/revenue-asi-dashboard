// supabase/functions/eval-test/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { logEvaluation } from "../_shared/eval.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  const SB_URL = Deno.env.get("SUPABASE_URL")
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

  if (!SB_URL || !SB_KEY) {
    return new Response(
      JSON.stringify({
        ok: false,
        stage: "env",
        error: "Missing SUPABASE env vars",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  const supabase = createClient(SB_URL, SB_KEY, {
    auth: { persistSession: false },
  })

  try {
    await logEvaluation(supabase, {
      event_source: "director",
      label: "eval_test_manual",
      kpis: {
        test_metric: 1,
        another_metric: 42,
      },
      notes: "Manual eval test from eval-test function",
    })

    return new Response(
      JSON.stringify({
        ok: true,
        stage: "logged",
        label: "eval_test_manual",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("eval-test error:", msg)

    return new Response(
      JSON.stringify({
        ok: false,
        stage: "logEvaluation",
        error: msg,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }
})
