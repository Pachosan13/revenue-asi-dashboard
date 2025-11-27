"use client"

import React, { useState } from "react"
import { Play } from "lucide-react"
import { Button } from "@/components/ui-custom"

export function RunOrchestratorButton({ campaignId }: { campaignId: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle")
  const [message, setMessage] = useState<string | null>(null)

  async function handleRun() {
    setStatus("loading")
    setMessage(null)

    try {
      const response = await fetch("/api/director/run-orchestrator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_id: campaignId }),
      })

      const payload = await response.json()

      if (!response.ok || !payload.ok) {
        const errorMessage = payload?.error ?? "Failed to trigger orchestrator"
        setStatus("error")
        setMessage(errorMessage)
        return
      }

      setStatus("success")
      setMessage("Orchestrator triggered")
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error"
      setStatus("error")
      setMessage(errorMessage)
    }
  }

  return (
    <div className="space-y-1">
      <Button onClick={handleRun} size="sm" variant="primary" disabled={status === "loading"}>
        <Play size={16} />
        {status === "loading" ? "Running..." : "Run Orchestrator"}
      </Button>
      {message ? (
        <p className={`text-xs ${status === "error" ? "text-rose-300" : "text-emerald-300"}`}>{message}</p>
      ) : null}
    </div>
  )
}
