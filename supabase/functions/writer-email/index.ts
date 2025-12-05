import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const VERSION = "writer-email-v2_2025-11-24_fetch_robust";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
};

const INDUSTRY_PROFILES: Record<string, any> = {
  dentist: {
    pain: [
      "pacientes que no llegan",
      "huecos en la agenda",
      "consultas por WhatsApp sin respuesta",
      "presupuestos que se enfrían",
    ],
    promise: "agendar más pacientes en automático",
    outcomes: [
      "más primeras consultas",
      "agenda llena",
      "presupuestos cerrados",
    ],
  },
  home_services: {
    pain: [
      "llamadas perdidas",
      "whatsapps sin contestar",
      "cotizaciones lentas",
      "urgencias que se van con otro",
    ],
    promise: "responder y cotizar al instante",
    outcomes: ["más trabajos", "más urgencias", "menos fricción"],
  },
  real_estate: {
    pain: ["leads fríos", "ghosting", "poco seguimiento"],
    promise: "convertir leads en showings",
    outcomes: ["más visitas", "más compradores"],
  },
  lawyer: {
    pain: ["consultas perdidas", "leads calientes que se enfrían"],
    promise: "agendar consultas calificadas sin esfuerzo",
    outcomes: ["más casos", "mejor intake"],
  },
  restaurant: {
    pain: ["reservas perdidas", "preguntas repetidas por WhatsApp"],
    promise: "reservas automáticas + respuestas instantáneas",
    outcomes: ["más reservas", "menos trabajo"],
  },
};

function fallback(industry: string) {
  return {
    ok: true,
    version: VERSION,
    subject: "Idea rápida",
    body:
      "Hola — vi tu negocio y creo que estás perdiendo clientes por falta de seguimiento rápido. " +
      "Montamos un sistema con IA que responde, filtra y agenda por ti. " +
      "¿Te muestro en 10 minutos cómo quedaría aplicado a tu caso?",
    meta: { industry, fallback: true },
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return new Response(JSON.stringify({ ok: true, version: VERSION }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {}

  const industry = body.industry ?? "generic";
  const profile = INDUSTRY_PROFILES[industry] ?? {
    pain: ["perder clientes todos los días"],
    promise: "conseguir más clientes con IA",
    outcomes: ["más ingresos", "menos trabajo manual"],
  };

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) {
    return new Response(JSON.stringify(fallback(industry)), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const prompt = `
Actúa como copywriter top-tier de cold email. Estilo: directo, humano, cero clichés.

Industria: ${industry}

Pain points:
${profile.pain.map((p: string) => "- " + p).join("\n")}

Promesa:
${profile.promise}

Resultados:
${profile.outcomes.map((p: string) => "- " + p).join("\n")}

Genera:
1) subject (máx 5 palabras)
2) body (90-130 palabras, concreto, sin relleno)

Devuélvelo SOLO en JSON:
{"subject":"...","body":"..."}
`;

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.6,
        max_tokens: 300,
      }),
    });

    const data = await r.json();

    const txt = data?.choices?.[0]?.message?.content ?? "";
    let out: any;
    try {
      out = JSON.parse(txt);
    } catch {
      // si el modelo devolvió texto suelto, neutralizamos
      return new Response(JSON.stringify(fallback(industry)), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        version: VERSION,
        subject: out.subject,
        body: out.body,
        meta: { industry, fallback: false },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch {
    return new Response(JSON.stringify(fallback(industry)), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
