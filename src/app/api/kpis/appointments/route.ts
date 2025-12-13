// app/api/appointments/kpis/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase env vars");
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

export async function GET(req: Request) {
  try {
    const url = new globalThis.URL(req.url);
    const accountId = url.searchParams.get("account_id");

    if (!accountId) {
      return NextResponse.json(
        { ok: false, error: "Missing account_id" },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from("v_appointment_kpis")
      .select("*")
      .eq("account_id", accountId);

    if (error) {
      console.error("appointments KPIs error:", error.message);
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      account_id: accountId,
      kpis: data ?? [],
    });
  } catch (e: any) {
    console.error("appointments KPIs exception:", e);
    return NextResponse.json(
      { ok: false, error: "Unexpected server error" },
      { status: 500 },
    );
  }
}
