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
  executed_at: string | null
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

  let finalized = new Set<string>()
  const claimed: TouchRun[] = []
  try {
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

    claimed.push(...((runs ?? []) as TouchRun[]))

  async function mark(id: string, patch: Record<string, any>) {
    const { error } = await supabase.from("touch_runs").update(patch).eq("id", id)
    if (error) throw new Error(`mark_failed:${id}:${error.message}`)
  }

  async function emitEvent(run: TouchRun, event: string, payload: any) {
    const { error } = await supabase.from("dispatch_events").insert({
      touch_run_id: run.id,
      account_id: run.account_id,
      channel: run.channel,
      provider: channelFn(run.channel),
      event,
      payload,
    })
    if (error) throw new Error(`dispatch_events_insert_failed:${run.id}:${error.message}`)
  }

    // emit claim event per run
    for (const run of claimed) {
      await emitEvent(run, "claim", { at: nowIso(), status: run.status, executed_at: run.executed_at ?? null })
    }

  type DispatcherResult = {
    ok: boolean
    processed: number
    failed: number
    processed_ids: string[]
    failed_ids: string[]
    errors?: any[]
  }

  async function invokeBatch(fn: string, batchRuns: TouchRun[]) {
    const started = Date.now()
    for (const run of batchRuns) {
      await emitEvent(run, "invoke_start", { at: nowIso(), fn, dry_run: DRY_RUN })
    }

    const body = {
      touch_run_ids: batchRuns.map((r) => r.id),
      dry_run: DRY_RUN,
      batch: BATCH,
      concurrency: CONCURRENCY,
    }

    const res = await supabase.functions.invoke(fn, { body })
    const ms = Date.now() - started

    // invoke_end per run (store truncated payload)
    for (const run of batchRuns) {
      await emitEvent(run, "invoke_end", {
        at: nowIso(),
        fn,
        ms,
        ok: !res.error,
        error: res.error?.message ?? null,
        result: res.error ? null : (res.data ?? null),
      })
    }

    if (res.error) {
      return {
        ok: false,
        processed: 0,
        failed: batchRuns.length,
        processed_ids: [],
        failed_ids: batchRuns.map((r) => r.id),
        errors: [{ error: res.error.message }],
      } satisfies DispatcherResult
    }

    const data = (res.data ?? {}) as Partial<DispatcherResult>
    const processed_ids = Array.isArray(data.processed_ids) ? data.processed_ids : []
    const failed_ids = Array.isArray(data.failed_ids) ? data.failed_ids : []
    const ok = Boolean(data.ok)

    return {
      ok,
      processed: Number(data.processed ?? processed_ids.length ?? 0),
      failed: Number(data.failed ?? failed_ids.length ?? 0),
      processed_ids,
      failed_ids,
      errors: Array.isArray(data.errors) ? data.errors : [],
    } satisfies DispatcherResult
  }

  // 2️⃣ DISPATCH POR CANAL (batch, source-of-truth en dispatcher)
  const byChannel = new Map<string, TouchRun[]>()
  for (const run of runs as TouchRun[]) {
    const arr = byChannel.get(run.channel) ?? []
    arr.push(run)
    byChannel.set(run.channel, arr)
  }

  const allResults: any[] = []
  let processedTotal = 0
  let failedTotal = 0

    for (const [channel, group] of byChannel.entries()) {
    const fn = channelFn(channel)
    const r = await invokeBatch(fn, group)
    allResults.push({ channel, fn, ...r })

    const processedSet = new Set(r.processed_ids ?? [])

    // finalize per run
      for (const run of group) {
      const isProcessed = processedSet.has(run.id)
      if (isProcessed) {
        processedTotal++
        await emitEvent(run, "finalize_ok", { at: nowIso(), fn })
        // Do not overwrite status; dispatcher owns status transitions.
        await mark(run.id, { execution_ms: null, error: null, updated_at: nowIso() })
          finalized.add(run.id)
        continue
      }

      failedTotal++
      const nextRetry = (run.retry_count ?? 0) + 1
      const max = run.max_retries ?? 3
      const baseErr = (r.errors && r.errors.length ? JSON.stringify(r.errors).slice(0, 800) : null) ?? null
      const errMsg = r.processed_ids?.length === 0 ? "dispatcher_processed_0" : (baseErr ? `dispatcher_failed:${baseErr}` : "dispatcher_failed")

      await emitEvent(run, "finalize_fail", { at: nowIso(), fn, error: errMsg, retry: nextRetry, max })

      if (nextRetry <= max) {
        await mark(run.id, {
          status: "queued",
          retry_count: nextRetry,
          scheduled_at: new Date(Date.now() + 60_000).toISOString(),
          error: errMsg,
          updated_at: nowIso(),
        })
      } else {
        await mark(run.id, {
          status: "failed",
          retry_count: nextRetry,
          error: errMsg,
          updated_at: nowIso(),
        })
      }
        finalized.add(run.id)
    }
  }

  return Response.json({
    ok: true,
    dry_run: DRY_RUN,
      claimed: claimed.length,
    processed: processedTotal,
    failed: failedTotal,
    results: allResults,
  })
  } catch (e: any) {
    // Safety net: never leave claimed runs stuck in executing if engine throws.
    const msg = String(e?.message ?? e)
    const now = nowIso()
    for (const run of claimed) {
      if (finalized.has(run.id)) continue
      try {
        await supabase
          .from("touch_runs")
          .update({
            status: "queued",
            error: `dispatch_engine_fatal:${msg}`.slice(0, 200),
            scheduled_at: new Date(Date.now() + 60_000).toISOString(),
            updated_at: now,
          })
          .eq("id", run.id)
      } catch {}
    }
    return Response.json({ ok: false, stage: "dispatch_engine_fatal", error: msg }, { status: 500 })
  }
})
