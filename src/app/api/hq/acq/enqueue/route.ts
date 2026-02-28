import { NextResponse } from "next/server"
import { createServiceRoleClient } from "@/app/api/_lib/createUserClientFromJwt"
import { resolveActiveAccountFromJwt } from "@/app/api/_lib/resolveActiveAccount"

export const dynamic = "force-dynamic"

type ProspectRow = {
  dealer_url: string
  email: string | null
  city: string | null
  vdp_count: number | null
}

function clean(v: unknown) {
  if (typeof v !== "string") return null
  const x = v.trim()
  return x.length ? x : null
}

function isValidEmail(v: string | null) {
  if (!v) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

function makeBody({
  dealerUrl,
  clickUrl,
  calendlyLink,
}: {
  dealerUrl: string
  clickUrl: string
  calendlyLink: string
}) {
  const body_html =
    `<p>Hola,</p>` +
    `<p>Vimos actividad de inventario en tu dealer y creemos que podemos ayudarte a generar más citas calificadas.</p>` +
    `<p>Dealer: ${dealerUrl}</p>` +
    `<p><a href="${clickUrl}">Ver disponibilidad y agendar</a></p>` +
    `<p>Si prefieres, puedes abrir Calendly directo: <a href="${calendlyLink}">${calendlyLink}</a></p>`

  const body_text =
    `Hola,\n\n` +
    `Vimos actividad de inventario en tu dealer y creemos que podemos ayudarte a generar más citas calificadas.\n` +
    `Dealer: ${dealerUrl}\n` +
    `Agendar: ${clickUrl}\n` +
    `Calendly directo: ${calendlyLink}\n`

  return { body_html, body_text }
}

export async function POST(req: Request) {
  const auth = await resolveActiveAccountFromJwt(req)
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })

  const body = await req.json().catch(() => ({}))
  const min_vdp_count = Math.max(1, Number(body?.min_vdp_count ?? 20))
  const limit = Math.max(1, Math.min(500, Number(body?.limit ?? 100)))

  const calendlyLink = process.env.CALENDLY_LINK || "https://calendly.com"
  const origin = new URL(req.url).origin

  const supabase = createServiceRoleClient()

  const { data: campaignRow, error: campaignErr } = await supabase
    .from("campaigns")
    .upsert(
      {
        account_id: auth.account_id,
        name: "HQ Dealers Outreach",
        campaign_key: "hq_dealers_outreach_email",
        status: "active",
        type: "outbound",
      },
      { onConflict: "account_id,campaign_key" },
    )
    .select("id")
    .single()
  if (campaignErr || !campaignRow?.id) {
    return NextResponse.json({ ok: false, stage: "campaign_upsert", error: campaignErr?.message || "campaign not available" }, { status: 500 })
  }

  const { data: prospects, error: prospectsErr } = await supabase
    .from("hq_dealer_prospects")
    .select("dealer_url,email,city,vdp_count")
    .eq("account_id", auth.account_id)
    .gte("vdp_count", min_vdp_count)
    .not("email", "is", null)
    .order("vdp_count", { ascending: false })
    .limit(limit)
  if (prospectsErr) {
    return NextResponse.json({ ok: false, stage: "load_prospects", error: prospectsErr.message }, { status: 500 })
  }

  const candidateProspects = (prospects ?? []).filter((p) => isValidEmail(clean((p as ProspectRow).email)))
  if (!candidateProspects.length) {
    return NextResponse.json({ ok: true, queued: 0, skipped: 0, reason: "no_eligible_prospects" })
  }

  const dealerUrls = Array.from(new Set(candidateProspects.map((p: any) => String(p.dealer_url))))
  const { data: sentRows, error: sentErr } = await supabase
    .from("hq_dealer_outreach")
    .select("dealer_url")
    .eq("account_id", auth.account_id)
    .not("sent_at", "is", null)
    .in("dealer_url", dealerUrls)
  if (sentErr) {
    return NextResponse.json({ ok: false, stage: "load_sent_outreach", error: sentErr.message }, { status: 500 })
  }

  const alreadySent = new Set((sentRows ?? []).map((r: any) => String(r.dealer_url)))
  const toQueue = candidateProspects.filter((p: any) => !alreadySent.has(String(p.dealer_url)))
  if (!toQueue.length) {
    return NextResponse.json({ ok: true, queued: 0, skipped: candidateProspects.length, reason: "already_sent" })
  }

  const nowIso = new Date().toISOString()

  const leadUpserts = toQueue.map((p: any) => {
    const dealerUrl = String(p.dealer_url)
    return {
      account_id: auth.account_id,
      source: "hq_dealers",
      external_id: `hq_dealer:${dealerUrl}`,
      contact_name: dealerUrl,
      email: clean(p.email),
      city: clean(p.city),
      url: dealerUrl,
      raw: { hq_dealer: { dealer_url: dealerUrl, vdp_count: p.vdp_count ?? 0 } },
      updated_at: nowIso,
    }
  })

  const { data: leads, error: leadsErr } = await supabase
    .from("leads")
    .upsert(leadUpserts, { onConflict: "account_id,source,external_id" })
    .select("id,external_id")
  if (leadsErr) {
    return NextResponse.json({ ok: false, stage: "upsert_leads", error: leadsErr.message }, { status: 500 })
  }

  const leadByExternalId = new Map<string, string>()
  for (const row of leads ?? []) {
    const externalId = String((row as any).external_id || "")
    const leadId = String((row as any).id || "")
    if (externalId && leadId) leadByExternalId.set(externalId, leadId)
  }

  const outreachRows: any[] = []
  const touchRunRows: any[] = []
  let skipped = 0

  for (const p of toQueue) {
    const dealerUrl = String((p as any).dealer_url)
    const externalId = `hq_dealer:${dealerUrl}`
    const leadId = leadByExternalId.get(externalId)
    const toEmail = clean((p as any).email)
    if (!leadId || !toEmail) {
      skipped += 1
      continue
    }

    const token = crypto.randomUUID().replace(/-/g, "")
    const clickUrl = `${origin}/api/hq/acq/click?token=${encodeURIComponent(token)}`
    const content = makeBody({ dealerUrl, clickUrl, calendlyLink })

    outreachRows.push({
      account_id: auth.account_id,
      dealer_url: dealerUrl,
      token,
      sent_at: nowIso,
    })

    touchRunRows.push({
      account_id: auth.account_id,
      campaign_id: campaignRow.id,
      lead_id: leadId,
      step: 1,
      channel: "email",
      status: "queued",
      scheduled_at: nowIso,
      payload: {
        subject: "Genera mas citas para tu dealer",
        body_html: content.body_html,
        body_text: content.body_text,
        to_email: toEmail,
      },
      meta: {
        source: "hq.acq.enqueue",
        dealer_url: dealerUrl,
        token,
      },
    })
  }

  if (outreachRows.length) {
    const { error: outreachErr } = await supabase
      .from("hq_dealer_outreach")
      .upsert(outreachRows, { onConflict: "account_id,dealer_url" })
    if (outreachErr) {
      return NextResponse.json({ ok: false, stage: "insert_outreach", error: outreachErr.message }, { status: 500 })
    }
  }

  if (touchRunRows.length) {
    const { error: touchErr } = await supabase
      .from("touch_runs")
      .upsert(touchRunRows, { onConflict: "lead_id,campaign_id,step,channel" })
    if (touchErr) {
      await supabase
        .from("hq_dealer_outreach")
        .update({ sent_at: null, updated_at: nowIso })
        .eq("account_id", auth.account_id)
        .in(
          "dealer_url",
          touchRunRows.map((r) => String((r.meta as any)?.dealer_url || "")).filter((x) => x.length > 0),
        )
      return NextResponse.json({ ok: false, stage: "upsert_touch_runs", error: touchErr.message }, { status: 500 })
    }
  }

  return NextResponse.json({
    ok: true,
    account_id: auth.account_id,
    campaign_id: campaignRow.id,
    min_vdp_count,
    requested_limit: limit,
    candidates: candidateProspects.length,
    queued: touchRunRows.length,
    skipped,
  })
}
