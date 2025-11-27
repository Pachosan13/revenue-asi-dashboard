import React from "react"
import { Play } from "lucide-react"
import { RunOrchestratorButton } from "@/components/director/RunOrchestratorButton"
import { Badge, Card, CardContent, CardHeader, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui-custom"
import { getDirectorOverview } from "@/lib/director"
import type { CampaignSummary, EvaluationEvent } from "@/types/director"

export const revalidate = 0

function formatPercent(numerator: number | null | undefined, denominator: number | null | undefined) {
  if (!denominator || denominator === 0) return "0%"
  const ratio = ((numerator ?? 0) / denominator) * 100
  return `${ratio.toFixed(1)}%`
}

function EvaluationItem({ event }: { event: EvaluationEvent }) {
  const created = new Date(event.created_at)
  const dateText = created.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })

  const kpiEntries = event.kpis && typeof event.kpis === "object"
    ? Object.entries(event.kpis as Record<string, unknown>)
    : []

  return (
    <div
      className="rounded-xl border border-white/5 bg-white/5/80 p-4 shadow-[0_10px_35px_rgba(0,0,0,0.25)]"
      style={{
        opacity: event.importance && event.importance > 5 ? 1 : 0.92,
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-white/50">{event.actor ?? "Unknown actor"}</p>
          <p className="text-base font-semibold text-white">{event.label ?? event.event_type ?? "Event"}</p>
        </div>
        <div className="text-sm text-white/60">{dateText}</div>
      </div>
      {event.notes ? <p className="mt-3 text-sm text-white/80">{event.notes}</p> : null}
      {kpiEntries.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {kpiEntries.map(([key, value]) => (
            <span
              key={key}
              className="inline-flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-white/80"
            >
              <span className="text-white/60">{key}</span>
              <span className="font-semibold text-white">{String(value)}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default async function DirectorPage() {
  let campaigns: CampaignSummary[] = []
  let evaluations: EvaluationEvent[] = []
  let errorMessage: string | null = null

  try {
    const result = await getDirectorOverview()
    campaigns = result.campaigns
    evaluations = result.evaluations
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Failed to load director overview"
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs uppercase tracking-[0.16em] text-white/50">Campaign funnel and system evaluations</p>
        <h1 className="mt-1 text-3xl font-semibold text-white">Director Console</h1>
        <p className="mt-2 max-w-2xl text-sm text-white/70">
          High-level view across campaigns and the CEO-ASI evaluation log. Trigger orchestrations and monitor the latest signals.
        </p>
      </div>

      {errorMessage ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {errorMessage}
        </div>
      ) : null}

      <Card>
        <CardHeader title="Campaign funnel" description="Touch throughput by campaign" />
        <CardContent>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Campaign</TableHeaderCell>
                <TableHeaderCell>Total touches</TableHeaderCell>
                <TableHeaderCell>Sent</TableHeaderCell>
                <TableHeaderCell>Failed</TableHeaderCell>
                <TableHeaderCell>Fail %</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {campaigns.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-white/60">
                    No campaigns found.
                  </TableCell>
                </TableRow>
              ) : (
                campaigns.map((campaign) => {
                  const failPercentage = formatPercent(campaign.failed ?? 0, campaign.total_touches ?? 0)
                  return (
                    <TableRow key={campaign.campaign_id}>
                      <TableCell className="font-semibold text-white">{campaign.campaign_name}</TableCell>
                      <TableCell>{campaign.total_touches ?? 0}</TableCell>
                      <TableCell>{campaign.sent ?? 0}</TableCell>
                      <TableCell className="text-rose-300">{campaign.failed ?? 0}</TableCell>
                      <TableCell>
                        <Badge variant="neutral" className="border border-white/15 bg-white/5 text-white">
                          {failPercentage}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <RunOrchestratorButton campaignId={campaign.campaign_id} />
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          title="Evaluations"
          description="Recent core memory evaluations and KPI snapshots"
          action={
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60">
              <Play size={14} className="text-emerald-300" />
              Live feed
            </div>
          }
        />
        <CardContent className="space-y-3">
          {evaluations.length === 0 ? (
            <p className="text-sm text-white/60">No evaluations available.</p>
          ) : (
            evaluations.map((event) => <EvaluationItem key={event.id} event={event} />)
          )}
        </CardContent>
      </Card>
    </div>
  )
}
