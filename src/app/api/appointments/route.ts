// app/api/appointments/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase env vars");
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

type AppointmentLead = {
  name: string | null;
  email: string | null;
  phone: string | null;
};

type Appointment = {
  appointment_id: string;
  lead_id: string;
  account_id: string;
  starts_at: string;
  scheduled_for: string | null;
  timestamp: number | null;
  channel: string;
  status: string;
  notes: string | null;
  created_at: string;
  lead: AppointmentLead;
};

type ApiResponse = {
  ok: boolean;
  account_id: string;
  count: number;
  appointments: Appointment[];
};

export async function GET(req: Request) {
  try {
    const url = new globalThis.URL(req.url);
    const accountId = url.searchParams.get("account_id");
    const days = url.searchParams.get("days");
    const status = url.searchParams.get("status");

    if (!accountId) {
      return NextResponse.json(
        { ok: false, error: "Missing account_id" },
        { status: 400 },
      );
    }

    let query = supabase
      .from("v_operator_appointments")
      .select("*")
      .eq("account_id", accountId);

    // Solo citas futuras
    const nowIso = new Date().toISOString();
    query = query.gte("starts_at", nowIso);

    // Filtro por rango en días
    if (days) {
      const n = Number(days);
      if (!Number.isNaN(n) && n > 0) {
        const to = new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();
        query = query.lte("starts_at", to);
      }
    }

    // Filtro por estado
    if (status) {
      query = query.eq("status", status);
    }

    query = query.order("starts_at", { ascending: true });

    const { data, error } = await query;

    if (error) {
      console.error("appointments list error:", error.message);
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    const appointments: Appointment[] = (data ?? []).map((row: any) => ({
      appointment_id: row.appointment_id,
      lead_id: row.lead_id,
      account_id: row.account_id,
      starts_at: row.starts_at,
      scheduled_for: row.scheduled_for,
      timestamp: row.timestamp ?? null,
      channel: row.channel,
      status: row.status,
      notes: row.notes ?? null,
      created_at: row.created_at,
      lead: {
        name: row.lead_name ?? null,
        email: row.lead_email ?? null,
        phone: row.lead_phone ?? null,
      },
    }));

    const body: ApiResponse = {
      ok: true,
      account_id: accountId,
      count: appointments.length,
      appointments,
    };

    return NextResponse.json(body);
  } catch (e: any) {
    console.error("appointments list exception:", e);
    return NextResponse.json(
      { ok: false, error: "Unexpected server error" },
      { status: 500 },
    );
  }
}
