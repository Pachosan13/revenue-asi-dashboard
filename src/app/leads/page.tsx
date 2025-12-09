"use client"

import React, { useEffect, useMemo, useState } from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"

import { supabaseBrowser } from "@/lib/supabase"
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Input,
} from "@/components/ui-custom"
import {
  LeadInboxTable,
  type LeadInboxEntry,
} from "@/components/leads/LeadInboxTable"

type LeadState =
  | "new"
  | "enriched"
  | "attempting"
  | "engaged"
  | "qualified"
  | "booked"
  | "dead"
  | string

type InboxRow = {
  lead_id: string | null
  lead_name: string | null
  lead_email: string | null
  lead_phone: string | null
  lead_state: string | null
  last_step_at: string | null
  campaign_id: string | null
  campaign_name: string | null
  channel_last: string | null
  created_at: string | null
}

const REQUIRED_FIELDS = [
  "lead_id",
  "lead_name",
  "lead_email",
  "lead_phone",
  "lead_state",
  "last_step_at",
  "campaign_id/name",
  "channel_last",
]

const STATE_FILTERS: (LeadState | "All")[] = [
  "All",
  "new",
  "enriched",
  "attempting",
  "engaged",
  "qualified",
  "booked",
  "dead",
]

// Mock para cuando no hay Supabase en frontend
const MOCK_LEADS: LeadInboxEntry[] = [
  {
    id: "MOCK-1001",
    name: "Ana Ruiz",
    email: "ana.ruiz@example.com",
    phone: "+34 600 111 222",
    state: "new",
    last_touch_at: "2024-11-02T10:15:00Z",
    campaign_id: "CMP-42",
    campaign_name: "Q4 Retail Push",
    channel_last: "email",
    created_at: "2024-11-01T08:00:00Z",
    lead_brain_score: 52,
    lead_brain_bucket: "warm",
    attempts_total: 3,
    distinct_channels: 2,
    errors_total: 0,
    email_engaged: 0,
    wa_engaged: 1,
    sms_engaged: 0,
    voice_engaged: 0,
    // Genome v2
    industry: "Retail",
    sub_industry: "Ecommerce",
    enrichment_status: "completed",
  },
  {
    id: "MOCK-1002",
    name: "Carlos Soto",
    email: "carlos.soto@example.com",
    phone: "+34 600 333 444",
    state: "attempting",
    last_touch_at: "2024-11-01T16:45:00Z",
    campaign_id: "CMP-18",
    campaign_name: "ABM EMEA",
    channel_last: "phone",
    created_at: "2024-10-28T12:20:00Z",
    lead_brain_score: 74,
    lead_brain_bucket: "hot",
    attempts_total: 5,
    distinct_channels: 3,
    errors_total: 0,
    email_engaged: 1,
    wa_engaged: 1,
    sms_engaged: 0,
    voice_engaged: 1,
    industry: "Software",
    sub_industry: "SaaS",
    enrichment_status: "completed",
  },
  {
    id: "MOCK-1003",
    name: "Lucía Romero",
    email: "lucia.romero@example.com",
    phone: null,
    state: "qualified",
    last_touch_at: null,
    campaign_id: null,
    campaign_name: null,
    channel_last: "ads",
    created_at: "2024-10-25T09:30:00Z",
    lead_brain_score: 23,
    lead_brain_bucket: "cold",
    attempts_total: 1,
    distinct_channels: 1,
    errors_total: 0,
    email_engaged: 0,
    wa_engaged: 0,
    sms_engaged: 0,
    voice_engaged: 0,
    enrichment_status: "pending",
  },
]

function mapInboxRow(row: InboxRow): LeadInboxEntry {
  return {
    id: row.lead_id ?? "",
    name: row.lead_name,
    email: row.lead_email,
    phone: row.lead_phone,
    state: row.lead_state ?? null,
    last_touch_at: row.last_step_at,
    campaign_id: row.campaign_id,
    campaign_name: row.campaign_name,
    channel_last: row.channel_last,
    created_at: row.created_at,
  }
}

function collectMissingFields(leads: LeadInboxEntry[]) {
  const missing = new Set<string>()

  leads.forEach((lead) => {
    if (!lead.id) missing.add("lead_id")
    if (!lead.name) missing.add("lead_name")
    if (!lead.email) missing.add("lead_email")
    if (!lead.phone) missing.add("lead_phone")
    if (!lead.state) missing.add("lead_state")
    if (!lead.last_touch_at) missing.add("last_step_at")
    if (!lead.campaign_id && !lead.campaign_name)
      missing.add("campaign_id/name")
    if (!lead.channel_last) missing.add("channel_last")
  })

  return Array.from(missing)
}

export default function LeadsPage() {
  const supabaseReady = useMemo(
    () =>
      Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      ),
    [],
  )

  const [leads, setLeads] = useState<LeadInboxEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [missingFields, setMissingFields] = useState<string[]>([])
  const [usingMock, setUsingMock] = useState(!supabaseReady)
  const [query, setQuery] = useState("")
  const [stateFilter, setStateFilter] = useState<LeadState | "All">("All")

  useEffect(() => {
    let alive = true

    async function loadLeads() {
      // Sin Supabase frontend: mostramos mocks pero con Genome simulado
      if (!supabaseReady) {
        if (!alive) return
        setError(null)
        setLeads(MOCK_LEADS)
        setMissingFields(collectMissingFields(MOCK_LEADS))
        setLoading(false)
        setUsingMock(true)
        return
      }

      setLoading(true)
      const client = supabaseBrowser()

      // 1) Base inbox
      const { data, error: dbError } = await client
        .from("inbox_events")
        .select(
          "lead_id, lead_name, lead_email, lead_phone, lead_state, last_step_at, campaign_id, campaign_name, channel_last, created_at",
        )
        .order("last_step_at", { ascending: false })
        .limit(200)

      if (!alive) return

      if (dbError) {
        console.error(dbError)
        setError(
          "No se pudo acceder a inbox_events. Se muestran datos mock.",
        )
        setLeads(MOCK_LEADS)
        setMissingFields(collectMissingFields(MOCK_LEADS))
        setUsingMock(true)
        setLoading(false)
        return
      }

      let mapped: LeadInboxEntry[] = (data ?? []).map((row) =>
        mapInboxRow(row as InboxRow),
      )

      const ids = mapped.map((l) => l.id).filter(Boolean)

      if (ids.length > 0) {
        try {
          const client2 = supabaseBrowser()

          // 2) Lead Brain v1 (score + bucket)
          const brainPromise = client2
            .from("leads")
            .select("id, lead_brain_score, lead_brain_bucket")
            .in("id", ids)

          // 3) Multichannel signals
          const signalsPromise = client2
            .from("multichannel_lead_signals")
            .select(
              [
                "lead_id",
                "attempts_total",
                "distinct_channels",
                "errors_total",
                "last_touch_at",
                "email_engaged",
                "wa_engaged",
                "sms_engaged",
                "voice_engaged",
              ].join(", "),
            )
            .in("lead_id", ids)

          // 4) Lead Genome v2 (Enrichment)
          const genomePromise = client2
            .from("v_lead_with_enrichment_v2")
            .select(
              [
                "id",
                "industry",
                "sub_industry",
                "ai_lead_score",
                "enrichment_status",
              ].join(", "),
            )
            .in("id", ids)

          const [brainRes, signalsRes, genomeRes] = await Promise.all([
            brainPromise,
            signalsPromise,
            genomePromise,
          ])

          // Map Lead Brain
          const brainMap = new Map<
            string,
            { score: number | null; bucket: string | null }
          >()
          if (!brainRes.error && Array.isArray(brainRes.data)) {
            ;(brainRes.data as any[]).forEach((row) => {
              if (!row.id) return
              brainMap.set(row.id, {
                score:
                  typeof row.lead_brain_score === "number"
                    ? row.lead_brain_score
                    : row.lead_brain_score == null
                    ? null
                    : Number(row.lead_brain_score) || null,
                bucket: row.lead_brain_bucket ?? null,
              })
            })
          } else if (brainRes.error) {
            console.error("Error loading lead brain", brainRes.error)
          }

          // Map multichannel signals
          const signalsMap = new Map<
            string,
            {
              attempts_total: number | null
              distinct_channels: number | null
              errors_total: number | null
              last_touch_at: string | null
              email_engaged: number | null
              wa_engaged: number | null
              sms_engaged: number | null
              voice_engaged: number | null
            }
          >()
          if (!signalsRes.error && Array.isArray(signalsRes.data)) {
            ;(signalsRes.data as any[]).forEach((row) => {
              if (!row.lead_id) return
              signalsMap.set(row.lead_id, {
                attempts_total:
                  row.attempts_total == null
                    ? null
                    : Number(row.attempts_total) || 0,
                distinct_channels:
                  row.distinct_channels == null
                    ? null
                    : Number(row.distinct_channels) || 0,
                errors_total:
                  row.errors_total == null
                    ? null
                    : Number(row.errors_total) || 0,
                last_touch_at: row.last_touch_at ?? null,
                email_engaged:
                  row.email_engaged == null
                    ? null
                    : Number(row.email_engaged) || 0,
                wa_engaged:
                  row.wa_engaged == null ? null : Number(row.wa_engaged) || 0,
                sms_engaged:
                  row.sms_engaged == null ? null : Number(row.sms_engaged) || 0,
                voice_engaged:
                  row.voice_engaged == null
                    ? null
                    : Number(row.voice_engaged) || 0,
              })
            })
          } else if (signalsRes.error) {
            console.error(
              "Error loading multichannel_lead_signals",
              signalsRes.error,
            )
          }

          // Map Lead Genome v2 (solo campos confirmados)
          const genomeMap = new Map<
            string,
            {
              industry: string | null
              sub_industry: string | null
              ai_lead_score: number | null
              enrichment_status: string | null
            }
          >()
          if (!genomeRes.error && Array.isArray(genomeRes.data)) {
            ;(genomeRes.data as any[]).forEach((row) => {
              if (!row.id) return
              genomeMap.set(row.id, {
                industry: row.industry ?? null,
                sub_industry: row.sub_industry ?? null,
                ai_lead_score:
                  row.ai_lead_score == null
                    ? null
                    : Number(row.ai_lead_score) || 0,
                enrichment_status: row.enrichment_status ?? null,
              })
            })
          } else if (genomeRes.error) {
            console.error(
              "Error loading v_lead_with_enrichment_v2",
              genomeRes.error,
            )
          }

          // Hidratar todos los leads con Brain + Signals + Genome
          mapped = mapped.map((lead) => {
            const brain = brainMap.get(lead.id)
            const s = signalsMap.get(lead.id)
            const g = genomeMap.get(lead.id)

            return {
              ...lead,
              ...(brain && {
                lead_brain_score: brain.score,
                lead_brain_bucket: brain.bucket,
              }),
              ...(s && {
                attempts_total: s.attempts_total,
                distinct_channels: s.distinct_channels,
                errors_total: s.errors_total,
                last_touch_at: s.last_touch_at ?? lead.last_touch_at,
                email_engaged: s.email_engaged,
                wa_engaged: s.wa_engaged,
                sms_engaged: s.sms_engaged,
                voice_engaged: s.voice_engaged,
              }),
              ...(g && {
                industry: g.industry,
                sub_industry: g.sub_industry,
                ai_lead_score: g.ai_lead_score,
                enrichment_status: g.enrichment_status,
              }),
            }
          })
        } catch (e) {
          console.error("Error hydrating Lead Brain + Genome", e)
        }
      }

      setError(null)
      setLeads(mapped)
      setMissingFields(collectMissingFields(mapped))
      setUsingMock(false)
      setLoading(false)
    }

    void loadLeads()

    return () => {
      alive = false
    }
  }, [supabaseReady])

  const filteredLeads = useMemo(() => {
    const term = query.trim().toLowerCase()

    const bucketWeight: Record<string, number> = {
      hot: 3,
      warm: 2,
      cold: 1,
    }

    const withFilters = leads.filter((lead) => {
      if (stateFilter !== "All" && lead.state !== stateFilter) return false

      if (!term) return true

      const matchesQuery =
        lead.name?.toLowerCase().includes(term) ||
        lead.email?.toLowerCase().includes(term) ||
        lead.phone?.toLowerCase().includes(term) ||
        lead.campaign_name?.toLowerCase().includes(term) ||
        lead.channel_last?.toLowerCase().includes(term) ||
        lead.industry?.toLowerCase().includes(term) ||
        lead.sub_industry?.toLowerCase().includes(term)

      return Boolean(matchesQuery)
    })

    // Orden: bucket (hot > warm > cold) → lead_brain_score → recencia
    return [...withFilters].sort((a, b) => {
      const bucketA = (a.lead_brain_bucket ?? "").toLowerCase()
      const bucketB = (b.lead_brain_bucket ?? "").toLowerCase()
      const bucketScoreA = bucketWeight[bucketA] ?? 0
      const bucketScoreB = bucketWeight[bucketB] ?? 0
      if (bucketScoreA !== bucketScoreB) {
        return bucketScoreB - bucketScoreA
      }

      const scoreA = a.lead_brain_score ?? -1
      const scoreB = b.lead_brain_score ?? -1
      if (scoreA !== scoreB) {
        return scoreB - scoreA
      }

      const timeA = a.last_touch_at ? new Date(a.last_touch_at).getTime() : 0
      const timeB = b.last_touch_at ? new Date(b.last_touch_at).getTime() : 0
      return timeB - timeA
    })
  }, [leads, query, stateFilter])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold text-white">Leads</h1>
            <Badge variant="neutral">Inbox</Badge>
            <Badge variant="info">Lead Brain v1 + Genome v2</Badge>
            </div>
          <p className="text-sm text-white/60">
            Campos mínimos: {REQUIRED_FIELDS.join(", ")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
            aria-label="Refrescar leads"
          >
            <RefreshCw size={16} />
            Refresh
          </Button>
        </div>
      </div>

      {!supabaseReady && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-100">
          <AlertTriangle size={18} />
          <div>
            <p className="font-semibold">
              Supabase not configured, showing mock data
            </p>
            <p className="text-sm text-amber-200/90">
              Define NEXT_PUBLIC_SUPABASE_URL y
              NEXT_PUBLIC_SUPABASE_ANON_KEY para usar datos reales.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-100">
          <AlertTriangle size={18} className="mt-0.5" />
          <div>
            <p className="font-semibold">{error}</p>
            <p className="text-sm text-red-200/90">
              Si la vista no existe o el contrato cambió, comparte el SQL
              exacto. Se muestran mocks temporalmente.
            </p>
          </div>
        </div>
      )}

      {missingFields.length > 0 && (
        <Card>
          <CardHeader
            title="Campos faltantes"
            description="Se devuelven como null y se muestran en la tabla."
          />
          <CardContent className="flex flex-wrap gap-2">
            {missingFields.map((field) => (
              <Badge key={field} variant="warning">
                {field}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Lead Inbox"
          description={
            usingMock
              ? "Mostrando mock para permitir QA."
              : "Ordenado por Lead Brain (hot → cold), score y recencia."
          }
        />
        <CardContent>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre, email, teléfono, campaña o industria"
              className="max-w-md"
            />
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            {STATE_FILTERS.map((state) => {
              const active = stateFilter === state
              const label =
                state === "All"
                  ? "All"
                  : (state as string).charAt(0).toUpperCase() +
                    (state as string).slice(1)
              return (
                <Button
                  key={state}
                  variant={active ? "primary" : "outline"}
                  size="sm"
                  onClick={() => setStateFilter(state)}
                  className="capitalize"
                >
                  {label}
                </Button>
              )
            })}
          </div>

          <LeadInboxTable leads={filteredLeads} loading={loading} />
        </CardContent>
      </Card>
    </div>
  )
}
