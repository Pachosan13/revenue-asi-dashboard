// supabase/functions/dispatch-touch-smart-router/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const VERSION = "dispatch-touch-smart-router-v4_2025-12-28_step_plus_one_idempotent"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-revenue-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function nowIso() {
  return new Date().toISOString()
}

function minutesFromNowIso(mins: number) {
  const d = new Date()
  d.setMinutes(d.getMinutes() + Math.max(0, mins || 0))
  return d.toISOString()
}

type Body = {
  lead_id?: string
  step?: number
  dry_run?: boolean
  // opcional pero recomendado: para trazabilidad perfecta
  previous_touch_id?: string | null
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  const SB_URL = Deno.env.get("SUPABASE_URL")
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const REVENUE_SECRET = Deno.env.get("REVENUE_SECRET")

  if (!SB_URL || !SB_KEY) {
    return new Response(
      JSON.stringify({
        ok: false,
        stage: "env",
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
        version: VERSION,
      }),
      { status: 500, headers: corsHeaders },
    )
  }

  // Guard opcional (si lo usas)
  if (REVENUE_SECRET) {
    const got = req.headers.get("x-revenue-secret")
    if (got !== REVENUE_SECRET) {
      return new Response(
        JSON.stringify({
          ok: false,
          stage: "auth",
          error: "invalid_revenue_secret",
          version: VERSION,
        }),
        { status: 401, headers: corsHeaders },
      )
    }
  }

  const supabase = createClient(SB_URL, SB_KEY)

  let body: Body = {}
  try {
    body = (await req.json()) as Body
  } catch {
    body = {}
  }

  const lead_id = body.lead_id
  const current_step = Number(body.step ?? NaN)
  const dry_run = Boolean(body.dry_run ?? false)
  const previous_touch_id = body.previous_touch_id ?? null

  if (!lead_id) {
    return new Response(
      JSON.stringify({
        ok: false,
        stage: "input",
        error: "missing_lead_id",
        version: VERSION,
      }),
      { status: 400, headers: corsHeaders },
    )
  }

  if (!Number.isFinite(current_step) || current_step < 0) {
    return new Response(
      JSON.stringify({
        ok: false,
        stage: "input",
        error: "invalid_step",
        version: VERSION,
      }),
      { status: 400, headers: corsHeaders },
    )
  }

  // ✅ FIX: el router ahora crea el *siguiente* step
  const next_step = current_step + 1

  try {
    // 1) Resolver account_id + campaign_id (desde el touch más reciente del lead)
    const { data: lastTouch, error: ltErr } = await supabase
      .from("touch_runs")
      .select("id, account_id, campaign_id, step, channel, status, created_at")
      .eq("lead_id", lead_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (ltErr) {
      return new Response(
        JSON.stringify({
          ok: false,
          stage: "select_last_touch",
          error: ltErr.message,
          version: VERSION,
        }),
        { status: 500, headers: corsHeaders },
      )
    }

    if (!lastTouch?.account_id || !lastTouch?.campaign_id) {
      return new Response(
        JSON.stringify({
          ok: false,
          stage: "select_last_touch",
          error: "missing_account_or_campaign_on_last_touch",
          version: VERSION,
        }),
        { status: 500, headers: corsHeaders },
      )
    }

    const account_id = lastTouch.account_id as string
    const campaign_id = lastTouch.campaign_id as string

    // 2) Resolver canal recomendado para el próximo step (RPC)
    //    OJO: la RPC recibe step; ahora le pasamos el NEXT_STEP
    const { data: nextChannel, error: chErr } = await supabase
      .rpc("decide_next_channel_for_lead", {
        p_lead_id: lead_id,
        p_step: next_step,
      })
      .maybeSingle()

    if (chErr) {
      return new Response(
        JSON.stringify({
          ok: false,
          stage: "decide_next_channel",
          error: chErr.message,
          version: VERSION,
        }),
        { status: 500, headers: corsHeaders },
      )
    }

    const channel = (nextChannel as unknown as string) || "sms"

    // 3) Traer campaign_step (delay + payload template) para ese step/canal
    //    Si no existe, la campaña se considera "complete" para ese lead.
    const { data: stepRow, error: csErr } = await supabase
      .from("campaign_steps")
      .select("delay_minutes, payload")
      .eq("campaign_id", campaign_id)
      .eq("step", next_step)
      .eq("channel", channel)
      .maybeSingle()

    if (csErr) {
      return new Response(
        JSON.stringify({
          ok: false,
          stage: "select_campaign_step",
          error: csErr.message,
          version: VERSION,
        }),
        { status: 500, headers: corsHeaders },
      )
    }

    if (!stepRow) {
      // No hay más steps definidos para ese canal => fin
      return new Response(
        JSON.stringify({
          ok: true,
          version: VERSION,
          lead_id,
          step: current_step,
          decision: "complete",
          next_channel: null,
          created_touch: false,
          dry_run,
          new_touch_id: null,
          insert_body: null,
        }),
        { headers: corsHeaders },
      )
    }

    const delay_minutes = Number(stepRow.delay_minutes ?? 0)
    const basePayload = (stepRow.payload ?? {}) as Record<string, unknown>

    // 4) Construir routing + payload
    //    Mantén el shape que ya vienes usando (payload.routing)
    const routing = {
      decision: "continue",
      // puedes expandir este bloque si quieres que el router meta fallback completo
      next_channel: channel,
      current_channel: channel,
      attempts_done: 0,
      attempts_allowed: 1,
      cooldown_until: null,
      cooldown_minutes: null,
      fallback: {
        order: ["voice", "whatsapp", "sms", "email"],
        max_attempts: { sms: 2, email: 2, voice: 2, whatsapp: 2 },
        cooldown_minutes: { sms: 120, email: 120, voice: 120, whatsapp: 120 },
      },
    }

    const insert_body: any = {
      account_id,
      campaign_id,
      campaign_run_id: null,
      lead_id,
      step: next_step,
      channel,
      payload: {
        ...basePayload,
        routing,
      },
      scheduled_at: minutesFromNowIso(delay_minutes),
      status: "queued",
      message_class: null,
      meta: {
        router_version: VERSION,
        router_decision: "continue",
        previous_touch_id: previous_touch_id ?? (lastTouch?.id ?? null),
      },
    }

    if (dry_run) {
      // Dry-run: no insert
      return new Response(
        JSON.stringify({
          ok: true,
          version: VERSION,
          lead_id,
          step: current_step,
          decision: "continue",
          next_channel: channel,
          created_touch: false,
          dry_run,
          new_touch_id: null,
          insert_body,
        }),
        { headers: corsHeaders },
      )
    }

    // 5) Insert idempotente (respeta UNIQUE lead_id,campaign_id,step,channel)
    //    Si ya existe, created_touch=false y no inventamos.
    const { data: ins, error: insErr } = await supabase
      .from("touch_runs")
      .upsert(insert_body, {
        onConflict: "lead_id,campaign_id,step,channel",
        ignoreDuplicates: true,
      })
      .select("id")
      .maybeSingle()

    if (insErr) {
      return new Response(
        JSON.stringify({
          ok: false,
          stage: "insert_touch",
          error: insErr.message,
          version: VERSION,
        }),
        { status: 500, headers: corsHeaders },
      )
    }

    const new_touch_id = (ins as any)?.id ?? null
    const created_touch = Boolean(new_touch_id)

    // Si no insertó (porque ya existía), devolvemos decision=already_exists
    if (!created_touch) {
      return new Response(
        JSON.stringify({
          ok: true,
          version: VERSION,
          lead_id,
          step: current_step,
          decision: "already_exists",
          next_channel: channel,
          created_touch: false,
          dry_run,
          new_touch_id: null,
          insert_body,
        }),
        { headers: corsHeaders },
      )
    }

    return new Response(
      JSON.stringify({
        ok: true,
        version: VERSION,
        lead_id,
        step: current_step,
        decision: "continue",
        next_channel: channel,
        created_touch: true,
        dry_run,
        new_touch_id,
        insert_body,
      }),
      { headers: corsHeaders },
    )
  } catch (e: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        stage: "catch",
        error: String(e?.message ?? e),
        version: VERSION,
      }),
      { status: 500, headers: corsHeaders },
    )
  }
})
