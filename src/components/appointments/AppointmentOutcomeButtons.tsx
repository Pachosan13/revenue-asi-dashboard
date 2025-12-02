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
          size="xs"
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
          size="xs"
          variant={isNoShow ? "destructive" : "ghost"}
          disabled={pending !== null}
          onClick={() => handleClick("no_show")}
          className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-rose-100 hover:bg-rose-500/20"
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
