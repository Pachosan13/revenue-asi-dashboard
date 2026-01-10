import { NextRequest, NextResponse } from "next/server"
import { getAccountContextOrThrow } from "@/app/api/_lib/getAccountContextOrThrow"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function parseRoutingActive(routing: any): boolean {
  return String(routing?.active ?? "").trim() === "true" || routing?.active === true
}

function safeCity(value: any, fallback = "miami") {
  const c = String(value ?? "").trim().toLowerCase()
  return c || fallback
}

function safeRadiusMi(value: any, fallback = 10) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

async function computeTimeToFirstTouchAvgMinutes(args: {
  supabase: any
  accountId: string
  source: string
  maxLeads?: number
}): Promise<number | null> {
  const maxLeads = Math.min(Math.max(Number(args.maxLeads ?? 200), 1), 500)
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data: leads, error: lErr } = await args.supabase
    .from("leads")
    .select("id,created_at")
    .eq("account_id", args.accountId)
    .eq("source", args.source)
    .gte("created_at", since24h)
    .order("created_at", { ascending: false })
    .limit(maxLeads)

  if (lErr) return null
  const leadRows = Array.isArray(leads) ? leads : []
  if (!leadRows.length) return null

  const leadIds = leadRows.map((r: any) => String(r.id)).filter(Boolean)
  const leadCreatedAtById = new Map<string, string>()
  for (const r of leadRows) {
    if (r?.id && r?.created_at) leadCreatedAtById.set(String(r.id), String(r.created_at))
  }

  const { data: trs, error: trErr } = await args.supabase
    .from("touch_runs")
    .select("lead_id,created_at")
    .eq("account_id", args.accountId)
    .in("lead_id", leadIds)
    .gte("created_at", since24h)
    .order("created_at", { ascending: true })
    .limit(5000)

  if (trErr) return null
  const trRows = Array.isArray(trs) ? trs : []
  if (!trRows.length) return null

  const firstTouchAtByLead = new Map<string, string>()
  for (const tr of trRows) {
    const lid = tr?.lead_id ? String(tr.lead_id) : ""
    const createdAt = tr?.created_at ? String(tr.created_at) : ""
    if (!lid || !createdAt) continue
    if (!firstTouchAtByLead.has(lid)) firstTouchAtByLead.set(lid, createdAt)
  }

  let sum = 0
  let n = 0
  for (const [lid, firstTouchAt] of firstTouchAtByLead.entries()) {
    const leadCreatedAt = leadCreatedAtById.get(lid)
    if (!leadCreatedAt) continue
    const a = new Date(leadCreatedAt).getTime()
    const b = new Date(firstTouchAt).getTime()
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue
    const minutes = Math.max(0, (b - a) / 60000)
    sum += minutes
    n += 1
  }

  if (!n) return null
  return Number((sum / n).toFixed(1))
}

export async function GET(req: NextRequest) {
  try {
    const { supabase, accountId } = await getAccountContextOrThrow(req)

    const { data: orgSettings, error: osErr } = await supabase
      .from("org_settings")
      .select("leadgen_routing")
      .limit(1)
      .maybeSingle()
    if (osErr) return NextResponse.json({ ok: false, error: osErr.message }, { status: 500 })

    const routing = (orgSettings as any)?.leadgen_routing as any | null | undefined
    const routingActive = parseRoutingActive(routing)
    const city = safeCity(routing?.city_fallback, "miami")
    const radiusMi = safeRadiusMi(routing?.radius_miles, 10)

    const since60m = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const since15m = new Date(Date.now() - 15 * 60 * 1000).toISOString()

    const [{ data: tasks60, error: tErr }, { count: leads60, error: lErr }, { data: lastDone, error: ldErr }] =
      await Promise.all([
        supabase
          .schema("lead_hunter")
          .from("craigslist_tasks_v1")
          .select("status,task_type,last_error,created_at,updated_at")
          .eq("account_id", accountId)
          .eq("city", city)
          .gte("created_at", since60m)
          .limit(1000),
        supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("account_id", accountId)
          .eq("source", "craigslist")
          .gte("created_at", since60m),
        supabase
          .schema("lead_hunter")
          .from("craigslist_tasks_v1")
          .select("created_at,status")
          .eq("account_id", accountId)
          .eq("city", city)
          .eq("status", "done")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])

    if (tErr) return NextResponse.json({ ok: false, error: tErr.message }, { status: 500 })
    if (lErr) return NextResponse.json({ ok: false, error: lErr.message }, { status: 500 })
    if (ldErr) return NextResponse.json({ ok: false, error: ldErr.message }, { status: 500 })

    const counts = { queued: 0, claimed: 0, done: 0, failed: 0 }
    const recent = Array.isArray(tasks60) ? tasks60 : []
    for (const r of recent) {
      const st = String((r as any)?.status ?? "").trim()
      if (st === "queued") counts.queued++
      else if (st === "claimed") counts.claimed++
      else if (st === "done") counts.done++
      else if (st === "failed") counts.failed++
    }

    const { data: workerRows, error: whErr } = await supabase
      .schema("lead_hunter")
      .from("craigslist_tasks_v1")
      .select("id,status,created_at")
      .eq("account_id", accountId)
      .eq("city", city)
      .in("status", ["claimed", "done"])
      .gte("created_at", since15m)
      .limit(1)

    if (whErr) return NextResponse.json({ ok: false, error: whErr.message }, { status: 500 })

    const workerHealth = Array.isArray(workerRows) && workerRows.length > 0
    const lastSuccessAt = (lastDone as any)?.created_at ?? null

    const programKey = `craigslist:${city}:${radiusMi}mi`

    const disabled = !routingActive || (counts.claimed + counts.done === 0 && recent.length === 0)
    const degraded = routingActive && counts.failed > 0 && counts.done === 0
    const live = routingActive && counts.done > 0
    const status = live ? "live" : degraded ? "degraded" : disabled ? "disabled" : "disabled"

    const tasksDone = counts.done
    const tasksFailed = counts.failed
    const tasksSuccessRate60m =
      tasksDone + tasksFailed > 0 ? Number((tasksDone / (tasksDone + tasksFailed)).toFixed(3)) : null

    const timeToFirstTouchAvgMinutes = await computeTimeToFirstTouchAvgMinutes({
      supabase,
      accountId,
      source: "craigslist",
      maxLeads: 200,
    })

    return NextResponse.json({
      ok: true,
      programs: [
        {
          key: programKey,
          program: "craigslist",
          city,
          radius_mi: radiusMi,
          name: `Craigslist ${city} ${radiusMi}mi`,
          status,
          health: {
            routing_active: routingActive,
            worker_health: workerHealth,
            last_success_at: lastSuccessAt,
          },
          throughput: { tasks_last_60m: { ...counts, total: recent.length } },
          output: { leads_last_60m: leads60 ?? 0 },
          kpis: {
            leads_last_60m: leads60 ?? 0,
            tasks_success_rate_60m: tasksSuccessRate60m,
            time_to_first_touch_avg_minutes: timeToFirstTouchAvgMinutes,
          },
        },
      ],
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown error" }, { status: 500 })
  }
}


