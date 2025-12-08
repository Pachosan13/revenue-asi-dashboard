// supabase/functions/inbound-events-router-v1/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const VERSION = "inbound-events-router-v1_2025-12-07"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

type InboundBody = {
  lead_id?: string
  channel?: "email" | "whatsapp" | "sms" | "voice"
  text?: string
  meta?: Record<string, unknown>
}

type LLMClassification = {
  sentiment: "positive" | "neutral" | "negative"
  intent:
    | "book_now"
    | "learn_more"
    | "not_now"
    | "wrong_person"
    | "spam"
  urgency: "now" | "same_day" | "this_week" | "later"
  should_book_now: boolean
  suggested_delay_minutes: number
  confidence: number
}

// pesos del brain para estos eventos (versión v1)
const EVENT_WEIGHTS: Record<string, number> = {
  reply_positive: 40,
  reply_negative: -40,
  unsubscribe: -999,
  reply_neutral: 5,
}

function normalizeText(text?: string | null): string {
  if (!text) return ""
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita acentos
    .trim()
}

function quickRuleCheck(text: string) {
  const t = normalizeText(text)

  // UNSUBSCRIBE HARD
  const unsubPatterns = [
    "unsubscribe",
    "stop",
    "baja",
    "darse de baja",
    "remove me",
    "remove my email",
    "no me escribas",
    "no me vuelvas a escribir",
    "quitarme de la lista",
  ]
  for (const p of unsubPatterns) {
    if (t.includes(p)) {
      return {
        matched: true as const,
        event_type: "unsubscribe",
        score_delta: EVENT_WEIGHTS["unsubscribe"],
        rule: "hard_unsubscribe",
      }
    }
  }

  // NEGATIVO CLARO
  const negPatterns = [
    "no me interesa",
    "no estoy interesado",
    "not interested",
    "no gracias",
    "no por ahora",
    "de momento no",
    "no quiero",
  ]
  for (const p of negPatterns) {
    if (t.includes(p)) {
      return {
        matched: true as const,
        event_type: "reply_negative",
        score_delta: EVENT_WEIGHTS["reply_negative"],
        rule: "clear_negative",
      }
    }
  }

  return { matched: false as const }
}

async function callOpenAIClassifier(
  text: string,
): Promise<LLMClassification | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY")
  if (!apiKey) {
    console.error("Missing OPENAI_API_KEY")
    return null
  }

  const prompt = `
Eres un clasificador de mensajes inbound para un sistema de outbound B2B que solo quiere agendar citas, no vender.

Analiza el siguiente mensaje del lead y devuelve un JSON *estricto* con este esquema:

{
  "sentiment": "positive" | "neutral" | "negative",
  "intent": "book_now" | "learn_more" | "not_now" | "wrong_person" | "spam",
  "urgency": "now" | "same_day" | "this_week" | "later",
  "should_book_now": boolean,
  "suggested_delay_minutes": number,
  "confidence": number
}

Notas importantes:
- Mensajes como "ahora no puedo, pero escríbeme más tarde" suelen ser:
  - sentiment: "positive"
  - intent: "book_now" o "learn_more" (depende del tono)
  - urgency: "same_day" normalmente, no "later" de semanas
  - suggested_delay_minutes debe ser en horas (30–120) si es en horario laboral
- Si el mensaje claramente pide parar ("no me interesa", "no me escribas más", etc.), entonces:
  - sentiment: "negative"
  - intent: "not_now" o "spam"
- "Wrong person" si explícitamente dice que no es la persona correcta.
- "spam" sólo si se queja directamente de spam.

Sé conservador con "now": úsalo solo si el mensaje indica que quiere hablar YA o "call me now".
Devuelve SOLO el JSON, sin texto adicional.

Mensaje:
"""${text}"""
  `.trim()

  const response = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: "You are a strict JSON classifier." },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
      }),
    },
  )

  if (!response.ok) {
    console.error("OpenAI error", await response.text())
    return null
  }

  const json = await response.json()
  const content = json.choices?.[0]?.message?.content
  if (!content || typeof content !== "string") {
    console.error("OpenAI invalid content", content)
    return null
  }

  try {
    const parsed = JSON.parse(content) as LLMClassification
    return parsed
  } catch (err) {
    console.error("Failed to parse OpenAI JSON", err, content)
    return null
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    })
  }

  const SB_URL = Deno.env.get("SUPABASE_URL")!
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const supabase = createClient(SB_URL, SB_KEY)

  let body: InboundBody
  try {
    body = (await req.json()) as InboundBody
  } catch (_err) {
    return new Response(
      JSON.stringify({ ok: false, error: "Invalid JSON body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }

  const lead_id = body.lead_id
  const channel = body.channel ?? "email"
  const text = body.text ?? ""
  const meta = body.meta ?? {}

  if (!lead_id || !text) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Missing lead_id or text",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  const normalized = normalizeText(text)

  // 1) Regla barata primero
  const quick = quickRuleCheck(normalized)
  let event_type: string | null = null
  let score_delta = 0
  let llmResult: LLMClassification | null = null
  let ruleUsed: string | null = null

  if (quick.matched) {
    event_type = quick.event_type
    score_delta = quick.score_delta
    ruleUsed = quick.rule
  } else {
    // 2) Llamar al LLM para clasificar
    llmResult = await callOpenAIClassifier(text)

    if (!llmResult) {
      // fallback súper neutro
      event_type = "reply_neutral"
      score_delta = EVENT_WEIGHTS["reply_neutral"]
    } else {
      const { sentiment, intent, urgency } = llmResult

      if (sentiment === "negative" && intent !== "wrong_person") {
        event_type = "reply_negative"
        score_delta = EVENT_WEIGHTS["reply_negative"]
      } else if (sentiment === "positive" || intent === "book_now") {
        event_type = "reply_positive"
        score_delta = EVENT_WEIGHTS["reply_positive"]
      } else {
        event_type = "reply_neutral"
        score_delta = EVENT_WEIGHTS["reply_neutral"]
      }

      ruleUsed = "llm_classifier"
    }
  }

  // 3) Insertar en core_memory_events
  const payload = {
    raw_text: text,
    normalized_text: normalized,
    channel,
    meta,
    router_version: VERSION,
    rule_used: ruleUsed,
    llm: llmResult,
  }

  const { error: insertErr } = await supabase
    .from("core_memory_events")
    .insert({
      lead_id,
      event_type,
      event_source: "inbound_router",
      channel,
      direction: "inbound",
      score_delta,
      payload,
    })

  if (insertErr) {
    console.error("core_memory_events insert error", insertErr)
    return new Response(
      JSON.stringify({
        ok: false,
        stage: "insert_core_memory_event",
        error: insertErr.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  return new Response(
    JSON.stringify({
      ok: true,
      version: VERSION,
      lead_id,
      event_type,
      score_delta,
      rule_used: ruleUsed,
      llm: llmResult,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  )
})
