"use client"

import React, { useMemo, useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { AlertTriangle, Pause, Play, Plus, RefreshCcw, Sparkles } from "lucide-react"
import Link from "next/link"

import { Card, CardContent, CardHeader, Button } from "@/components/ui-custom"
import { Campaign, CampaignStatus, CampaignType } from "@/types/campaign"
import { messageVariants, campaignTouches } from "../mock-data"
import { CampaignKpis } from "@/components/campaigns/CampaignKpis"
import { CadenceBuilder } from "@/components/campaigns/CadenceBuilder"
import { MessageEditor } from "@/components/campaigns/MessageEditor"
import { SystemEventsPanel } from "@/components/campaigns/SystemEventsPanel"
import { supabaseBrowser } from "@/lib/supabase"

type StartCampaignResponse =
  | {
      ok: true
      version: string
      selected: number
      inserted: number
      dry_run: boolean
      errors: unknown[]
    }
  | {
      ok: false
      error: string
    }

const statusPill: Record<CampaignStatus, string> = {
  live: "bg-emerald-500/20 text-emerald-200 border border-emerald-400/40",
  paused: "bg-amber-500/20 text-amber-100 border border-amber-400/30",
  draft: "bg-white/5 text-white/70 border border-white/15",
}

const statusMap: Record<string, CampaignStatus> = {
  active: "live",
  paused: "paused",
  draft: "draft",
}

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = supabaseBrowser()

  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [status, setStatus] = useState<CampaignStatus>("draft")
  const [isStarting, setIsStarting] = useState(false)
  const [startFeedback, setStartFeedback] = useState<
    | {
        type: "success" | "error"
        message: string
      }
    | null
  >(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // --------------------------------
  // Load campaign from Supabase
  // --------------------------------
  useEffect(() => {
    async function loadCampaign() {
      if (!params?.id || params.id === "new") {
        setCampaign(null)
        setStatus("draft")
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)

      const { data, error } = await supabase
        .from("campaigns")
        .select("*")
        .eq("id", params.id)
        .single()

      if (error) {
        console.error("Error loading campaign", error)
        setError(error.message)
        setLoading(false)
        return
      }

      const mappedStatus: CampaignStatus =
        statusMap[data.status] ?? "draft"

      const campaignFromDb: Campaign = {
        id: data.id,
        name: data.name ?? "Untitled",
        type: (data.type ?? "outbound") as CampaignType,
        status: mappedStatus,
        leads_count: data.leads_count ?? 0,
        reply_rate: data.reply_rate ?? 0,
        meetings_booked: data.meetings_booked ?? 0,
        conversion: data.conversion ?? 0,
        created_at: data.created_at ?? new Date().toISOString().slice(0, 10),
        error_rate: data.error_rate ?? 0,
        daily_throughput: data.daily_throughput ?? 0,
        leads_contacted: data.leads_contacted ?? 0,
        touches: data.touches ?? campaignTouches,
        message_variants: data.message_variants ?? messageVariants,
      }

      setCampaign(campaignFromDb)
      setStatus(campaignFromDb.status)
      setLoading(false)
    }

    loadCampaign()
  }, [params?.id, supabase])

  const effectiveCampaign: Campaign = useMemo(() => {
    if (!campaign || params?.id === "new") {
      return {
        id: "new",
        name: "New outbound program",
        type: "outbound",
        status: "draft",
        leads_count: 0,
        reply_rate: 0,
        meetings_booked: 0,
        conversion: 0,
        created_at: new Date().toISOString().slice(0, 10),
        error_rate: 0,
        daily_throughput: 0,
        leads_contacted: 0,
        touches: campaignTouches,
        message_variants: messageVariants,
      }
    }
    return { ...campaign, status }
  }, [campaign, status, params])

  const eventsData = {
    deliveries: {
      label: "Deliveries",
      color: "#34d399",
      data: [40, 52, 64, 62, 71, 78, 85],
    },
    failures: {
      label: "Failures",
      color: "#fbbf24",
      data: [2, 3, 4, 3, 5, 4, 3],
    },
    retries: {
      label: "Retries",
      color: "#a78bfa",
      data: [5, 7, 6, 6, 8, 7, 6],
    },
  }

  const emptyState = !campaign || params?.id === "new"

  // --------------------------------
  // Start campaign
  // --------------------------------
  const handleStartCampaign = async () => {
    if (!campaign || !campaign.id || campaign.id === "new") {
      setStartFeedback({ type: "error", message: "No campaign to start." })
      return
    }

    setIsStarting(true)
    setStartFeedback(null)

    try {
      const response = await fetch("/functions/v1/start-campaign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ campaign_id: campaign.id }),
      })

      let payload: StartCampaignResponse | null = null

      try {
        payload = await response.json()
      } catch (error) {
        console.error("Failed to parse start-campaign response", error)
      }

      if (!response.ok || !payload || payload.ok !== true) {
        const errorMessage =
          (payload && "error" in payload ? payload.error : null) ||
          response.statusText ||
          "Failed to start campaign"
        throw new Error(errorMessage)
      }

      setStatus("live")
      setStartFeedback({
        type: "success",
        message: `Campaign started. Selected ${
          (payload as any).selected ?? 0
        } leads, inserted ${(payload as any).inserted ?? 0}.`,
      })
      router.refresh()
    } catch (error) {
      setStartFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to start campaign",
      })
    } finally {
      setIsStarting(false)
    }
  }

  // --------------------------------
  // Render
  // --------------------------------

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-white/60">
        Loading campaign...
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4 text-sm text-red-300">
        <p>Failed to load campaign.</p>
        <p className="text-red-400/80">{error}</p>
        <Button
          variant="subtle"
          onClick={() => router.push("/campaigns")}
        >
          Back to campaigns
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-white/50">
            Outbound campaign
          </p>
          <h1 className="text-3xl font-semibold text-white">
            {effectiveCampaign.name}
          </h1>
          <p className="text-sm text-white/60">
            Control cadence, copy, and system health from this console.
          </p>
          <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60">
            <span
              className={`h-2 w-2 rounded-full ${
                status === "live"
                  ? "bg-emerald-400"
                  : status === "paused"
                  ? "bg-amber-300"
                  : "bg-white/40"
              }`}
            />
            <span
              className={`rounded-full px-3 py-1 text-xs capitalize ${statusPill[status]}`}
            >
              {status}
            </span>
            <button
              onClick={() =>
                setStatus((s) => (s === "live" ? "paused" : "live"))
              }
              className="text-emerald-300 underline decoration-emerald-400/60 decoration-dashed"
            >
              Toggle
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="subtle"
            size="sm"
            className="gap-2"
            onClick={() => router.push("/campaigns")}
          >
            <RefreshCcw size={16} /> Back to list
          </Button>
          <Button variant="primary" size="md" className="gap-2">
            <Sparkles size={16} /> Optimize
          </Button>
        </div>
      </div>

      <CampaignKpis campaign={{ ...effectiveCampaign, status }} />

      {emptyState ? (
        <Card className="border-dashed border-emerald-400/30 bg-white/5">
          <CardContent className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
            <div className="rounded-full bg-emerald-500/20 p-3 text-emerald-300 shadow-[0_0_40px_rgba(16,185,129,0.4)]">
              <Plus />
            </div>
            <p className="text-lg font-semibold text-white">
              Start a new outbound program
            </p>
            <p className="max-w-2xl text-sm text-white/60">
              Draft cadence, copy, and system limits here. When you’re ready,
              switch status to live and the OS will begin orchestrating sends.
            </p>
            <div className="flex gap-2">
              <Link href="/campaigns/new">
                <Button variant="primary">Generate from template</Button>
              </Link>
              <Link href="/campaigns">
                <Button
                  variant="ghost"
                  className="border border-white/10"
                >
                  Cancel
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[2fr,1.2fr]">
        <div className="space-y-4">
          <CadenceBuilder
            initialTouches={
              effectiveCampaign.touches ?? campaignTouches
            }
          />
          <MessageEditor
            initialVariants={
              effectiveCampaign.message_variants ?? messageVariants
            }
          />
        </div>

        <div className="space-y-4">
          <SystemEventsPanel
            deliveries={eventsData.deliveries}
            failures={eventsData.failures}
            retries={eventsData.retries}
          />

          <Card className="border-white/10 bg-white/5">
            <CardHeader
              title="Quality gates"
              description="Blocks, throttles, and alerts"
            />
            <CardContent className="space-y-3">
              {[
                "SPF/DMARC monitor",
                "Opt-out guardrails",
                "DNC sync",
                "Rate-limit override",
              ].map((item) => (
                <div
                  key={item}
                  className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white/70"
                >
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    {item}
                  </div>
                  <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-xs text-emerald-200">
                    Healthy
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="sticky bottom-4 flex flex-wrap items-center justify-end gap-3">
        {startFeedback ? (
          <div
            className={`rounded-2xl border px-4 py-2 text-sm ${
              startFeedback.type === "success"
                ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-100"
                : "border-amber-400/40 bg-amber-500/10 text-amber-100"
            }`}
            role="status"
            aria-live="polite"
          >
            {startFeedback.message}
          </div>
        ) : null}
        <Button
          variant="primary"
          className="gap-2"
          disabled={isStarting || !campaign || campaign.id === "new"}
          onClick={handleStartCampaign}
        >
          <Play size={16} />{" "}
          {isStarting ? "Starting..." : "Start campaign"}
        </Button>
        <Button variant="subtle" className="gap-2 text-amber-200">
          <Pause size={16} /> Pause
        </Button>
        <Button variant="ghost" className="gap-2 border border-white/10">
          <AlertTriangle size={16} /> Clone
        </Button>
      </div>
    </div>
  )
}
