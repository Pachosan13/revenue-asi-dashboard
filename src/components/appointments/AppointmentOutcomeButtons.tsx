"use client"

import React, { useEffect, useState, useTransition } from "react"
import { Check, X } from "lucide-react"

import { Button } from "@/components/ui-custom"
import { supabaseBrowser } from "@/lib/supabase"

interface AppointmentOutcomeButtonsProps {
  appointmentId: string
  initialOutcome: "attended" | "no_show" | null
}

type ToastState = { type: "success" | "error"; message: string } | null

export function AppointmentOutcomeButtons({ appointmentId, initialOutcome }: AppointmentOutcomeButtonsProps) {
  const [outcome, setOutcome] = useState<"attended" | "no_show" | null>(initialOutcome)
  const [pending, startTransition] = useTransition()
  const [toast, setToast] = useState<ToastState>(null)

  useEffect(() => {
    if (!toast) return

    const timeout = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(timeout)
  }, [toast])

  const handleOutcome = (next: "attended" | "no_show") => {
    startTransition(async () => {
      const client = supabaseBrowser()
      const { error } = await client.rpc("set_appointment_outcome", {
        p_appointment_id: appointmentId,
        p_outcome: next,
      })

      if (error) {
        console.error(error)
        setToast({ type: "error", message: "Unable to update outcome. Please try again." })
        return
      }

      setOutcome(next)
      setToast({ type: "success", message: `Outcome set to ${next === "attended" ? "attended" : "no-show"}.` })
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => handleOutcome("attended")}
          className={
            outcome === "attended"
              ? "border-emerald-400/70 bg-emerald-500/15 text-emerald-50 hover:bg-emerald-500/20"
              : "bg-white/5"
          }
        >
          <Check size={14} className="mr-2" />
          ✅ Attended
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => handleOutcome("no_show")}
          className={
            outcome === "no_show"
              ? "border-rose-400/70 bg-rose-500/15 text-rose-50 hover:bg-rose-500/20"
              : "bg-white/5"
          }
        >
          <X size={14} className="mr-2" />
          ❌ No-show
        </Button>
      </div>

      {toast ? (
        <div
          className={`rounded-lg px-3 py-2 text-sm ${
            toast.type === "success"
              ? "border border-emerald-400/40 bg-emerald-500/10 text-emerald-50"
              : "border border-amber-400/40 bg-amber-500/10 text-amber-50"
          }`}
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  )
}

export default AppointmentOutcomeButtons
