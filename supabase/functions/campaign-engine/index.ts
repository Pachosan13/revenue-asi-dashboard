import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const VERSION = "campaign-engine-v1_2025-11-23";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
serve(async (req)=>{
  // ✅ Preflight CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  // Solo POST (el browser hace POST via supabase.functions.invoke)
  if (req.method !== "POST") {
    return new Response(JSON.stringify({
      ok: false,
      error: "Method not allowed"
    }), {
      status: 405,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  const SB_URL = Deno.env.get("SUPABASE_URL");
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SB_URL || !SB_KEY) {
    return new Response(JSON.stringify({
      ok: false,
      stage: "env",
      error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  const supabase = createClient(SB_URL, SB_KEY);
  try {
    const url = new URL(req.url);
    const debug = url.searchParams.get("debug") === "1";
    // 1) buscar lead_raw que NO tienen lead_enriched
    const { data: raws, error: rawErr } = await supabase.from("lead_raw").select("id, status").or("status.is.null,status.eq.new,status.eq.queued").limit(200);
    if (rawErr) {
      return new Response(JSON.stringify({
        ok: false,
        stage: "select_raw",
        error: rawErr.message
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const rawIds = (raws ?? []).map((r)=>r.id);
    if (rawIds.length === 0) {
      return new Response(JSON.stringify({
        ok: true,
        version: VERSION,
        queued: 0
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // 2) filtrar los que ya están enriched
    const { data: enriched, error: enrErr } = await supabase.from("lead_enriched").select("id").in("id", rawIds);
    if (enrErr) {
      return new Response(JSON.stringify({
        ok: false,
        stage: "select_enriched",
        error: enrErr.message
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const enrichedSet = new Set((enriched ?? []).map((e)=>e.id));
    const toQueue = rawIds.filter((id)=>!enrichedSet.has(id));
    // 3) meter a enrichment_queue (idempotente)
    let queued = 0;
    for (const id of toQueue){
      const { error } = await supabase.from("enrichment_queue").insert({
        lead_id: id,
        status: "queued",
        payload: {
          reason: "campaign_engine_v1"
        }
      });
      // si es duplicado (ya estaba en queue) lo ignoramos sin romper
      if (!error) queued++;
      else if (error.code !== "23505") {
        // solo loguea errores reales
        console.warn("enqueue error:", id, error.message);
      }
    }
    const body = debug ? {
      ok: true,
      version: VERSION,
      raw: rawIds.length,
      toQueue: toQueue.length,
      queued
    } : {
      ok: true,
      version: VERSION,
      queued
    };
    return new Response(JSON.stringify(body), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (e) {
    console.error("campaign-engine fatal:", e);
    return new Response(JSON.stringify({
      ok: false,
      stage: "fatal",
      error: e?.message ?? String(e)
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});


