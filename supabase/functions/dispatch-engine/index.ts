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
      return "dispatch-touch-email" // si no existe, cámbialo
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

  // 1) fetch due queued
  const { data: due, error: dueErr } = await supabase
    .from("touch_runs")
    .select("id,account_id,lead_id,channel,step,status,scheduled_at,payload,meta,retry_count,max_retries")
    .eq("status", "queued")
    .lte("scheduled_at", nowIso())
    .order("scheduled_at", { ascending: true })
    .limit(BATCH)

  if (dueErr) return Response.json({ ok: false, stage: "fetch_due", error: dueErr.message }, { status: 500 })

  const runs = (due ?? []) as TouchRun[]
  if (!runs.length) return Response.json({ ok: true, processed: 0, claimed: 0, dry_run: DRY_RUN })

  // 2) claim atomico (si otro worker ya los tomó, no regresan)
  const ids = runs.map((r) => r.id)
  const { data: claimedRows, error: claimErr } = await supabase
    .from("touch_runs")
    .update({ status: "executing", executed_at: nowIso() })
    .in("id", ids)
    .eq("status", "queued")
    .select("id")

  if (claimErr) return Response.json({ ok: false, stage: "claim", error: claimErr.message }, { status: 500 })

  const claimedIds = new Set((claimedRows ?? []).map((r: any) => r.id))
  const claimed = runs.filter((r) => claimedIds.has(r.id))
  if (!claimed.length) return Response.json({ ok: true, processed: 0, claimed: 0, dry_run: DRY_RUN })

  async function mark(id: string, patch: Record<string, any>) {
    const { error } = await supabase.from("touch_runs").update(patch).eq("id", id)
    if (error) console.error("mark failed", id, error.message)
  }

  async function invoke(run: TouchRun) {
    const started = Date.now()

    // contrato recomendado: touch_run_id manda todo lo demás lo puedes derivar
    const payload = {
      touch_run_id: run.id,
      lead_id: run.lead_id,
      account_id: run.account_id,
      step: run.step ?? 1,
      channel: run.channel,
      dry_run: DRY_RUN,
    }

    const fn = channelFn(run.channel)

    const res = await supabase.functions.invoke(fn, { body: payload })

    const ms = Date.now() - started

    if (res.error) {
      await mark(run.id, {
        status: "failed",
        error: res.error.message,
        execution_ms: ms,
        meta: { ...(run.meta ?? {}), dispatch_engine: { at: nowIso(), fn, dry_run: DRY_RUN } },
      })
      return { ok: false, id: run.id, fn, error: res.error.message }
    }

    // Si tu function ya marca touch_runs, igual esto no rompe (idempotente si estado final es mismo)
    await mark(run.id, {
      status: DRY_RUN ? "simulated" : "sent",
      sent_at: DRY_RUN ? null : nowIso(),
      execution_ms: ms,
      error: null,
      meta: {
        ...(run.meta ?? {}),
        dispatch_engine: { at: nowIso(), fn, dry_run: DRY_RUN },
        function_result: res.data ?? null,
      },
    })

    return { ok: true, id: run.id, fn }
  }

  // 3) pool
  let i = 0
  const results: any[] = []
  const workers = Array.from({ length: Math.min(CONCURRENCY, claimed.length) }).map(async () => {
    while (i < claimed.length) {
      const run = claimed[i++]
      results.push(await invoke(run))
    }
  })
  await Promise.all(workers)

  const processed = results.filter((r) => r.ok).length
  const failed = results.filter((r) => !r.ok).length

  return Response.json({
    ok: true,
    dry_run: DRY_RUN,
    fetched_due: runs.length,
    claimed: claimed.length,
    processed,
    failed,
    results,
  })
})
