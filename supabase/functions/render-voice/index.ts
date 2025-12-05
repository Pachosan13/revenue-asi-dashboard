import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VERSION = "render-voice-openai-v3_2025-11-24_logs_timeout";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeJsonParse(s: string) {
  try { return JSON.parse(s); } catch { return null; }
}

function log(...args: any[]) {
  // logs estructurados para dashboard
  console.log(JSON.stringify(args.length === 1 ? args[0] : args));
}

serve(async (req) => {
  const request_id = crypto.randomUUID();

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const debug = url.searchParams.get("debug") === "1";

  if (req.method === "GET" && debug) {
    log({ request_id, stage: "debug", ok: true, version: VERSION });
    return json({ ok: true, version: VERSION });
  }

  if (req.method !== "POST") {
    log({ request_id, stage: "method", ok: false, method: req.method });
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const SB_URL = Deno.env.get("SUPABASE_URL");
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  // soporta ambos nombres
  const OPENAI_KEY =
    Deno.env.get("OPENAI_API_KEY") ??
    Deno.env.get("OPEN_API_KEY");

  const FALLBACK_URL = Deno.env.get("VOICE_FALLBACK_URL") ?? "";

  if (!SB_URL || !SB_KEY) {
    log({
      request_id,
      stage: "env",
      ok: false,
      error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
    return json(
      { ok: false, stage: "env", error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", request_id, version: VERSION },
      500,
    );
  }

  const supabase = createClient(SB_URL, SB_KEY);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const text = String(body.text ?? "").trim();
  const lead_id = String(body.lead_id ?? "").trim();

  const model = String(body.model ?? "gpt-4o-mini-tts");
  const voice = String(body.voice ?? "alloy");
  const bucket = String(body.bucket ?? "voice");

  if (!text || !lead_id) {
    log({
      request_id,
      stage: "input",
      ok: false,
      has_text: !!text,
      has_lead_id: !!lead_id,
    });
    return json(
      { ok: false, stage: "input", error: "text and lead_id are required", request_id, version: VERSION },
      400,
    );
  }

  log({
    request_id,
    stage: "start",
    ok: true,
    lead_id,
    model,
    voice,
    bucket,
    text_len: text.length,
    has_openai_key: !!OPENAI_KEY,
    has_fallback: !!FALLBACK_URL,
  });

  // si no hay key, pero sí fallback → no rompemos
  if (!OPENAI_KEY) {
    if (FALLBACK_URL) {
      log({ request_id, stage: "fallback", reason: "missing_openai_key" });
      return json({
        ok: true,
        request_id,
        version: VERSION,
        publicUrl: FALLBACK_URL,
        meta: { fallback: true, reason: "missing_openai_key" },
      });
    }
    log({ request_id, stage: "env", ok: false, error: "Missing OPENAI_API_KEY" });
    return json(
      { ok: false, stage: "env", error: "Missing OPENAI_API_KEY", request_id, version: VERSION },
      500,
    );
  }

  try {
    // timeout duro para no colgar dispatch
    const controller = new AbortController();
    const timeoutMs = Number(body.timeout_ms ?? 20000);
    const t = setTimeout(() => controller.abort(), timeoutMs);

    const ttsRes = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        voice,
        input: text,
        format: "mp3",
      }),
    }).finally(() => clearTimeout(t));

    if (!ttsRes.ok) {
      const errText = await ttsRes.text();
      const errJson = safeJsonParse(errText);
      const errType =
        errJson?.error?.type ??
        errJson?.error?.code ??
        (errText.includes("insufficient_quota") ? "insufficient_quota" : "unknown");

      log({
        request_id,
        stage: "openai_tts",
        ok: false,
        http_status: ttsRes.status,
        errType,
      });

      if (errType === "insufficient_quota" && FALLBACK_URL) {
        log({ request_id, stage: "fallback", reason: "insufficient_quota" });
        return json({
          ok: true,
          request_id,
          version: VERSION,
          publicUrl: FALLBACK_URL,
          meta: {
            fallback: true,
            reason: "insufficient_quota",
            openai_error: errJson ?? errText,
          },
        });
      }

      return json(
        {
          ok: false,
          request_id,
          stage: "openai_tts",
          error: errJson ?? errText,
          version: VERSION,
        },
        500,
      );
    }

    const audioBuffer = await ttsRes.arrayBuffer();
    const audioBytes = new Uint8Array(audioBuffer);

    if (!audioBytes.length) {
      log({ request_id, stage: "openai_tts", ok: false, error: "empty_audio" });
      return json(
        { ok: false, request_id, stage: "openai_tts", error: "empty_audio", version: VERSION },
        500,
      );
    }

    const fileId = crypto.randomUUID();
    const path = `${lead_id}/${fileId}.mp3`;

    log({ request_id, stage: "upload_start", path, size: audioBytes.length });

    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(path, audioBytes, {
        contentType: "audio/mpeg",
        upsert: false,
      });

    if (upErr) {
      log({ request_id, stage: "upload", ok: false, error: upErr.message });
      return json(
        { ok: false, request_id, stage: "upload", error: upErr.message, version: VERSION },
        500,
      );
    }

    const publicUrl = `${SB_URL}/storage/v1/object/public/${bucket}/${path}`;

    log({
      request_id,
      stage: "done",
      ok: true,
      bucket,
      path,
      publicUrl,
    });

    return json({
      ok: true,
      request_id,
      version: VERSION,
      bucket,
      path,
      publicUrl,
      meta: { fallback: false },
    });
  } catch (e) {
    const msg = String(e);

    // si abortó por timeout
    if (msg.includes("AbortError") && FALLBACK_URL) {
      log({ request_id, stage: "fallback", reason: "timeout_abort" });
      return json({
        ok: true,
        request_id,
        version: VERSION,
        publicUrl: FALLBACK_URL,
        meta: { fallback: true, reason: "timeout_abort" },
      });
    }

    if (FALLBACK_URL) {
      log({ request_id, stage: "fallback", reason: "fatal_exception", error: msg });
      return json({
        ok: true,
        request_id,
        version: VERSION,
        publicUrl: FALLBACK_URL,
        meta: { fallback: true, reason: "fatal_exception", error: msg },
      });
    }

    log({ request_id, stage: "fatal", ok: false, error: msg });
    return json(
      { ok: false, request_id, stage: "fatal", error: msg, version: VERSION },
      500,
    );
  }
});
