<<<<<<< HEAD
"use client";

import React, { useState } from "react";
import { Check, X as XIcon } from "lucide-react";

import { supabaseBrowser } from "@/lib/supabase";
import { Button } from "@/components/ui-custom";

type Outcome = "show" | "no_show";

interface Props {
  appointmentId: string;
  currentOutcome: Outcome | null;
}

interface ToastState {
  type: "success" | "error";
  message: string;
}

export default function AppointmentOutcomeButtons({
  appointmentId,
  currentOutcome,
}: Props) {
  const [pending, setPending] = useState<Outcome | null>(null);
  const [localOutcome, setLocalOutcome] = useState<Outcome | null>(
    currentOutcome,
  );
  const [toast, setToast] = useState<ToastState | null>(null);

  const supabase = supabaseBrowser();

  async function handleClick(next: Outcome) {
    if (pending) return;

    setPending(next);
    setToast(null);

    try {
      const { data, error } = await supabase.rpc("set_appointment_outcome", {
        p_appointment_id: appointmentId,
        p_outcome: next,
      });

      console.log("set_appointment_outcome result", { data, error });

      if (error) {
        console.error("set_appointment_outcome error:", error);
        setToast({
          type: "error",
          message:
            "Unable to update outcome. Please try again or check Supabase logs.",
        });
        return;
      }

      setLocalOutcome(next);
      setToast({
        type: "success",
        message:
          next === "show"
            ? "Appointment marked as attended."
            : "Appointment marked as no-show.",
      });
    } catch (err) {
      console.error("RPC call failed:", err);
      setToast({
        type: "error",
        message: "Unexpected error. Check console/network tab.",
      });
    } finally {
      setPending(null);
    }
  }

  const isAttended = localOutcome === "show";
  const isNoShow = localOutcome === "no_show";

  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={isAttended ? "primary" : "ghost"}
          disabled={pending !== null}
          onClick={() => handleClick("show")}
          className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-emerald-100 hover:bg-emerald-500/20"
        >
          <Check className="h-3 w-3" />
          <span>Attended</span>
        </Button>

        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending !== null}
          onClick={() => handleClick("no_show")}
          className={`inline-flex items-center gap-1 rounded-full border border-rose-500/40 px-3 py-1 text-rose-100 hover:bg-rose-500/20 ${isNoShow ? "bg-rose-500/20" : "bg-rose-500/10"}`}
        >
          <XIcon className="h-3 w-3" />
          <span>No-show</span>
        </Button>
      </div>

      {toast && (
        <p
          className={
            toast.type === "success"
              ? "text-[11px] text-emerald-300"
              : "text-[11px] text-rose-300"
          }
        >
          {toast.message}
        </p>
      )}
    </div>
  );
}
=======
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
>>>>>>> origin/director-engine-core
