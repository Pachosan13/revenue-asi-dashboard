import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // 🔴 obligatorio
)

type WebhookLead = {
  name?: string | null
  email?: string | null
  phone?: string | null
  company_name?: string | null
  website?: string | null
}

type WebhookPayload = {
  source?: string
  confirm?: boolean
  account_id?: string | null // ✅ NUEVO: para multi-tenant
  campaign_id?: string | null
  campaign_name?: string | null
  leads?: WebhookLead[]
}

async function resolveAccountId(payload: WebhookPayload): Promise<string | null> {
  if (payload.account_id) return payload.account_id

  if (payload.campaign_id) {
    const { data, error } = await supabase
      .from("campaigns")
      .select("account_id")
      .eq("id", payload.campaign_id)
      .single()

    if (error) {
      console.error("❌ resolveAccountId campaigns lookup error", error)
      return null
    }
    return data?.account_id ?? null
  }

  return null
}

export async function handleWebhookIntake(payload: WebhookPayload) {
  const leads = payload.leads ?? []

  if (!leads.length) {
    return { ok: false, error: "No leads provided" }
  }

  const accountId = await resolveAccountId(payload)
  if (!accountId) {
    return {
      ok: false,
      error:
        "Missing account_id. Provide payload.account_id OR payload.campaign_id (so we can infer account_id).",
    }
  }

  const insertedLeadIds: string[] = []
  const errors: any[] = []

  for (const lead of leads) {
    try {
      if (!lead.email && !lead.phone) continue

      // 1) INSERT LEAD (NO UPSERT)
      const { data: leadRow, error: leadErr } = await supabase
        .from("leads")
        .insert({
          account_id: accountId, // ✅ REQUIRED
          contact_name: lead.name ?? null, // ✅ schema real
          email: lead.email ?? null,
          phone: lead.phone ?? null,
          company_name: lead.company_name ?? null,
          website: lead.website ?? null,
          source: payload.source ?? "webhook",
          status: "new",
        })
        .select("id")
        .single()

      if (leadErr || !leadRow) {
        console.error("❌ Lead insert error", leadErr)
        throw leadErr
      }

      const lead_id = leadRow.id
      insertedLeadIds.push(lead_id)

      // 2) LINK A CAMPAÑA (si existe)
      if (payload.campaign_id) {
        const { error: clErr } = await supabase.from("campaign_leads").insert({
          account_id: accountId, // ✅ tu schema lo tiene
          lead_id,
          campaign_id: payload.campaign_id,
          status: "enrolled",
          source: payload.source ?? "webhook",
        })

        if (clErr) {
          console.error("❌ campaign_leads insert error", clErr)
          // no matamos todo por esto; seguimos
        }
      }

      // 3) EMIT INBOX EVENT (fuente operativa de UI)
      // Nota: si inbox_events NO tiene account_id, quita esa línea.
      const { error: inboxErr } = await supabase.from("inbox_events").insert({
        // account_id: accountId, // <-- descomenta SOLO si existe la columna
        lead_id,
        lead_state: "new",
        campaign_id: payload.campaign_id ?? null,
        campaign_name: payload.campaign_name ?? null,
        channel_last: "webhook",
        source: payload.source ?? "webhook",
      })

      if (inboxErr) {
        console.error("❌ inbox_events insert error", inboxErr)
        // tampoco matamos todo; el lead ya existe
      }
    } catch (e: any) {
      errors.push({
        lead,
        error: e?.message ?? String(e),
      })
    }
  }

  return {
    ok: errors.length === 0,
    source: payload.source ?? "webhook",
    received: leads.length,
    inserted: insertedLeadIds.length,
    lead_ids: insertedLeadIds,
    errors,
  }
}
