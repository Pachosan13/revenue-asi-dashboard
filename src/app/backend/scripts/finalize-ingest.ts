// app/backend/scripts/finalize-ingest.ts
import "dotenv/config"
import { createClient } from "@supabase/supabase-js"

type SummaryRow = {
  total: number
  missing_status: number
  missing_brain_score: number
  missing_brain_bucket: number
  missing_state: number
}

function env(name: string, required = true): string {
  const v = process.env[name]
  if (!v && required) throw new Error(`Missing env var: ${name}`)
  return v ?? ""
}

function boolEnv(name: string, defaultValue: boolean): boolean {
  const v = process.env[name]
  if (v === undefined) return defaultValue
  return ["1", "true", "yes", "y", "on"].includes(String(v).toLowerCase())
}

async function main() {
  const SUPABASE_URL = env("SUPABASE_URL")
  const SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY")
  const ACCOUNT_ID = env("ACCOUNT_ID")

  const DRY_RUN = boolEnv("DRY_RUN", true)
  const DEFAULT_STATUS = process.env.DEFAULT_STATUS ?? "new"
  const DEFAULT_BUCKET = process.env.DEFAULT_BUCKET ?? "cold"
  const DEFAULT_BRAIN_SCORE = Number(process.env.DEFAULT_BRAIN_SCORE ?? 0)

  // IMPORTANTE: state es enum. Default: "new". Si tu enum no tiene "new", el script lo intentará y,
  // si falla, NO rompe: lo reporta y sigue.
  const DEFAULT_STATE = process.env.DEFAULT_STATE ?? "new"

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  console.log("🚀 finalize-ingest", {
    ACCOUNT_ID,
    DRY_RUN,
    DEFAULT_STATUS,
    DEFAULT_BUCKET,
    DEFAULT_BRAIN_SCORE,
    DEFAULT_STATE,
  })

  const getSummary = async (): Promise<SummaryRow> => {
    // Usamos una query precisa con PostgREST: traemos columnas mínimas y contamos en memoria.
    const { data, error } = await supabase
      .from("leads")
      .select("status,lead_brain_score,lead_brain_bucket,state", { count: "exact" })
      .eq("account_id", ACCOUNT_ID)

    if (error) throw new Error(`summary: ${error.message}`)

    const rows = data ?? []
    const total = rows.length

    let missing_status = 0
    let missing_brain_score = 0
    let missing_brain_bucket = 0
    let missing_state = 0

    for (const r of rows as any[]) {
      if (r.status == null) missing_status++
      if (r.lead_brain_score == null) missing_brain_score++
      if (r.lead_brain_bucket == null) missing_brain_bucket++
      if (r.state == null) missing_state++
    }

    return {
      total,
      missing_status,
      missing_brain_score,
      missing_brain_bucket,
      missing_state,
    }
  }

  const before = await getSummary()
  console.log("📊 BEFORE", before)

  if (DRY_RUN) {
    console.log("🟡 DRY_RUN=true -> no updates executed.")
    return
  }

  // 1) Finalize core defaults (idempotente)
  // Nota: PostgREST no permite COALESCE directo. Entonces hacemos updates por condición.
  // status
  {
    const { error } = await supabase
      .from("leads")
      .update({ status: DEFAULT_STATUS, updated_at: new Date().toISOString() })
      .eq("account_id", ACCOUNT_ID)
      .is("status", null)
    if (error) throw new Error(`update status: ${error.message}`)
  }

  // lead_brain_score
  {
    const { error } = await supabase
      .from("leads")
      .update({
        lead_brain_score: DEFAULT_BRAIN_SCORE,
        updated_at: new Date().toISOString(),
      })
      .eq("account_id", ACCOUNT_ID)
      .is("lead_brain_score", null)
    if (error) throw new Error(`update lead_brain_score: ${error.message}`)
  }

  // lead_brain_bucket
  {
    const { error } = await supabase
      .from("leads")
      .update({ lead_brain_bucket: DEFAULT_BUCKET, updated_at: new Date().toISOString() })
      .eq("account_id", ACCOUNT_ID)
      .is("lead_brain_bucket", null)
    if (error) throw new Error(`update lead_brain_bucket: ${error.message}`)
  }

  // 2) State align (seguro: solo null). Si falla enum, no rompe el pipeline.
  {
    const { error } = await supabase
      .from("leads")
      .update({ state: DEFAULT_STATE as any, updated_at: new Date().toISOString() })
      .eq("account_id", ACCOUNT_ID)
      .is("state", null)

    if (error) {
      console.log(
        "⚠️ state update skipped (enum mismatch or restriction). Error:",
        error.message,
      )
    }
  }

  const after = await getSummary()
  console.log("✅ AFTER", after)

  // Guardrail: si algo quedó null, fallamos duro.
  if (
    after.missing_status !== 0 ||
    after.missing_brain_score !== 0 ||
    after.missing_brain_bucket !== 0 ||
    after.missing_state !== 0
  ) {
    throw new Error(
      `Finalize incomplete: ${JSON.stringify(after)} (some required fields still null)`,
    )
  }

  console.log("🏁 finalize-ingest OK — leads listos para brain/next_action.")
}

main().catch((err) => {
  console.error("❌ finalize-ingest failed:", err?.message ?? err)
  process.exit(1)
})
