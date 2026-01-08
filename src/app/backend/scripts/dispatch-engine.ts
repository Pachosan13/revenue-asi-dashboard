import "dotenv/config"
import { createClient } from "@supabase/supabase-js"

type TouchRun = {
  id: string
  account_id: string
  lead_id: string
  channel: string
  step: number
  status: string
  scheduled_at: string
  payload: any
  meta: any
  retry_count: number | null
  max_retries: number | null
}

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const BATCH = Math.min(Math.max(Number(process.env.DISPATCH_BATCH ?? 25), 1), 200)
const CONCURRENCY = Math.min(Math.max(Number(process.env.DISPATCH_CONCURRENCY ?? 5), 1), 25)
const DRY_RUN = (process.env.DRY_RUN ?? "true").toLowerCase() === "true"

function nowIso() {
  return new Date().toISOString()
}

function keyPrefix(k?: string | null) {
  return (k ?? "").slice(0, 8)
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.log("SUPABASE_URL", SUPABASE_URL)
  console.log("SERVICE_KEY_PREFIX", keyPrefix(SUPABASE_SERVICE_ROLE_KEY))
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (set them in ./src/app/backend/.env)")
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

async function sanityQueuedDueSample() {
  const { data, error } = await supabase
    .from("touch_runs")
    .select("id,channel,status,scheduled_at,created_at")
    .eq("status", "queued")
    .lte("scheduled_at", nowIso())
    .order("scheduled_at", { ascending: true })
    .limit(5)

  if (error) throw new Error(`sanity: ${error.message}`)

  return {
    now: nowIso(),
    sample_count: data?.length ?? 0,
    sample: data ?? [],
  }
}

async function fetchDueQueued(limit: number): Promise<TouchRun[]> {
  const { data, error } = await supabase
    .from("touch_runs")
    .select("id,account_id,lead_id,channel,step,status,scheduled_at,payload,meta,retry_count,max_retries")
    .eq("status", "queued")
    .lte("scheduled_at", nowIso())
    .order("scheduled_at", { ascending: true })
    .limit(limit)

  if (error) throw new Error(`fetchDueQueued: ${error.message}`)
  return (data ?? []) as TouchRun[]
}

async function claim(ids: string[]): Promise<string[]> {
  if (!ids.length) return []
  const { data, error } = await supabase
    .from("touch_runs")
    .update({ status: "executing", executed_at: nowIso() })
    .in("id", ids)
    .eq("status", "queued")
    .select("id")

  if (error) throw new Error(`claim: ${error.message}`)
  return (data ?? []).map((r: any) => r.id)
}

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

async function mark(id: string, patch: Record<string, any>) {
  const { error } = await supabase.from("touch_runs").update(patch).eq("id", id)
  if (error) console.error("mark failed", id, error.message)
}

async function invokeDispatch(run: TouchRun) {
  const started = Date.now()

  const body = {
    touch_run_id: run.id,
    lead_id: run.lead_id,
    account_id: run.account_id,
    step: run.step,
    channel: run.channel,
    dry_run: DRY_RUN,
  }

  let fn = "dispatch-touch"
  let res = await supabase.functions.invoke(fn, { body })

  if (res.error) {
    fn = channelFn(run.channel)
    res = await supabase.functions.invoke(fn, { body })
  }

  const ms = Date.now() - started

  if (res.error) {
    await mark(run.id, {
      status: "failed",
      error: res.error.message,
      execution_ms: ms,
      meta: {
        ...(run.meta ?? {}),
        dispatch_engine: { at: nowIso(), fn, dry_run: DRY_RUN },
      },
    })
    return
  }

  await mark(run.id, {
    // NOTE: must comply with touch_runs.status CHECK constraint and MUST NOT
    // pollute success metrics on dry_run.
    status: DRY_RUN ? "canceled" : "sent",
    sent_at: DRY_RUN ? null : nowIso(),
    execution_ms: ms,
    meta: {
      ...(run.meta ?? {}),
      dispatch_engine: { at: nowIso(), fn, dry_run: DRY_RUN },
      simulated: DRY_RUN,
      function_result: res.data ?? null,
    },
  })
}

async function runPool(items: TouchRun[]) {
  let i = 0
  const workers = Array.from({ length: CONCURRENCY }).map(async () => {
    while (i < items.length) {
      const run = items[i++]
      await invokeDispatch(run)
    }
  })
  await Promise.all(workers)
}

async function main() {
  console.log("SUPABASE_URL", SUPABASE_URL)
  console.log("SERVICE_KEY_PREFIX", keyPrefix(SUPABASE_SERVICE_ROLE_KEY))
  console.log("ENV", { BATCH, CONCURRENCY, DRY_RUN })
  console.log("🚀 dispatch-engine start")

  const sanity = await sanityQueuedDueSample()
  console.log("SANITY queued_due sample:", sanity)

  const due = await fetchDueQueued(BATCH)
  console.log("due queued:", due.length)
  if (!due.length) return

  const claimedIds = await claim(due.map((d) => d.id))
  const claimed = due.filter((d) => claimedIds.includes(d.id))
  console.log("claimed:", claimed.length)

  await runPool(claimed)
  console.log("✅ done")
}

main().catch((e) => {
  console.error("❌ fatal", e)
  process.exit(1)
})
