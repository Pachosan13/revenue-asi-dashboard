import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase env vars for appointment status route");
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

type ActionType = "show" | "no_show" | "rescheduled" | "cancelled";

type Body = {
  account_id?: string;
  action?: ActionType;
  new_starts_at?: string;
  appointment_id?: string;
};

function mapActionToUpdate(action: ActionType, newStartsAt?: string) {
  switch (action) {
    case "show":
      return {
        status: "completed",
        outcome: "show",
      };
    case "no_show":
      return {
        status: "no_show",
        outcome: "no_show",
      };
    case "cancelled":
      return {
        status: "cancelled",
        outcome: "cancelled",
      };
    case "rescheduled":
      if (!newStartsAt) {
        throw new Error("new_starts_at is required for rescheduled");
      }
      return {
        status: "scheduled",
        outcome: "rescheduled",
        starts_at: newStartsAt,
        scheduled_for: newStartsAt,
      };
    default:
      throw new Error("Invalid action");
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id?: string } },
) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;

    const appointmentId = params?.id || body.appointment_id || null;

    if (!appointmentId) {
      return NextResponse.json(
        { ok: false, error: "Missing appointment id" },
        { status: 400 },
      );
    }

    if (!body.account_id) {
      return NextResponse.json(
        { ok: false, error: "Missing account_id" },
        { status: 400 },
      );
    }

    if (!body.action) {
      return NextResponse.json(
        { ok: false, error: "Missing action" },
        { status: 400 },
      );
    }

    const action = body.action as ActionType;

    let updateSpec;
    try {
      updateSpec = mapActionToUpdate(action, body.new_starts_at);
    } catch (e: any) {
      return NextResponse.json(
        { ok: false, error: e.message ?? "Invalid action" },
        { status: 400 },
      );
    }

    const patch: Record<string, any> = {
      status: updateSpec.status,
      outcome: updateSpec.outcome,
    };

    if ("starts_at" in updateSpec && (updateSpec as any).starts_at) {
      patch.starts_at = (updateSpec as any).starts_at;
      patch.scheduled_for =
        (updateSpec as any).scheduled_for || (updateSpec as any).starts_at;
    }

    console.log("[appointments/status] PATCH", {
      appointmentId,
      account_id: body.account_id,
      action,
      patch,
    });

    const { data, error } = await supabase
      .from("appointments")
      .update(patch)
      .eq("id", appointmentId)
      .eq("account_id", body.account_id)
      .select(
        `
        id,
        lead_id,
        account_id,
        starts_at,
        scheduled_for,
        status,
        outcome,
        channel,
        notes,
        created_at
      `,
      )
      .single();

    if (error) {
      console.error(
        "[appointments/status] Supabase update error:",
        error.message,
      );
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json(
        { ok: false, error: "Appointment not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      action,
      appointment: data,
    });
  } catch (e: any) {
    console.error("[appointments/status] Exception:", e);
    return NextResponse.json(
      {
        ok: false,
        error:
          e?.message ??
          "Unexpected server error in appointments status endpoint",
      },
      { status: 500 },
    );
  }
}
