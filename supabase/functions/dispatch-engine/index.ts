import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1"

type TouchRun = {
  id: string
  account_id: string
  lead_id: string
  channel: string
  step: number | null
  status: string
  scheduled_at: string
  payload: any
  meta: any
  retry_count: number | null
  max_retries: number | null
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

function nowIso() {
  return new Date().toISOString()
}

// mapping exacto a tus edge functions existentes
function channelFn(channel: string) {
  switch (channel) {
    case "email":
      return "dispatch-touch-email"
    case "sms":
      return "dispatch-touch-sms"
    case "whatsapp":
      return "dispatch-touch-whatsapp-v2"
    case "voice":
      return "dispatch-touch-voice-v5"
    default:
      return "dispatch-touch"
  }
}

serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  // args
  let body: any = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const DRY_RUN = Boolean(body?.dry_run ?? false)
  const BATCH = Math.min(Math.max(Number(body?.batch ?? 25), 1), 200)
  const CONCURRENCY = Math.min(Math.max(Number(body?.concurrency ?? 5), 1), 25)

  // 1️⃣ CLAIM SEGURO (RPC con FOR UPDATE SKIP LOCKED)
  const { data: runs, error: claimErr } = await supabase.rpc("claim_touch_runs", {
    p_limit: BATCH,
  })

  if (claimErr) {
    return Response.json(
      { ok: false, stage: "claim_touch_runs", error: claimErr.message },
      { status: 500 }
    )
  }

  if (!runs || runs.length === 0) {
    return Response.json({ ok: true, claimed: 0, processed: 0, dry_run: DRY_RUN })
  }

  async function mark(id: string, patch: Record<string, any>) {
    const { error } = await supabase.from("touch_runs").update(patch).eq("id", id)
    if (error) console.error("mark failed", id, error.message)
  }

  async function emitEvent(run: TouchRun, event: "sent" | "failed", payload: any) {
    const { error } = await supabase.from("dispatch_events").insert({
      touch_run_id: run.id,
      account_id: run.account_id,
      channel: run.channel,
      provider: channelFn(run.channel),
      event,
      payload,
    })
    if (error) console.error("dispatch_events insert failed", error.message)
  }

  async function invoke(run: TouchRun) {
    const started = Date.now()
    const fn = channelFn(run.channel)

    const payload = {
      touch_run_id: run.id,
      lead_id: run.lead_id,
      account_id: run.account_id,
      step: run.step ?? 1,
      channel: run.channel,
      dry_run: DRY_RUN,
    }

    const res = await supabase.functions.invoke(fn, { body: payload })
    const ms = Date.now() - started

    // ❌ FAIL
    if (res.error) {
      const nextRetry = (run.retry_count ?? 0) + 1
      const max = run.max_retries ?? 3

      await emitEvent(run, "failed", {
        error: res.error.message,
        execution_ms: ms,
        retry: nextRetry,
        dry_run: DRY_RUN,
      })

      if (nextRetry <= max) {
        await mark(run.id, {
          status: "queued",
          retry_count: nextRetry,
          scheduled_at: new Date(Date.now() + 60_000).toISOString(),
          execution_ms: ms,
          error: res.error.message,
        })
      } else {
        await mark(run.id, {
          status: "failed",
          retry_count: nextRetry,
          execution_ms: ms,
          error: res.error.message,
        })
      }

      return { ok: false, id: run.id, fn, error: res.error.message }
    }

    // ✅ SUCCESS
    await mark(run.id, {
      status: DRY_RUN ? "simulated" : "sent",
      sent_at: DRY_RUN ? null : nowIso(),
      execution_ms: ms,
      error: null,
    })

    await emitEvent(run, "sent", {
      execution_ms: ms,
      dry_run: DRY_RUN,
      function_result: res.data ?? null,
    })

    return { ok: true, id: run.id, fn }
  }

  // 2️⃣ POOL DE EJECUCIÓN
  let i = 0
  const results: any[] = []

  const workers = Array.from({
    length: Math.min(CONCURRENCY, runs.length),
  }).map(async () => {
    while (i < runs.length) {
      const run = runs[i++]
      results.push(await invoke(run))
    }
  })

  await Promise.all(workers)

  const processed = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok).length

  return Response.json({
    ok: true,
    dry_run: DRY_RUN,
    claimed: runs.length,
    processed,
    failed,
    results,
  })
})
